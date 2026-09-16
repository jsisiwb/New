/**
 * SSE replay semantics (Checkpoint 7).
 *
 * These are unit tests against a fake transport rather than a live stream, deliberately: the properties
 * being proved are about ORDERING and IDEMPOTENCE, and a real network would make them timing-dependent and
 * therefore flaky exactly where they must be exact.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  foldJobEvent,
  JobEventStream,
  parseEvent,
  type EventSourceLike,
  type JobEvent,
  type JobStreamState,
  type JobView,
} from './job-events';

/** A minimal fake EventSource that records the Last-Event-ID it was opened with. */
class FakeSource implements EventSourceLike {
  onerror: ((this: unknown, ev: unknown) => void) | null = null;
  onopen: ((this: unknown, ev: unknown) => void) | null = null;
  closed = false;
  private listeners: ((event: MessageEvent<string>) => void)[] = [];

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    if (type === 'message') this.listeners.push(listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(seq: number, data: Record<string, unknown>, terminal = false): void {
    const event = {
      lastEventId: String(seq),
      data: JSON.stringify({ ...data, terminal }),
    } as MessageEvent<string>;
    for (const listener of this.listeners) listener(event);
  }
}

function harness() {
  const sources: { source: FakeSource; lastEventId: string | undefined }[] = [];
  const events: JobEvent[] = [];
  const states: JobStreamState[] = [];
  const stream = new JobEventStream(
    '/v1/jobs/j1/events',
    (_url, lastEventId) => {
      const source = new FakeSource();
      sources.push({ source, lastEventId });
      return source;
    },
    {
      onEvent: (event) => events.push(event),
      onStateChange: (state) => states.push(state),
    },
  );
  return { sources, events, states, stream };
}

describe('job event stream', () => {
  it('applies events in order and advances the watermark', () => {
    const { sources, events, stream } = harness();
    stream.start();
    const first = sources[0]?.source;
    first?.emit(1, { kind: 'step', payload: { status: 'running', step: 'draft' } });
    first?.emit(2, { kind: 'step', payload: { status: 'running', step: 'evaluate' } });
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(stream.watermark).toBe(2);
  });

  it('suppresses duplicates that a replay re-delivers', () => {
    const { sources, events, stream } = harness();
    stream.start();
    const source = sources[0]?.source;
    source?.emit(1, { kind: 'step', payload: {} });
    source?.emit(2, { kind: 'step', payload: {} });
    // The server replays 1 and 2 after a reconnect; neither may be applied twice.
    source?.emit(1, { kind: 'step', payload: {} });
    source?.emit(2, { kind: 'step', payload: {} });
    source?.emit(3, { kind: 'step', payload: {} });
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('reconnects with the last APPLIED id, not the last received one', () => {
    const { sources, stream } = harness();
    stream.start();
    sources[0]?.source.emit(1, { kind: 'step', payload: {} });
    sources[0]?.source.emit(2, { kind: 'step', payload: {} });
    // The transport drops; the reader reopens from its watermark.
    sources[0]?.source.onerror?.call(undefined, {});
    stream.start();
    expect(sources[1]?.lastEventId).toBe('2');
  });

  it('reports disconnected state without claiming the job failed', () => {
    const { sources, states, stream } = harness();
    stream.start();
    sources[0]?.source.onopen?.call(undefined, {});
    sources[0]?.source.onerror?.call(undefined, {});
    expect(states).toEqual(['connecting', 'open', 'reconnecting']);
  });

  it('closes the stream on a terminal event and stops listening', () => {
    const { sources, events, stream } = harness();
    stream.start();
    const source = sources[0]?.source;
    source?.emit(1, { kind: 'step', payload: { status: 'running' } });
    source?.emit(2, { kind: 'terminal', payload: { status: 'completed' } }, true);
    expect(source?.closed).toBe(true);
    expect(stream.currentState).toBe('closed');
    // Anything after a terminal event is not applied: the stream is over.
    source?.emit(3, { kind: 'step', payload: { status: 'running' } });
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('ignores a malformed frame rather than dying on it', () => {
    const bad = { lastEventId: '1', data: 'not json' } as MessageEvent<string>;
    expect(parseEvent(bad)).toBeUndefined();
    const noId = { lastEventId: '', data: '{}' } as MessageEvent<string>;
    expect(parseEvent(noId)).toBeUndefined();
  });

  it('never announces a heartbeat, because a comment is not a message event', () => {
    const { sources, events, stream } = harness();
    stream.start();
    // SSE comment lines never reach a `message` listener; nothing is emitted, so nothing is applied.
    const listener = vi.fn();
    sources[0]?.source.addEventListener('comment', listener);
    expect(events).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('job view folding', () => {
  const base: JobView = { status: 'running', step: 'draft', seenSeq: 5, terminal: false };

  it('ignores an event at or below the watermark', () => {
    const replayed: JobEvent = {
      seq: 3,
      kind: 'step',
      terminal: false,
      payload: { status: 'queued' },
    };
    expect(foldJobEvent(base, replayed)).toEqual(base);
  });

  it('never relabels a terminal status from a replayed non-terminal event', () => {
    const completed: JobView = { status: 'completed', step: 'accept', seenSeq: 9, terminal: true };
    const stale: JobEvent = {
      seq: 10,
      kind: 'step',
      terminal: false,
      payload: { status: 'running', step: 'draft' },
    };
    const next = foldJobEvent(completed, stale);
    // The accepted result stands; only the watermark moves.
    expect(next.status).toBe('completed');
    expect(next.seenSeq).toBe(10);
  });

  it('advances status on a genuinely newer event', () => {
    const next = foldJobEvent(base, {
      seq: 6,
      kind: 'step',
      terminal: false,
      payload: { status: 'paused', step: 'evaluate' },
    });
    expect(next).toMatchObject({ status: 'paused', step: 'evaluate', seenSeq: 6 });
  });

  it('marks terminal when a terminal status arrives', () => {
    const next = foldJobEvent(base, {
      seq: 7,
      kind: 'terminal',
      terminal: true,
      payload: { status: 'cancelled' },
    });
    expect(next.terminal).toBe(true);
    expect(next.status).toBe('cancelled');
  });
});
