/**
 * Deterministic 120-chapter replay fixture (B-4-1, deterministic portion).
 *
 * The long-form hardening harness needs 120 sequential chapters that exercise the REAL chapter-production
 * loop — the same `produceChapter`, the same packs, the same approval/extraction/acceptance path — without
 * checking 120 manuscripts into Git and without a single live provider call. So the recordings are
 * GENERATED here from a compact deterministic seed: a pure function of the chapter number over the fixture
 * story bible that already lives in `examples/fixture/`. Nothing here is random, clock-dependent or
 * machine-dependent, so two runs of the generator produce byte-identical recordings.
 *
 * "Compressed" refers to prose length only. Every chapter still goes through the contract, the scene plan,
 * sequential scene drafts, the deterministic checks, all six replayed evaluators, the approval lock,
 * extraction, the atomic acceptance commit, the L1 summary, accepted-only indexing and dependency edges.
 *
 * Long-range continuity is built into the seed rather than bolted on, so the 120 cycles are one story and
 * not 120 unrelated iterations:
 *   * a porter-share fact asserted in chapter 1 and SUPERSEDED at chapters 21/41/61/81/101, each supersede
 *     citing the canon id the previous one created (an unbroken 6-link chain across 120 chapters);
 *   * three promises opened in chapter 1 and paid at chapters 3, 60 and 120 — the last one 119 chapters
 *     after its setup;
 *   * a relationship state asserted in chapter 2 and superseded in chapter 119.
 * A chapter that failed to read its predecessor's accepted canon could not produce any of these.
 */
import { createHash } from 'node:crypto';
import { codePointLength, countWords, segmentParagraphs, toNfcText } from '@yeonjae/prose';
import { type Recording } from '@yeonjae/gateway';
import { BIBLE, IDENTITY_VERSION, IDS } from './testkit.js';

export const LONGFORM_CHAPTERS = 120;

/** The porter share is renegotiated every 20 chapters; chapter 1 asserts it, each boundary supersedes it. */
const SHARE_PERIOD = 20;
const SHARE_BASE = 5;

const DOYOON = IDS.doyoon ?? '';
const MUJIN = IDS.mujin ?? '';
const HALL = IDS.hall ?? '';
const MAPO = IDS.mapo_gate3 ?? '';
const ASSOCIATION = IDS.association ?? '';
const PROMISE_GATE_RUN = IDS.promise_gate_run ?? '';
const PROMISE_COMPASS = IDS.promise_compass ?? '';
const PROMISE_WATCHER = IDS.promise_watcher ?? '';

/** Chapters at which each long-range promise is paid. Setup is always chapter 1. */
export const LONGFORM_PROMISE_PAYOFFS = {
  gateRun: 3,
  compass: 60,
  watcher: LONGFORM_CHAPTERS,
} as const;
export const LONGFORM_PROMISE_ADVANCES = { compass: 30, watcher: 60 } as const;
/** Chapter 2 asserts the mentor→porter relationship state; chapter 119 supersedes it. */
export const LONGFORM_RELATIONSHIP = { assertedAt: 2, supersededAt: 119 } as const;

export function longformShare(chapterNo: number): number {
  return SHARE_BASE + Math.floor((chapterNo - 1) / SHARE_PERIOD);
}

/** The chapter whose commit created the share fact that is current at `chapterNo`. */
export function longformShareAnchor(chapterNo: number): number {
  return SHARE_PERIOD * Math.floor((chapterNo - 1) / SHARE_PERIOD) + 1;
}

export function longformShareFactLocalId(chapterNo: number): string {
  const anchor = longformShareAnchor(chapterNo);
  return anchor === 1 ? 'f-share' : `f-share-${anchor}`;
}

/** Chapters that write the share fact: 1 asserts it, 21/41/61/81/101 supersede their predecessor. */
export function longformShareChapters(): number[] {
  const out: number[] = [];
  for (let k = 1; k <= LONGFORM_CHAPTERS; k++) if (longformShareAnchor(k) === k) out.push(k);
  return out;
}

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

function shareWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** Deterministic content-addressed UUIDv8, so chapter ids are stable without a fixture file of 120 ids. */
function seededUuid(seed: string): string {
  const b = Buffer.from(
    createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 32),
    'hex',
  );
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x80;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function longformContractId(chapterNo: number): string {
  return seededUuid(`yeonjae:longform:contract:${chapterNo}`);
}

