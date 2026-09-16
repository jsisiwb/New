/**
 * The job-event stream reader (Checkpoint 7).
 *
 * The API's SSE endpoint is a *view* of the append-only `job_events` table, with a monotone per-job `seq`
 * as the event id. That is what makes correct reconnection possible at all, and this reader is written to
 * the guarantees that table provides rather than to whatever the browser happens to deliver:
 *
 *  * RECONNECT REPLAYS, IT DOES NOT RESUME BLINDLY. The last id actually *applied* is sent back as
 *    `Last-Event-ID`, so the server replays persisted history from there. Tracking the last id *received*
 *    instead would skip an event that arrived while the connection was dying.
 *  * DUPLICATES ARE SUPPRESSED BY SEQUENCE, NOT BY CONTENT. A replay legitimately re-delivers events the
 *    client already applied; anything at or below the applied watermark is dropped. Comparing payloads
 *    would also drop two genuinely identical heartbeat-adjacent events.
 *  * A REPLAYED STATUS IS NEVER NEWER THAN A PERSISTED ONE. Status is only advanced by an event whose seq
 *    is above the watermark, so a replay of an old `running` cannot overwrite a later `completed` that the
 *    page already read from the jobs API. This is the bug that makes an operator cancel a finished run.
 *  * A TERMINAL EVENT CLOSES THE STREAM. The server marks it; reconnecting afterwards would reopen a
 *    stream that has nothing left to say and would keep a connection open for every finished job on screen.
 *  * HEARTBEATS ARE NOT EVENTS. SSE comment lines keep the connection alive and are deliberately invisible
 *    to the UI and to assistive technology — announcing one every few seconds would make the page unusable
 *    with a screen reader.
 */

export interface JobEvent {
  readonly seq: number;
  readonly kind: string;
  readonly terminal: boolean;
  readonly payload: Record<string, unknown>;
}

export interface JobStreamHandlers {
  readonly onEvent: (event: JobEvent) => void;
  readonly onStateChange: (state: JobStreamState) => void;
}

export type JobStreamState = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** The minimal EventSource surface this reader uses; narrowed so a test can substitute a fake. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
  onerror: ((this: unknown, ev: unknown) => void) | null;
  onopen: ((this: unknown, ev: unknown) => void) | null;
}

export type EventSourceFactory = (url: string, lastEventId: string | undefined) => EventSourceLike;

/**
 * Follow one job's events with correct replay semantics.
 *
 * The caller owns the transport (`factory`) so this logic can be tested deterministically and so the app
 * can pass whatever carries `Last-Event-ID` — the browser's own `EventSource` restores it automatically on
 * its internal retries, but an explicit reconnect after an error has to send it itself.
 */
export class JobEventStream {
  /** The highest seq actually APPLIED. The watermark, not merely the last thing seen. */
  private applied = 0;
  private source: EventSourceLike | undefined;
  private closed = false;
  /** Undefined until the first transition, so `start()` genuinely announces "connecting". */
  private state: JobStreamState | undefined;

  constructor(
    private readonly url: string,
    private readonly factory: EventSourceFactory,
    private readonly handlers: JobStreamHandlers,
  ) {}

  /** Events already applied, so a reconnect resumes from the right place. */
  get watermark(): number {
    return this.applied;
  }

  get currentState(): JobStreamState {
    return this.state ?? 'connecting';
  }

  start(): void {
    this.open('connecting');
  }

  private open(state: JobStreamState): void {
    if (this.closed) return;
    this.setState(state);
    const lastEventId = this.applied > 0 ? String(this.applied) : undefined;
    const source = this.factory(this.url, lastEventId);
    this.source = source;
    source.onopen = () => {
      this.setState('open');
    };
    source.addEventListener('message', (event) => {
      this.receive(event);
    });
    source.onerror = () => {
      // A dropped connection is not a failure of the job: the events are persisted, so the honest state is
      // "reconnecting" and the operator should see that rather than an error.
      if (this.closed) return;
      this.setState('reconnecting');
    };
  }

  private receive(event: MessageEvent<string>): void {
    // A frame delivered after the stream closed is ignored outright. A transport can hand over a buffered
    // message after `close()`, and applying it would let a finished run appear to keep going.
    if (this.closed) return;
    const parsed = parseEvent(event);
    if (!parsed) return;
    // The duplicate/ordering gate. Everything at or below the watermark is a replay of applied history.
    if (parsed.seq <= this.applied) return;
    this.applied = parsed.seq;
    this.handlers.onEvent(parsed);
    if (parsed.terminal) this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.source?.close();
    this.setState('closed');
  }

  private setState(state: JobStreamState): void {
    if (this.state === state) return;
    this.state = state;
    this.handlers.onStateChange(state);
  }
}

/**
 * Parse one SSE message into an event, or `undefined` when it is not one.
 *
 * Heartbeat comments never reach `message` listeners, and a malformed payload is dropped rather than
 * throwing: a stream that dies on one bad frame would lose the rest of a real run's history.
 */
export function parseEvent(event: MessageEvent<string>): JobEvent | undefined {
  const seq = Number(event.lastEventId);
  if (!Number.isInteger(seq) || seq <= 0) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(event.data);
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const row = data as Record<string, unknown>;
  return {
    seq,
    kind: typeof row.kind === 'string' ? row.kind : 'unknown',
    terminal: row.terminal === true,
    payload:
      typeof row.payload === 'object' && row.payload !== null
        ? (row.payload as Record<string, unknown>)
        : {},
  };
}

/**
 * The operator-facing status of a job, folded from its applied events over the status the jobs API already
 * persisted.
 *
 * The persisted status is the floor: an event stream that replays an older `running` must not drag a job
 * the API already reported as `completed` backwards. `seenSeq` makes that explicit rather than implicit in
 * call ordering.
 */
export interface JobView {
  readonly status: string;
  readonly step: string | undefined;
  readonly seenSeq: number;
  readonly terminal: boolean;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export function foldJobEvent(view: JobView, event: JobEvent): JobView {
  if (event.seq <= view.seenSeq) return view;
  // A terminal status already persisted is never relabelled by a later non-terminal event: a cancel that
  // lost the race with acceptance must not make accepted canon look cancelled.
  if (TERMINAL.has(view.status) && !event.terminal) return { ...view, seenSeq: event.seq };
  const status = typeof event.payload.status === 'string' ? event.payload.status : view.status;
  const step = typeof event.payload.step === 'string' ? event.payload.step : view.step;
  return {
    status,
    step,
    seenSeq: event.seq,
    terminal: event.terminal || TERMINAL.has(status),
  };
}
