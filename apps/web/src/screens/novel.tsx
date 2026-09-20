/**
 * Screen — New novel (the product's front door).
 *
 * One place where an operator describes the novel they want, reads the studio's story suggestions,
 * approves one, and watches the studio plan the full bible and write every chapter. Everything shown is
 * read back from the server's `novel_runs` row and event log, never from local memory of what was
 * clicked: a reload, another browser or a second operator sees the same state.
 *
 * Autopilot is the default; "one chapter at a time" pauses after each accepted chapter so an operator can
 * review before the next one is written. Pause/resume/cancel map to the run, and a cancel confirms.
 */
'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppState } from '../components/app-state';
import { ApiProblem, messageFor } from '../lib/api';
import { newIdempotencyKey, useMutation, useResource } from '../lib/use-resource';
import {
  AsyncRegion,
  ConfirmDialog,
  ErrorSummary,
  Field,
  Form,
  LiveRegion,
  StatusBadge,
  useConfirm,
  type StatusTone,
} from '../components/primitives';

export interface NovelRunView {
  readonly id: string;
  readonly status: string;
  readonly spec_version: number;
  readonly approved_concept_id: string | null;
  readonly target_chapters: number;
  readonly next_chapter: number;
  readonly auto_continue: boolean;
  readonly stop_after_chapter: number | null;
  readonly last_error: { code?: string; message?: string; step?: string } | null;
  readonly running: boolean;
}

export interface Suggestion {
  readonly id?: string | undefined;
  readonly candidate_id?: string | undefined;
  readonly status?: string | undefined;
  readonly angle?: string | undefined;
  readonly logline?: string | undefined;
  readonly story_promise?: string | undefined;
  readonly reader_fantasy?: string | undefined;
  readonly main_conflict?: string | undefined;
  readonly chapter_one_hook?: string | undefined;
  readonly ending_direction?: string | undefined;
  readonly progression_curve?: string | undefined;
  readonly differentiators?: readonly string[] | undefined;
  readonly risk_notes?: readonly string[] | undefined;
}

interface NovelStatus {
  readonly run: NovelRunView;
  readonly suggestions: readonly Suggestion[];
  readonly plan: {
    readonly target_chapters: number;
    readonly bible: {
      readonly characters: readonly { name: string; description: string | null }[];
      readonly locations: readonly { name: string }[];
      readonly organizations: readonly { name: string }[];
      readonly abilities: readonly { name: string }[];
      readonly propositions: number;
      readonly promises: readonly { statement: string; type: string; importance: string }[];
    } | null;
    readonly blueprint: {
      readonly story_promise: string | null;
      readonly main_conflict: string | null;
      readonly ending: { type?: string; summary?: string } | null;
      readonly seasons: readonly {
        ordinal: number;
        title: string;
        objective: string;
        chapters: { from: number; to: number };
      }[];
    } | null;
  } | null;
  readonly chapters: readonly { number: number; status: string; title: string | null }[];
  readonly accepted_chapters: number;
  readonly spend_cents: number;
}

interface FullBibleResponse {
  readonly bible: Readonly<Record<string, unknown>>;
  readonly blueprint: Readonly<Record<string, unknown>>;
}

export const GENRES = [
  'hunter-gate',
  'system-progression',
  'regression',
  'modern-fantasy',
  'murim',
  'romance-fantasy',
  'villainess',
  'academy',
  'possession',
  'reincarnation',
  'dungeon',
  'apocalypse-survival',
  'management',
  'idol-entertainment',
  'game-world',
  'comedy',
  'character-drama',
  'slow-burn-romance',
] as const;

export function runTone(status: string): StatusTone {
  if (status === 'failed' || status === 'cancelled') return 'bad';
  if (status === 'planning' || status === 'producing' || status === 'suggesting') return 'progress';
  if (status === 'awaiting_approval' || status === 'needs_attention' || status === 'paused')
    return 'attention';
  if (status === 'completed') return 'good';
  return 'neutral';
}