// ---------------------------------------------------------------------------------------------------------
// prose
// ---------------------------------------------------------------------------------------------------------

/**
 * The line that records this chapter's position in the long-range ledger. Every promise transition and the
 * relationship change cite it as evidence, so the milestone is provable from the accepted manuscript rather
 * than asserted by the harness.
 */
function ledgerLine(k: number): string {
  if (k === 1)
    return 'Do-yoon opened three debts on the first morning: the gate run, the old compass, and the name of the Watcher.';
  if (k === 2)
    return 'Do-yoon carried for Mu-jin a second time, and the old man began to trust the porter who guessed corridors.';
  if (k === LONGFORM_PROMISE_PAYOFFS.gateRun)
    return 'The gate run debt came due on the third morning, and Mu-jin walked out of Mapo Gate 3 on both legs.';
  if (k === LONGFORM_PROMISE_ADVANCES.compass)
    return 'The old compass moved for the first time in thirty days, and the debt from the first morning came closer.';
  if (k === LONGFORM_PROMISE_PAYOFFS.compass)
    return 'The old compass pointed at a hidden door on day sixty, the first-morning debt was paid, and the Watcher question moved one step.';
  if (k === LONGFORM_RELATIONSHIP.supersededAt)
    return 'Mu-jin stopped calling him kid on day one hundred and nineteen, and called him a partner instead.';
  if (k === LONGFORM_PROMISE_PAYOFFS.watcher)
    return 'On day one hundred and twenty the name of the Watcher was spoken aloud, and the last debt from the first morning was paid.';
  return `Do-yoon wrote the count down on day ${k} and carried it forward to the next morning.`;
}

function openingLine(k: number): string {
  return `Day ${k} at the Association hall began with the duty board and a list of names that Kang Do-yoon already knew by heart.`;
}

function shareLine(k: number): string {
  const share = shareWord(longformShare(k));
  return `“Porter Kang,” Park Mu-jin said. “You are carrying at ${share} percent today, and the survey office still wants a word with you.”`;
}

function sceneOneText(k: number): string {
  return [
    openingLine(k),
    shareLine(k),
    'Do-yoon read the board twice. The compass in his coat was cold, and the question of the Watcher was still a question he could not ask out loud.',
  ].join('\n\n');
}

function sceneTwoText(k: number): string {
  return [
    'In the yard Park Mu-jin counted the cores from the run and set two of them aside for the porter who had carried them.',
    '“You told me once to take the right corridor,” he said. “I have not forgotten it, and neither has the survey office.”',
    ledgerLine(k),
  ].join('\n\n');
}

export function longformSceneTexts(k: number): readonly string[] {
  return [sceneOneText(k), sceneTwoText(k)];
}

/** Exactly what `assembleChapter` will produce for this chapter: scenes trimmed and joined by a blank line. */
export function longformChapterText(k: number): string {
  return toNfcText(
    longformSceneTexts(k)
      .map((t) => t.trim())
      .join('\n\n'),
  ).text;
}

/** The verbatim ending hook: the last sentence of the chapter, which the L1 summary must reproduce exactly. */
export function longformEndingHook(k: number): string {
  return ledgerLine(k);
}

// ---------------------------------------------------------------------------------------------------------
// evidence spans
// ---------------------------------------------------------------------------------------------------------

interface Span {
  readonly paragraph_id: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

function utf16ToCodePoint(text: string, utf16Index: number): number {
  let cp = 0;
  for (let i = 0; i < utf16Index;) {
    const code = text.codePointAt(i);
    i += code !== undefined && code > 0xffff ? 2 : 1;
    cp++;
  }
  return cp;
}

/** Locate a quote in the assembled chapter as a code-point span. The quote must occur exactly once. */
function spanOf(chapterText: string, quote: string, chapterNo: number): Span {
  const first = chapterText.indexOf(quote);
  if (first < 0)
    throw new Error(
      `longform fixture: chapter ${chapterNo} evidence quote is not present in the text`,
    );
  if (chapterText.includes(quote, first + 1))
    throw new Error(
      `longform fixture: chapter ${chapterNo} evidence quote is ambiguous (occurs twice)`,
    );
  const start = utf16ToCodePoint(chapterText, first);
  const end = start + codePointLength(quote);
  const paragraph = segmentParagraphs(toNfcText(chapterText)).find(
    (p) => p.start <= start && end <= p.end,
  );
  if (!paragraph)
    throw new Error(
      `longform fixture: chapter ${chapterNo} evidence quote crosses a paragraph boundary`,
    );
  return { paragraph_id: paragraph.id, start, end, quote };
}

function evidence(chapterNo: number, span: Span) {
  return [
    {
      manuscript_version_id: `{{version.${chapterNo}.approved}}`,
      chapter_no: chapterNo,
      paragraph_id: span.paragraph_id,
      start: span.start,
      end: span.end,
      quote: span.quote,
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------
// recordings
// ---------------------------------------------------------------------------------------------------------

function clock(chapterNo: number, ordinal: number) {
  return {
    chapter_no: chapterNo,
    ordinal,
    precision: 'exact',
    calendar: 'relative_days',
    world_date: `D+${chapterNo - 1}`,
  };
}

function contractRecording(k: number, chapterWords: number): Recording {
  const share = shareWord(longformShare(k));
  return {
    json: {
      // The gateway validates the raw structured output against chapter-contract.schema.json before the
      // workflow overwrites the envelope fields, so a recording must be a complete contract, not a patch.
      id: longformContractId(k),
      project_id: '{{project}}',
      chapter_number: k,
      arc_id: LONGFORM_IDS.arcId,
      season_id: LONGFORM_IDS.seasonId,
      timeline_id: '{{main_timeline}}',
      status: 'draft',
      pinned: {
        spec_version: '{{int:spec_version}}',
        bible_version: 1,
        narrative_identity_version_id: IDENTITY_VERSION,
        canon_version: '{{int:canon_version}}',
        template_version: 'pack.chapter_planner@1.0.0',
      },
      narrative_identity_version_id: IDENTITY_VERSION,
      active_constraints_ref: {
        id: `{{acs.${k}.id}}`,
        content_hash: `{{acs.${k}.hash}}`,
        token_count: `{{int:acs.${k}.tokens}}`,
      },
      version: 1,
      beat_refs: ['arc1.beat.01'],
      purpose: `Day ${k} of the quiet campaign: Do-yoon carries at ${share} percent, keeps the regression unspoken, and moves the long ledger one line.`,
      must_happen: [
        {
          id: 'MH-1',
          kind: 'event',
          description: 'Do-yoon reads the duty board and carries for Park Mu-jin.',
          entity_ids: [DOYOON, MUJIN],
          verifiable_by: 'extraction',
        },
      ],
      must_not_happen: [
        {
          id: 'MN-1',
          description: 'Do-yoon stating or admitting the regression.',
          source: 'spec',
          requirement_id: 'REQ-021',
          lexical_patterns: ['\\bI am a regressor\\b', '\\bI lived this before\\b'],
        },
      ],
      pov: { character_id: DOYOON, person: 'third_limited' },
      participants: [
        { character_id: DOYOON, role_in_chapter: 'protagonist', on_page: true },
        { character_id: MUJIN, role_in_chapter: 'mentor', on_page: true },
      ],
      locations: [HALL],
      story_time: {
        start: clock(k, 0),
        end: clock(k, 999),
        elapsed_since_previous: k === 1 ? 'Day zero.' : 'The following morning.',
      },
      knowledge_deltas: [],
      state_deltas: [
        {
          entity_id: DOYOON,
          attribute: 'porter.share',
          from: `${longformShare(Math.max(1, k - 1))} percent`,
          to: `${longformShare(k)} percent`,
          when_in_chapter: 'early',
        },
      ],
      relationship_deltas: [],
      setups:
        k === 1
          ? [
              {
                promise_id: PROMISE_GATE_RUN,
                kind: 'open',
                how: 'The gate run is named as a debt.',
              },
              {
                promise_id: PROMISE_COMPASS,
                kind: 'open',
                how: 'The old compass is named as a debt.',
              },
              { promise_id: PROMISE_WATCHER, kind: 'open', how: 'The Watcher is named as a debt.' },
            ]
          : [],
      payoffs: payoffTouches(k),
      emotional_movement: { start: 'A counted morning', end: 'A counted evening' },
      conflict: {
        type: 'internal',
        description: 'Foreknowledge is an asset that spends itself every time it is used.',
      },
      local_satisfaction: [
        { type: 'growth_confirmed', description: 'The porter is trusted with one more thing.' },
      ],
      ending_state: `Carrying at ${share} percent, with the ledger one line longer.`,
      hook: { type: 'reveal', description: 'The ledger line the next morning inherits.' },
      opening: {
        type: k === 1 ? 'in_medias_res' : 'continue_cliffhanger',
        description: 'The duty board.',
      },
      scene_count: 2,
      dialogue_density_target: 0.4,
      length_target: { unit: 'words', value: chapterWords, tolerance_ratio: 0.12 },
      continuity_risks: [
        {
          description: `Do-yoon's porter share is ${longformShare(k)}% as of chapter ${k}. Mu-jin says “kid”/“Kang”; Do-yoon says “Mister Park”.`,
        },
      ],
      continuity_anchors:
        k === 1
          ? []
          : [
              {
                fact_id: `{{canon.${longformShareFactLocalId(k - 1)}}}`,
                statement: `Kang Do-yoon's porter share is ${longformShare(k - 1)} percent as of chapter ${k - 1}.`,
              },
            ],
      knowledge_guards: [
        { character_id: MUJIN, must_not_know_proposition_ids: ['{{proposition.P1}}'] },
      ],
      acceptance_criteria: [
        {
          id: 'AC-LANG',
          kind: 'deterministic',
          description: 'Manuscript is English',
          check_ref: 'EP-LANG-01',
          threshold: 0.99,
        },
        {
          id: 'AC-MH-1',
          kind: 'judge',
          description: 'Do-yoon carries for Park Mu-jin',
          check_ref: 'contract_checker:MH-1',
        },
      ],
    },
    modelId: 'replay-model',
    usage: { input: 400, output: 200, cached: 0 },
  };
}

function payoffTouches(k: number) {
  const out: { promise_id: string; how: string; kind: 'advance' | 'pay' }[] = [];
  if (k === LONGFORM_PROMISE_PAYOFFS.gateRun)
    out.push({ promise_id: PROMISE_GATE_RUN, how: 'Mu-jin survives the run.', kind: 'pay' });
  if (k === LONGFORM_PROMISE_ADVANCES.compass)
    out.push({ promise_id: PROMISE_COMPASS, how: 'The compass moves.', kind: 'advance' });
  if (k === LONGFORM_PROMISE_PAYOFFS.compass)
    out.push({ promise_id: PROMISE_COMPASS, how: 'The compass finds the door.', kind: 'pay' });
  if (k === LONGFORM_PROMISE_ADVANCES.watcher)
    out.push({ promise_id: PROMISE_WATCHER, how: 'One step closer to the name.', kind: 'advance' });
  if (k === LONGFORM_PROMISE_PAYOFFS.watcher)
    out.push({ promise_id: PROMISE_WATCHER, how: 'The name is spoken.', kind: 'pay' });
  return out;
}

function scenePlanRecording(k: number, sceneWords: readonly number[]): Recording {
  const register = (formality: number, deference: number, directness: number, terms: string[]) => ({
    formality,
    deference,
    familiarity: 1,
    directness,
    contractions: 'neutral',
    address_terms: terms,
  });
  return {
    json: {
      scenes: [
        {
          scene_no: 1,
          objective: `Day ${k} opens on the duty board and the porter share.`,
          pov: { character_id: DOYOON, person: 'third_limited' },
          participants: [DOYOON, MUJIN],
          location_id: HALL,
          beats: [
            { type: 'action', description: 'Do-yoon reads the duty board.', tags: ['information'] },
            { type: 'dialogue', description: 'Mu-jin names the share.', tags: ['tension'] },
          ],
          length_target: { unit: 'words', value: sceneWords[0] ?? 0 },
          speaker_pairs: [
            {
              speaker_id: MUJIN,
              addressee_id: DOYOON,
              register: register(1, 0, 4, ['kid', 'Kang']),
            },
          ],
          opening_beat_type: k === 1 ? 'in_medias_res' : 'continue_cliffhanger',
        },
        {
          scene_no: 2,
          objective: 'The yard: the count is settled and the long ledger moves one line.',
          pov: { character_id: DOYOON, person: 'third_limited' },
          participants: [DOYOON, MUJIN],
          location_id: HALL,
          beats: [
            { type: 'dialogue', description: 'Mu-jin remembers the corridor.', tags: ['emotion'] },
            { type: 'revelation', description: 'The ledger line.', tags: ['satisfaction'] },
          ],
          length_target: { unit: 'words', value: sceneWords[1] ?? 0 },
          speaker_pairs: [
            {
              speaker_id: DOYOON,
              addressee_id: MUJIN,
              register: register(3, 3, 2, ['Mister Park', 'sir']),
            },
          ],
          ending_beat_type: 'reveal',
        },
      ],
    },
    modelId: 'replay-model',
    usage: { input: 400, output: 200, cached: 0 },
  };
}

function sceneDraftRecording(k: number, sceneNo: number, text: string): Recording {
  const paragraphs = segmentParagraphs(toNfcText(text));
  const dialogue = paragraphs[1];
  return {
    json: {
      scene_no: sceneNo,
      language: 'en',
      text,
      paragraphs: paragraphs.map((p, i) => ({
        id: p.id,
        start: p.start,
        end: p.end,
        kind: i === 1 ? 'dialogue' : 'narration',
      })),
      speaker_annotations: dialogue
        ? [
            {
              utterance_start: dialogue.start,
              utterance_end: dialogue.end,
              speaker_id: sceneNo === 1 ? MUJIN : MUJIN,
            },
          ]
        : [],
      claims: [
        {
          statement:
            sceneNo === 1
              ? `Kang Do-yoon carries for Park Mu-jin at ${longformShare(k)} percent on day ${k}.`
              : `The long ledger advances on day ${k}.`,
          paragraph_id: paragraphs[0]?.id ?? 'p1',
          entity_ids: [DOYOON, MUJIN],
          frame: 'canonical',
        },
      ],
    },
    modelId: 'replay-model',
    usage: { input: 600, output: 300, cached: 0 },
  };
}

function judgeRecording(scores: Record<string, number>, judgeScore: number, extra = {}): Recording {
  return {
    json: {
      dimension_scores: scores,
      judge_score: judgeScore,
      drift_flags: [],
      issues: [],
      ...extra,
    },
    modelId: 'replay-model',
    usage: { input: 300, output: 100, cached: 0 },
  };
}

function summaryText(k: number): string {
  return `Day ${k}. Kang Do-yoon reads the duty board at the Association hall and carries for Park Mu-jin at ${longformShare(k)} percent. Mu-jin remembers the corridor Do-yoon named for him and keeps the arrangement. The long ledger of debts opened on the first morning moves one line further.`;
}

function extractRecording(k: number, chapterText: string): Recording {
  const dayEvidence = evidence(k, spanOf(chapterText, openingLine(k), k));
  const shareSpan = spanOf(
    chapterText,
    `You are carrying at ${shareWord(longformShare(k))} percent today`,
    k,
  );
  const ledgerEvidence = evidence(k, spanOf(chapterText, ledgerLine(k), k));

  const items: Record<string, unknown>[] = [
    {
      local_id: `ev-day-${k}`,
      type: 'event',
      op: 'assert',
      frame: 'canonical',
      confidence: 1,
      importance: 'minor',
      story_clock: clock(k, 1),
      payload: {
        type: 'other',
        summary: `Kang Do-yoon reads the duty board and carries for Park Mu-jin on day ${k}.`,
        location_id: HALL,
        participants: [
          { entity_id: DOYOON, role: 'agent' },
          { entity_id: MUJIN, role: 'agent' },
        ],
        importance: 'minor',
      },
      evidence: dayEvidence,
    },
  ];

  // The share fact: asserted once in chapter 1, then superseded at each renegotiation boundary, each time
  // citing the canon id the PREVIOUS boundary produced. This is the chain that cannot survive a broken link.
  if (longformShareAnchor(k) === k) {
    const localId = longformShareFactLocalId(k);
    const base: Record<string, unknown> = {
      local_id: localId,
      type: 'fact',
      op: k === 1 ? 'assert' : 'supersede',
      frame: 'canonical',
      confidence: 1,
      importance: 'major',
      story_clock: clock(k, 2),
      payload: {
        entity_id: DOYOON,
        attribute: 'porter.share',
        value: longformShare(k),
        value_text: `Kang Do-yoon's porter share under Park Mu-jin is ${shareWord(longformShare(k))} percent`,
        valid_from: clock(k, 2),
        valid_to: null,
      },
      evidence: evidence(k, shareSpan),
    };
    if (k !== 1) base.supersedes_ref = `{{canon.${longformShareFactLocalId(k - 1)}}}`;
    items.push(base);
  }

  if (k === LONGFORM_RELATIONSHIP.assertedAt || k === LONGFORM_RELATIONSHIP.supersededAt) {
    const early = k === LONGFORM_RELATIONSHIP.assertedAt;
    const item: Record<string, unknown> = {
      local_id: early ? 'r-trust' : 'r-trust-late',
      type: 'relationship_state',
      // Always a supersede: the bible already asserts a mentor→porter state valid from chapter 0, and the
      // database's no-overlap constraint is right to refuse a second open-ended row for the same pair.
      op: 'supersede',
      frame: 'canonical',
      confidence: 1,
      importance: 'major',
      story_clock: clock(k, 3),
      supersedes_ref: early ? '{{bible.r-mujin-doyoon}}' : '{{canon.r-trust}}',
      payload: {
        from_entity_id: MUJIN,
        to_entity_id: DOYOON,
        type: early ? 'colleague' : 'ally',
        axes: {
          trust: early ? 1 : 4,
          affection: 1,
          respect: early ? 1 : 4,
          hostility: 0,
          dependency: 0,
        },
        power_dynamic: early ? 'from_dominant' : 'equal',
        valid_from: clock(k, 3),
        valid_to: null,
      },
      evidence: ledgerEvidence,
    };
    items.push(item);
  }

  for (const p of promiseItemsFor(k)) items.push({ ...p, evidence: ledgerEvidence });

  return {
    json: {
      // Like the contract, the extractor's raw output is schema-validated by the gateway before the
      // workflow reasserts the envelope, so the recording carries the full canon-delta shape.
      project_id: '{{project}}',
      chapter_id: `{{chapter.${k}}}`,
      manuscript_version_id: `{{version.${k}.approved}}`,
      base_canon_version: '{{int:canon_version}}',
      stage: 'extracted_a',
      items,
      unresolved_questions: [],
      hypothesis_results: [{ hypothesis_ref: 'MH-1', result: 'realized', evidence: dayEvidence }],
      summary_l1: summaryText(k),
      ending_hook: longformEndingHook(k),
    },
    modelId: 'replay-model',
    usage: { input: 800, output: 400, cached: 0 },
  };
}

function promiseItemsFor(k: number): Record<string, unknown>[] {
  const mk = (
    localId: string,
    promiseId: string,
    op: 'open' | 'advance' | 'pay',
    kind: 'opened' | 'advanced' | 'paid',
    note: string,
  ) => ({
    local_id: localId,
    type: 'promise_event',
    op,
    frame: 'canonical',
    confidence: 1,
    importance: 'core',
    story_clock: clock(k, 4),
    payload: { promise_id: promiseId, kind, note },
  });
  const out: Record<string, unknown>[] = [];
  if (k === 1) {
    out.push(mk('pe-gate-open', PROMISE_GATE_RUN, 'open', 'opened', 'The gate run is named.'));
    out.push(mk('pe-compass-open', PROMISE_COMPASS, 'open', 'opened', 'The old compass is named.'));
    out.push(mk('pe-watcher-open', PROMISE_WATCHER, 'open', 'opened', 'The Watcher is named.'));
  }
  if (k === LONGFORM_PROMISE_PAYOFFS.gateRun)
    out.push(mk('pe-gate-pay', PROMISE_GATE_RUN, 'pay', 'paid', 'Mu-jin survives the run.'));
  if (k === LONGFORM_PROMISE_ADVANCES.compass)
    out.push(
      mk('pe-compass-advance', PROMISE_COMPASS, 'advance', 'advanced', 'The compass moves.'),
    );
  if (k === LONGFORM_PROMISE_PAYOFFS.compass) {
    out.push(mk('pe-compass-pay', PROMISE_COMPASS, 'pay', 'paid', 'The compass finds the door.'));
    out.push(
      mk('pe-watcher-advance', PROMISE_WATCHER, 'advance', 'advanced', 'One step to the name.'),
    );
  }
  if (k === LONGFORM_PROMISE_PAYOFFS.watcher)
    out.push(mk('pe-watcher-pay', PROMISE_WATCHER, 'pay', 'paid', 'The name is spoken.'));
  return out;
}

function summarizeRecording(k: number): Recording {
  return {
    json: {
      summary_l1: summaryText(k),
      ending_hook: longformEndingHook(k),
      state_changes: [`Kang Do-yoon: porter share ${longformShare(k)} percent`],
      knowledge_changes: [],
    },
    modelId: 'replay-model',
    usage: { input: 400, output: 200, cached: 0 },
  };
}

export interface LongformChapterFixture {
  readonly chapterNo: number;
  readonly contractId: string;
  readonly chapterText: string;
  readonly chapterWords: number;
  readonly sceneWords: readonly number[];
  readonly endingHook: string;
  readonly summaryL1: string;
}

export function longformChapterFixture(k: number): LongformChapterFixture {
  const scenes = longformSceneTexts(k);
  const chapterText = longformChapterText(k);
  return {
    chapterNo: k,
    contractId: longformContractId(k),
    chapterText,
    chapterWords: countWords(chapterText),
    sceneWords: scenes.map((s) => countWords(s)),
    endingHook: longformEndingHook(k),
    summaryL1: summaryText(k),
  };
}

/**
 * Every recording the 120-chapter run needs, keyed by the workflow's deterministic activity ids. The
 * planning recordings (story spec, assumptions, arc plan) are the ones already in `examples/fixture/ch01`
 * and are merged in by the harness; everything chapter-scoped is generated here.
 */
export function longformRecordings(chapters = LONGFORM_CHAPTERS): Record<string, Recording> {
  const out: Record<string, Recording> = {};
  for (let k = 1; k <= chapters; k++) {
    const fx = longformChapterFixture(k);
    const scenes = longformSceneTexts(k);
    out[`activity:chapter_contract:${k}`] = contractRecording(k, fx.chapterWords);
    out[`activity:scene_plan:${k}`] = scenePlanRecording(k, fx.sceneWords);
    scenes.forEach((text, i) => {
      out[`activity:scene_draft:${k}:${i + 1}`] = sceneDraftRecording(k, i + 1, text);
    });
    out[`activity:contract_check:${k}:r0`] = {
      json: {
        criteria: [
          {
            criterion_id: 'AC-LANG',
            passed: true,
            evidence_paragraph_ids: ['p1'],
            note: 'English throughout.',
          },
          {
            criterion_id: 'AC-MH-1',
            passed: true,
            evidence_paragraph_ids: ['p1'],
            note: 'The porter carries.',
          },
        ],
      },
      modelId: 'replay-model',
      usage: { input: 300, output: 100, cached: 0 },
    };
    out[`activity:continuity:${k}:r0`] = {
      json: { issues: [] },
      modelId: 'replay-model',
      usage: { input: 300, output: 50, cached: 0 },
    };
    out[`activity:knowledge_leak:${k}:r0`] = {
      json: { issues: [] },
      modelId: 'replay-model',
      usage: { input: 300, output: 50, cached: 0 },
    };
    out[`activity:prose_judge:${k}:r0`] = judgeRecording(
      { idiomatic_english: 5, readability: 5, register_fidelity: 5, translation_markers: 5 },
      90,
    );
    out[`activity:structure_judge:${k}:r0`] = judgeRecording(
      {
        hook_timing: 5,
        dialogue_forwardness: 5,
        local_payoff: 5,
        ending_pull: 5,
        exposition_control: 4,
      },
      90,
      { hook_sentence_index: 1, local_payoff_present: true, ending_type_detected: 'reveal' },
    );
    out[`activity:genre_judge:${k}:r0`] = judgeRecording(
      { reader_fantasy: 5, device_correctness: 4, vocabulary_register: 4, taboo_restraint: 5 },
      88,
    );
    out[`activity:voice_judge:${k}:r0`] = judgeRecording(
      { distinguishability: 5, verbal_habits: 4, register_naturalness: 5, register_consistency: 5 },
      88,
    );
    out[`activity:extract:${k}`] = extractRecording(k, fx.chapterText);
    out[`activity:summarize:${k}`] = summarizeRecording(k);
  }
  return out;
}

/** The bible the long-form project runs on: the fixture bible, unchanged. Re-exported for the harness. */
export const LONGFORM_BIBLE = BIBLE;
export const LONGFORM_IDS = { arcId: IDS.arc1 ?? '', seasonId: IDS.season1 ?? '' };
export const LONGFORM_ENTITY_IDS = { DOYOON, MUJIN, HALL, MAPO, ASSOCIATION };