export function runStatusLabel(status: string): string {
  switch (status) {
    case 'intake':
      return 'waiting for details';
    case 'suggesting':
      return 'thinking of story directions';
    case 'awaiting_approval':
      return 'waiting for your approval';
    case 'planning':
      return 'building the story bible';
    case 'producing':
      return 'writing chapters';
    case 'needs_attention':
      return 'needs your attention';
    default:
      return status.replace(/_/g, ' ');
  }
}

const lines = (value: string): string[] =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

export function NovelScreen({ projectId }: { projectId: string }): ReactNode {
  const { api } = useAppState();
  const status = useResource<NovelStatus>(
    () => api.get(`/v1/projects/${projectId}/novel`),
    [projectId],
  );
  // A transient poll failure must not turn an already loaded run back into the intake form.
  const notStarted = !status.data && status.problem?.problem.code === 'NOT_FOUND';
  const active =
    status.data?.run.status === 'planning' ||
    status.data?.run.status === 'producing' ||
    status.data?.run.status === 'suggesting';
  // Poll only while the studio is working; a resting run changes only when someone acts on it.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      status.reload();
    }, 4000);
    return () => {
      clearInterval(t);
    };
  }, [active, status.reload]);

  return (
    <section aria-labelledby="novel-heading">
      <h1 id="novel-heading">New novel</h1>
      {notStarted || (!status.loading && !status.data && !status.error) ? (
        <IntakeForm
          key={projectId}
          projectId={projectId}
          onStarted={() => {
            status.reload();
          }}
        />
      ) : (
        <AsyncRegion
          // Polling should refresh the existing run in place, not replace it with a loading/error
          // placeholder while a request is in flight or a transient request fails.
          loading={status.loading && !status.data}
          error={status.error && !status.data ? status.error : undefined}
          empty={false}
          emptyMessage=""
          label="novel run"
        >
          {status.data ? (
            <RunPanel
              key={projectId}
              projectId={projectId}
              data={status.data}
              onChanged={() => {
                status.reload();
              }}
            />
          ) : null}
        </AsyncRegion>
      )}
    </section>
  );
}

export function IntakeForm({
  projectId,
  onStarted,
}: {
  projectId: string;
  onStarted: () => void;
}): ReactNode {
  const { api, can } = useAppState();
  const start = useMutation();
  const intakeKey = useRef<string | undefined>(undefined);
  const intakeFingerprint = useRef<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [premise, setPremise] = useState('');
  const [genre, setGenre] = useState<string>('hunter-gate');
  const [secondary, setSecondary] = useState('');
  const [mainName, setMainName] = useState('');
  const [mainDescription, setMainDescription] = useState('');
  const [supporting, setSupporting] = useState('');
  const [world, setWorld] = useState('');
  const [tropes, setTropes] = useState('');
  const [forbidden, setForbidden] = useState('');
  const [mandatory, setMandatory] = useState('');
  const [restrictions, setRestrictions] = useState('');
  const [progression, setProgression] = useState('');
  const [romance, setRomance] = useState<'none' | 'subplot' | 'main'>('none');
  const [ending, setEnding] = useState<'happy' | 'bittersweet' | 'open' | 'tragic' | 'unspecified'>(
    'unspecified',
  );
  const [rating, setRating] = useState<'all' | '12' | '15' | '19'>('15');
  const [pace, setPace] = useState<'fast' | 'medium' | 'slow'>('fast');
  const [chapters, setChapters] = useState('30');
  const [words, setWords] = useState('2500');
  const [tone, setTone] = useState('');
  const [announcement, setAnnouncement] = useState('');

  if (!can('editor'))
    return <p className="note">Starting a novel requires the editor role in this workspace.</p>;

  const submit = () => {
    start.run(async () => {
      const intake: Record<string, unknown> = {
        title_working: title.trim(),
        premise: premise.trim(),
        genre: {
          primary: genre,
          ...(secondary ? { secondary: [secondary] } : {}),
        },
        ...(mainName.trim()
          ? {
              main_character: {
                name: mainName.trim(),
                ...(mainDescription.trim() ? { description: mainDescription.trim() } : {}),
              },
            }
          : {}),
        ...(lines(supporting).length
          ? {
              supporting_characters: lines(supporting).map((l) => {
                const [name, ...rest] = l.split(/\s[—–-]\s|:\s/);
                return {
                  name: (name ?? l).trim(),
                  ...(rest.length ? { description: rest.join(' ').trim() } : {}),
                };
              }),
            }
          : {}),
        ...(world.trim() ? { world_concept: world.trim() } : {}),
        ...(lines(tropes).length ? { desired_tropes: lines(tropes) } : {}),
        ...(lines(forbidden).length ? { forbidden_developments: lines(forbidden) } : {}),
        ...(lines(mandatory).length
          ? { mandatory_scenes: lines(mandatory).map((description) => ({ description })) }
          : {}),
        ...(lines(restrictions).length ? { content_restrictions: lines(restrictions) } : {}),
        ...(progression.trim() ? { progression_system: progression.trim() } : {}),
        romance: { presence: romance },
        ending_preference: ending,
        target_audience: { rating },
        tone: { pace, ...(lines(tone).length ? { keywords: lines(tone) } : {}) },
        target_chapters: Number(chapters),
        target_words_per_chapter: Number(words),
        operating_mode: 'autopilot',
      };
      const fingerprint = JSON.stringify(intake);
      if (intakeFingerprint.current !== fingerprint) {
        intakeKey.current = newIdempotencyKey();
        intakeFingerprint.current = fingerprint;
      }
      await api.post(`/v1/projects/${projectId}/novel`, { intake }, intakeKey.current);
      intakeKey.current = undefined;
      intakeFingerprint.current = undefined;
      setAnnouncement('Story suggestions are ready for review.');
      onStarted();
    });
  };

  return (
    <section aria-labelledby="intake-heading">
      <h2 id="intake-heading">Describe the novel you want</h2>
      <p className="note">
        The studio interprets these details into a story specification, proposes a few story
        directions, and — once you approve one — builds the complete story bible (cast, world,
        progression system, series blueprint) before writing a single chapter.
      </p>
      <LiveRegion message={announcement} />
      {start.error ? (
        <ErrorSummary
          title={
            start.problem?.problem.code === 'NO_PROVIDER'
              ? 'No model provider is configured'
              : 'Could not start the novel'
          }
          message={start.error}
        />
      ) : null}
      <Form label="Start a novel" onSubmit={submit}>
        <Field path="novel-title" label="Working title">
          {(p) => (
            <input
              {...p}
              required
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          )}
        </Field>
        <Field
          path="novel-premise"
          label="Premise"
          hint="Two to five sentences. Any language; the manuscript is always English."
        >
          {(p) => (
            <textarea
              {...p}
              required
              minLength={20}
              rows={5}
              value={premise}
              onChange={(e) => {
                setPremise(e.target.value);
              }}
            />
          )}
        </Field>
        <Field path="novel-genre" label="Primary genre">
          {(p) => (
            <select
              {...p}
              value={genre}
              onChange={(e) => {
                setGenre(e.target.value);
              }}
            >
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field path="novel-secondary" label="Secondary genre (optional)">
          {(p) => (
            <select
              {...p}
              value={secondary}
              onChange={(e) => {
                setSecondary(e.target.value);
              }}
            >
              <option value="">none</option>
              {GENRES.filter((g) => g !== genre).map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field path="novel-chapters" label="Number of chapters">
          {(p) => (
            <input
              {...p}
              type="number"
              min={1}
              max={5000}
              required
              value={chapters}
              onChange={(e) => {
                setChapters(e.target.value);
              }}
            />
          )}
        </Field>
        <Field path="novel-words" label="Words per chapter">
          {(p) => (
            <input
              {...p}
              type="number"
              min={500}
              max={8000}
              required
              value={words}
              onChange={(e) => {
                setWords(e.target.value);
              }}
            />
          )}
        </Field>
        <Field path="novel-main-name" label="Main character name (optional)">
          {(p) => (
            <input
              {...p}
              value={mainName}
              onChange={(e) => {
                setMainName(e.target.value);
              }}
            />
          )}
        </Field>
        <Field path="novel-main-desc" label="Main character notes (optional)">
          {(p) => (
            <textarea
              {...p}
              rows={2}
              value={mainDescription}
              onChange={(e) => {
                setMainDescription(e.target.value);
              }}
            />
          )}
        </Field>
        <Field
          path="novel-supporting"
          label="Supporting characters (optional)"
          hint="One per line: Name — notes"
        >
          {(p) => (
            <textarea
              {...p}
              rows={3}
              value={supporting}
              onChange={(e) => {
                setSupporting(e.target.value);
              }}
            />
          )}
        </Field>
        <Field path="novel-world" label="World concept (optional)">
          {(p) => (
            <textarea
              {...p}
              rows={3}
              value={world}
              onChange={(e) => {
                setWorld(e.target.value);
              }}
            />
          )}
        </Field>
        <Field path="novel-progression" label="Progression / power system (optional)">
          {(p) => (
            <textarea
              {...p}
              rows={2}
              value={progression}
              onChange={(e) => {
                setProgression(e.target.value);
              }}
            />
          )}
        </Field>
        <Field path="novel-tropes" label="Desired tropes (optional)" hint="One per line">
          {(p) => (
            <textarea
              {...p}
              rows={3}
              value={tropes}
              onChange={(e) => {
                setTropes(e.target.value);
              }}
            />
          )}
        </Field>
        <Field
          path="novel-forbidden"
          label="Forbidden developments (optional)"
          hint="One per line. Each becomes a hard rule every plan and chapter must obey."
        >
          {(p) => (
            <textarea
              {...p}
              rows={3}
              value={forbidden}
              onChange={(e) => {
                setForbidden(e.target.value);
              }}
            />
          )}
        </Field>
        <Field path="novel-mandatory" label="Mandatory scenes (optional)" hint="One per line">
          {(p) => (
            <textarea
              {...p}
              rows={2}
              value={mandatory}
              onChange={(e) => {
                setMandatory(e.target.value);
              }}
            />
          )}
        </Field>
        <Field
          path="novel-restrictions"
          label="Content restrictions (optional)"
          hint="One per line"
        >
          {(p) => (
            <textarea
              {...p}
              rows={2}
              value={restrictions}
              onChange={(e) => {
                setRestrictions(e.target.value);
              }}
            />
          )}
        </Field>
        <Field path="novel-tone" label="Tone keywords (optional)" hint="One per line">
          {(p) => (
            <textarea
              {...p}
              rows={2}
              value={tone}
              onChange={(e) => {
                setTone(e.target.value);
              }}
            />
          )}
        </Field>
        <Field path="novel-pace" label="Pace">
          {(p) => (
            <select
              {...p}
              value={pace}
              onChange={(e) => {
                setPace(e.target.value as typeof pace);
              }}
            >
              <option value="fast">fast</option>
              <option value="medium">medium</option>
              <option value="slow">slow</option>
            </select>
          )}
        </Field>
        <Field path="novel-romance" label="Romance">
          {(p) => (
            <select
              {...p}
              value={romance}
              onChange={(e) => {
                setRomance(e.target.value as typeof romance);
              }}
            >
              <option value="none">none</option>
              <option value="subplot">subplot</option>
              <option value="main">main plot</option>
            </select>
          )}
        </Field>
        <Field path="novel-ending" label="Ending">
          {(p) => (
            <select
              {...p}
              value={ending}
              onChange={(e) => {
                setEnding(e.target.value as typeof ending);
              }}
            >
              <option value="unspecified">let the studio decide</option>
              <option value="happy">happy</option>
              <option value="bittersweet">bittersweet</option>
              <option value="open">open</option>
              <option value="tragic">tragic</option>
            </select>
          )}
        </Field>
        <Field path="novel-rating" label="Audience rating">
          {(p) => (
            <select
              {...p}
              value={rating}
              onChange={(e) => {
                setRating(e.target.value as typeof rating);
              }}
            >
              <option value="all">all</option>
              <option value="12">12+</option>
              <option value="15">15+</option>
              <option value="19">19+</option>
            </select>
          )}
        </Field>
        <button type="submit" disabled={start.busy}>
          {start.busy ? 'Thinking of story directions…' : 'Get story suggestions'}
        </button>
      </Form>
    </section>
  );
}

function RunPanel({
  projectId,
  data,
  onChanged,
}: {
  projectId: string;
  data: NovelStatus;
  onChanged: () => void;
}): ReactNode {
  const { api, can } = useAppState();
  const act = useMutation();
  const approvalKeys = useRef(new Map<string, { key: string; fingerprint: string }>());
  const confirm = useConfirm();
  const [announcement, setAnnouncement] = useState('');
  const [fullBible, setFullBible] = useState<FullBibleResponse | undefined>(undefined);
  const [fullBibleLoading, setFullBibleLoading] = useState(false);
  const [fullBibleError, setFullBibleError] = useState<string | undefined>(undefined);
  const [autoContinue, setAutoContinue] = useState(true);
  const run = data.run;
  const accepted = data.accepted_chapters;
  const percent = Math.round((accepted / Math.max(1, run.target_chapters)) * 100);

  const loadFullBible = async () => {
    setFullBibleLoading(true);
    setFullBibleError(undefined);
    try {
      setFullBible(await api.get<FullBibleResponse>(`/v1/projects/${projectId}/novel/bible`));
    } catch (error) {
      setFullBibleError(
        error instanceof ApiProblem
          ? messageFor(error.problem)
          : 'Unable to load the full story bible.',
      );
    } finally {
      setFullBibleLoading(false);
    }
  };

  const downloadFullBible = () => {
    if (!fullBible) return;
    const blob = new Blob([JSON.stringify(fullBible, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `story-bible-${projectId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const control = (action: 'pause' | 'resume' | 'cancel') => {
    act.run(async () => {
      await api.post(`/v1/projects/${projectId}/novel/${action}`, {}, newIdempotencyKey());
      setAnnouncement(`Run ${action} requested.`);
      onChanged();
    });
  };

  return (
    <section aria-labelledby="run-heading">
      <h2 id="run-heading">
        Novel run{' '}
        <StatusBadge
          label={runStatusLabel(run.status)}
          tone={runTone(run.status)}
          {...(run.running ? { detail: 'working now' } : {})}
        />
      </h2>
      <LiveRegion message={announcement} />
      <ConfirmDialog
        open={confirm.open}
        title="Cancel this novel run?"
        impact={<p>Accepted chapters and canon are kept; nothing further will be written.</p>}
        confirmLabel="Cancel the run"
        onCancel={() => {
          confirm.resolve(false);
        }}
        onConfirm={() => {
          confirm.resolve(true, () => {
            control('cancel');
          });
        }}
      />
      {act.error ? <ErrorSummary message={act.error} /> : null}
      {run.last_error ? (
        <ErrorSummary
          title={`Stopped at ${run.last_error.step ?? 'a step'} (${run.last_error.code ?? 'error'})`}
          message={
            run.last_error.message ?? 'The run stopped. Resume to retry from the last checkpoint.'
          }
        />
      ) : null}

      <dl className="kv">
        <dt>Chapters accepted</dt>
        <dd>
          {accepted} / {run.target_chapters}
          <progress
            aria-label="chapters accepted"
            value={accepted}
            max={run.target_chapters}
          />{' '}
          {percent}%
        </dd>
        <dt>Next chapter</dt>
        <dd>{run.next_chapter > run.target_chapters ? 'done' : run.next_chapter}</dd>
        <dt>Mode</dt>
        <dd>{run.auto_continue ? 'autopilot (write every chapter)' : 'one chapter at a time'}</dd>
        <dt>Spend so far</dt>
        <dd>${(data.spend_cents / 100).toFixed(2)}</dd>
      </dl>

      {data.plan ? (
        <section aria-labelledby="full-bible-heading">
          <h3 id="full-bible-heading">Full story bible</h3>
          <p className="note">
            The complete cast, world, progression design, entities, propositions, promises, and
            commits are loaded only when requested so normal run polling stays small.
          </p>
          <button type="button" onClick={() => void loadFullBible()} disabled={fullBibleLoading}>
            {fullBibleLoading ? 'Loading full story bible…' : 'Load full story bible'}
          </button>
          {fullBibleError ? <ErrorSummary message={fullBibleError} /> : null}
          {fullBible ? (
            <>
              <button type="button" onClick={downloadFullBible}>
                Download full story bible (JSON)
              </button>
              <details open>
                <summary>Inspect full story bible and series blueprint</summary>
                <pre>{JSON.stringify(fullBible, null, 2)}</pre>
              </details>
            </>
          ) : null}
        </section>
      ) : null}

      {run.status === 'awaiting_approval' ? (
        <section aria-labelledby="suggestions-heading">
          <h3 id="suggestions-heading">Story suggestions — pick one to approve</h3>
          {can('editor') ? (
            <p className="field">
              <label>
                <input
                  type="checkbox"
                  checked={autoContinue}
                  onChange={(e) => {
                    setAutoContinue(e.target.checked);
                  }}
                />{' '}
                Write every chapter automatically (autopilot). Untick to pause after each accepted
                chapter.
              </label>
            </p>
          ) : null}
          <ul className="compare-grid">
            {data.suggestions.map((s, i) => (
              <li key={s.id ?? s.candidate_id ?? String(i)} data-status={s.status ?? 'candidate'}>
                <article aria-labelledby={`suggestion-${i}`}>
                  <h4 id={`suggestion-${i}`}>
                    Direction {i + 1}
                    {s.angle ? <span className="note"> — {s.angle}</span> : null}
                  </h4>
                  <p>
                    <strong>{s.logline}</strong>
                  </p>
                  <dl className="kv">
                    {s.story_promise ? (
                      <>
                        <dt>Story promise</dt>
                        <dd>{s.story_promise}</dd>
                      </>
                    ) : null}
                    {s.reader_fantasy ? (
                      <>
                        <dt>Reader fantasy</dt>
                        <dd>{s.reader_fantasy}</dd>
                      </>
                    ) : null}
                    {s.main_conflict ? (
                      <>
                        <dt>Main conflict</dt>
                        <dd>{s.main_conflict}</dd>
                      </>
                    ) : null}
                    {s.chapter_one_hook ? (
                      <>
                        <dt>Chapter one hook</dt>
                        <dd>{s.chapter_one_hook}</dd>
                      </>
                    ) : null}
                    {s.ending_direction ? (
                      <>
                        <dt>Ending direction</dt>
                        <dd>{s.ending_direction}</dd>
                      </>
                    ) : null}
                    {s.progression_curve ? (
                      <>
                        <dt>Progression</dt>
                        <dd>{s.progression_curve}</dd>
                      </>
                    ) : null}
                  </dl>
                  {s.differentiators?.length ? (
                    <p className="note">What makes it different: {s.differentiators.join('; ')}</p>
                  ) : null}
                  {s.risk_notes?.length ? (
                    <p className="note">Risks: {s.risk_notes.join('; ')}</p>
                  ) : null}
                  {can('editor') ? (
                    <button
                      type="button"
                      disabled={act.busy}
                      onClick={() => {
                        const conceptId = s.id ?? s.candidate_id;
                        if (!conceptId) return;
                        act.run(async () => {
                          const body = { concept_id: conceptId, auto_continue: autoContinue };
                          const fingerprint = JSON.stringify(body);
                          const previous = approvalKeys.current.get(conceptId);
                          const key =
                            previous?.fingerprint === fingerprint
                              ? previous.key
                              : newIdempotencyKey();
                          approvalKeys.current.set(conceptId, { key, fingerprint });
                          await api.post(`/v1/projects/${projectId}/novel/approve`, body, key);
                          approvalKeys.current.delete(conceptId);
                          setAnnouncement(
                            `Direction ${i + 1} approved. The studio is building the story bible.`,
                          );
                          onChanged();
                        });
                      }}
                    >
                      Approve direction {i + 1} and start writing
                    </button>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.plan ? (
        <section aria-labelledby="bible-heading">
          <h3 id="bible-heading">Story bible</h3>
          {data.plan.blueprint ? (
            <dl className="kv">
              <dt>Story promise</dt>
              <dd>{data.plan.blueprint.story_promise}</dd>
              <dt>Main conflict</dt>
              <dd>{data.plan.blueprint.main_conflict}</dd>
              <dt>Ending</dt>
              <dd>
                {data.plan.blueprint.ending?.type ?? '—'}
                {data.plan.blueprint.ending?.summary
                  ? ` — ${data.plan.blueprint.ending.summary}`
                  : ''}
              </dd>
            </dl>
          ) : null}
          {data.plan.blueprint?.seasons.length ? (
            <>
              <h4>Seasons</h4>
              <ol>
                {data.plan.blueprint.seasons.map((s) => (
                  <li key={s.ordinal}>
                    <strong>{s.title}</strong> (ch. {s.chapters.from}–{s.chapters.to}):{' '}
                    {s.objective}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
          {data.plan.bible ? (
            <>
              <h4>Cast ({data.plan.bible.characters.length})</h4>
              <ul className="card-list">
                {data.plan.bible.characters.map((c) => (
                  <li key={c.name}>
                    <strong>{c.name}</strong>
                    {c.description ? ` — ${c.description}` : ''}
                  </li>
                ))}
              </ul>
              <p className="note">
                {data.plan.bible.locations.length} locations ·{' '}
                {data.plan.bible.organizations.length} organizations ·{' '}
                {data.plan.bible.abilities.length} abilities · {data.plan.bible.propositions}{' '}
                propositions · {data.plan.bible.promises.length} promises
              </p>
              {data.plan.bible.promises.length ? (
                <>
                  <h4>Promises the series owes</h4>
                  <ul>
                    {data.plan.bible.promises.map((p) => (
                      <li key={p.statement}>
                        {p.statement} <StatusBadge label={p.type} detail={p.importance} />
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {data.chapters.length ? (
        <section aria-labelledby="chapters-progress-heading">
          <h3 id="chapters-progress-heading">Chapters</h3>
          <table>
            <caption>Chapter progress</caption>
            <thead>
              <tr>
                <th scope="col">Chapter</th>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.chapters.map((c) => (
                <tr key={c.number}>
                  <th scope="row">{c.number}</th>
                  <td>{c.title ?? '—'}</td>
                  <td>
                    <StatusBadge
                      label={c.status}
                      tone={c.status === 'accepted' ? 'good' : 'progress'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {can('editor') ? (
        <p className="actions">
          {run.status === 'planning' || run.status === 'producing' ? (
            <button
              type="button"
              disabled={act.busy}
              onClick={() => {
                control('pause');
              }}
            >
              Pause after the current step
            </button>
          ) : null}
          {run.status === 'paused' ||
          run.status === 'needs_attention' ||
          run.status === 'failed' ? (
            <button
              type="button"
              disabled={act.busy}
              onClick={() => {
                control('resume');
              }}
            >
              Resume from the last checkpoint
            </button>
          ) : null}
          {can('owner') && !['completed', 'cancelled'].includes(run.status) ? (
            <button
              type="button"
              disabled={act.busy}
              onClick={(event) => {
                confirm.request(event.currentTarget);
              }}
            >
              Cancel run
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
