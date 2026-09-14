/**
 * Pack templates (docs/04-memory-canon/04 §3), versioned as data. A template fixes, per role: the sections and
 * their order/position, which tiers they hold, which source kinds are allowed or prohibited, the ranking
 * weights for T2, the T1 degradation ladder, where the token budget comes from in the Production Policy, the
 * Narrative Identity variant, and the validation rules. Changing any of these is a new template version
 * (ADR-0010 §6); the template hash is part of every pack hash.
 */
import { type RoleVariant } from '@yeonjae/narrative';
import { hashObject } from './hash.js';
import { type ItemKind, type Provenance, type SourceKind, type Tier } from './types.js';

export type SectionPosition = 'system' | 'user';

export interface SectionSpec {
  readonly name: string;
  readonly title: string;
  readonly position: SectionPosition;
  readonly tier: Tier;
  /** Item kinds this section may hold. */
  readonly kinds: readonly ItemKind[];
  /** A mandatory section must be non-empty after assembly, else the pack is invalid. */
  readonly mandatory: boolean;
  /** Prompt template variable this section feeds (see @yeonjae/prompts input_variables), if any. */
  readonly variable?: string | undefined;
}

export type LadderStep =
  'previous_tail_floor' | 'knowledge_contract_and_secrets_only' | 'compact_states_beyond_top4';

export interface RankingPolicy {
  /** Signal weights; every signal is in [0, 1]. Documented in docs/04-memory-canon/04 §2.3. */
  readonly weights: Readonly<Record<RankSignal, number>>;
  /** At most this many T2 items per (entity, attribute/type) key. */
  readonly perKeyCap: number;
  /** At most this share of T2 tokens from one item kind. */
  readonly perKindShare: number;
}

export type RankSignal =
  | 'mandatory'
  | 'character_overlap'
  | 'entity_overlap'
  | 'location_overlap'
  | 'timeline_relevance'
  | 'promise_urgency'
  | 'continuity_risk'
  | 'recency'
  | 'contract_reference'
  | 'evidence_strength'
  | 'importance'
  | 'lexical_relevance';

export interface PackTemplate {
  readonly name: string;
  readonly version: string;
  readonly roles: readonly string[];
  readonly identityVariant: RoleVariant | null;
  /** Policy key that supplies the input budget: `writer_input_budget_tokens` or `input_budget_tokens.<name>`. */
  readonly budgetKey: 'writer_input_budget_tokens' | 'input_budget_tokens';
  readonly sections: readonly SectionSpec[];
  readonly allowedSources: readonly SourceKind[];
  readonly prohibitedSources: readonly SourceKind[];
  /** Manuscript statuses a `chapter_text` job input may come from (empty = no chapter text allowed). */
  readonly chapterTextStatuses: readonly ('approved' | 'working')[];
  readonly ranking: RankingPolicy;
  readonly ladder: readonly LadderStep[];
  /** Provenance labels the renderer prints, per provenance. */
  readonly labels: Readonly<Record<Provenance, string>>;
  readonly validation: {
    readonly requireIdentityBlock: boolean;
    readonly requirePreviousChapter: boolean;
    readonly allowUntrusted: boolean;
  };
}

export const PROVENANCE_LABELS: Readonly<Record<Provenance, string>> = {
  hard_requirement: 'HARD',
  soft_preference: 'SOFT',
  assumption: 'ASSUMPTION',
  canon_fact: 'FACT',
  canon_event: 'EVENT',
  character_knowledge: 'KNOWLEDGE',
  relationship_state: 'RELATIONSHIP',
  promise: 'PROMISE',
  accepted_manuscript_excerpt: 'ACCEPTED',
  summary: 'SUMMARY',
  future_plan: 'PLANNED',
  untrusted_imported_text: 'UNTRUSTED',
  narrative_identity: 'IDENTITY',
  contract: 'CONTRACT',
  timeline: 'TIMELINE',
  evidence: 'EVIDENCE',
  registry: 'REGISTRY',
  draft_under_evaluation: 'DRAFT',
};

const CANON_SOURCES: readonly SourceKind[] = [
  'active_constraint_set',
  'story_spec',
  'narrative_identity',
  'chapter_contract',
  'canon',
  'accepted_manuscript',
  'summary',
  'lexical_index',
  'vector_index',
];

const RANK_WRITER: RankingPolicy = {
  weights: {
    mandatory: 1,
    character_overlap: 0.2,
    entity_overlap: 0.1,
    location_overlap: 0.05,
    timeline_relevance: 0.1,
    promise_urgency: 0.1,
    continuity_risk: 0.15,
    recency: 0.1,
    contract_reference: 0.1,
    evidence_strength: 0.05,
    importance: 0.1,
    lexical_relevance: 0.15,
  },
  perKeyCap: 3,
  perKindShare: 0.4,
};

const RANK_CHECKER: RankingPolicy = {
  ...RANK_WRITER,
  weights: {
    ...RANK_WRITER.weights,
    continuity_risk: 0.25,
    evidence_strength: 0.15,
    recency: 0.05,
  },
};

const T0_CORE = (variable: string): SectionSpec[] => [
  {
    name: 'active_constraints',
    title: 'ACTIVE CONSTRAINTS — hard requirements (mandatory)',
    position: 'user',
    tier: 'T0',
    kinds: ['active_constraint_set'],
    mandatory: true,
    variable,
  },
  {
    name: 'timeline',
    title: 'TIMELINE POSITION — reality frame and pins',
    position: 'user',
    tier: 'T0',
    kinds: ['timeline'],
    mandatory: true,
    variable,
  },
  {
    name: 'locked_facts',
    title: 'LOCKED FACTS — never contradict',
    position: 'user',
    tier: 'T0',
    kinds: ['locked_fact'],
    mandatory: false,
    variable,
  },
  {
    name: 'knowledge_guards',
    title: 'KNOWLEDGE GUARDS — who must NOT know what (hard)',
    position: 'user',
    tier: 'T0',
    kinds: ['knowledge_guard'],
    mandatory: false,
    variable,
  },
];

const SCENE_WRITER: PackTemplate = {
  name: 'pack.scene_writer',
  version: '1.0.0',
  roles: ['scene_writer', 'scene_rewriter'],
  identityVariant: 'writer_full',
  budgetKey: 'writer_input_budget_tokens',
  sections: [
    {
      name: 'narrative_identity',
      title: 'NARRATIVE IDENTITY',
      position: 'system',
      tier: 'T0',
      kinds: ['narrative_identity_block'],
      mandatory: true,
      variable: 'narrative_identity_block',
    },
    ...T0_CORE('chapter_contract'),
    {
      name: 'contract',
      title: 'CHAPTER CONTRACT — PLANNED (has not happened yet)',
      position: 'user',
      tier: 'T0',
      kinds: ['contract'],
      mandatory: true,
      variable: 'chapter_contract',
    },
    {
      name: 'soft_constraints',
      title: 'SOFT PREFERENCES AND ASSUMPTIONS',
      position: 'user',
      tier: 'T1',
      kinds: ['requirement'],
      mandatory: false,
      variable: 'chapter_contract',
    },
    {
      name: 'registry',
      title: 'REGISTRY — names, short forms, aliases',
      position: 'user',
      tier: 'T1',
      kinds: ['registry_slice'],
      mandatory: false,
      variable: 'canon_state',
    },
    {
      name: 'previous_chapter',
      title: 'PREVIOUS CHAPTER — accepted version only',
      position: 'user',
      tier: 'T1',
      kinds: ['summary', 'prev_chapter_tail', 'prev_chapter_hook', 'committed_delta'],
      mandatory: false,
      variable: 'previous_text',
    },
    {
      name: 'states',
      title: 'CANON STATE — current facts for the participants (as of chapter start)',
      position: 'user',
      tier: 'T1',
      kinds: ['fact', 'evidence'],
      mandatory: false,
      variable: 'canon_state',
    },
    {
      name: 'knowledge',
      title: 'KNOWLEDGE — knows / suspects / believes falsely / unaware, per participant',
      position: 'user',
      tier: 'T1',
      kinds: ['knowledge_state', 'proposition'],
      mandatory: false,
      variable: 'knowledge_lists',
    },
    {
      name: 'relationships',
      title: 'RELATIONSHIPS AND DIALOGUE REGISTER — directional (speaker → counterpart)',
      position: 'user',
      tier: 'T1',
      kinds: ['relationship_state', 'register_digest'],
      mandatory: false,
      variable: 'register_digests',
    },
    {
      name: 'promises',
      title: 'PROMISES — open, due, and touched by this chapter',
      position: 'user',
      tier: 'T1',
      kinds: ['promise'],
      mandatory: false,
      variable: 'open_promises',
    },
    {
      name: 'world_rules',
      title: 'WORLD AND POWER RULES',
      position: 'user',
      tier: 'T2',
      kinds: ['world_rule'],
      mandatory: false,
      variable: 'canon_state',
    },
    {
      name: 'retrieved',
      title: 'RETRIEVED OLDER CANON — relevant accepted events and excerpts (T2)',
      position: 'user',
      tier: 'T2',
      kinds: ['event', 'evidence', 'summary', 'chapter_text', 'proposition'],
      mandatory: false,
      variable: 'canon_state',
    },
    {
      name: 'minor_entities',
      title: 'MINOR ENTITIES (optional)',
      position: 'user',
      tier: 'T3',
      kinds: ['entity'],
      mandatory: false,
      variable: 'canon_state',
    },
  ],
  allowedSources: CANON_SOURCES,
  prohibitedSources: ['untrusted_import', 'job_input'],
  chapterTextStatuses: [],
  ranking: RANK_WRITER,
  ladder: [
    'previous_tail_floor',
    'knowledge_contract_and_secrets_only',
    'compact_states_beyond_top4',
  ],
  labels: PROVENANCE_LABELS,
  validation: { requireIdentityBlock: true, requirePreviousChapter: true, allowUntrusted: false },
};

const CHAPTER_PLANNER: PackTemplate = {
  name: 'pack.chapter_planner',
  version: '1.0.0',
  roles: ['chapter_planner', 'plan_continuity_checker'],
  identityVariant: 'planner_compact',
  budgetKey: 'input_budget_tokens',
  sections: [
    {
      name: 'narrative_identity',
      title: 'NARRATIVE IDENTITY',
      position: 'system',
      tier: 'T0',
      kinds: ['narrative_identity_block'],
      mandatory: true,
      variable: 'narrative_identity_block',
    },
    ...T0_CORE('active_constraints'),
    {
      name: 'contract',
      title: 'CONTRACT SLOT — PLANNED objectives for this chapter (arc plan)',
      position: 'user',
      tier: 'T0',
      kinds: ['contract', 'plan'],
      mandatory: true,
      variable: 'arc_plan',
    },
    {
      name: 'soft_constraints',
      title: 'SOFT PREFERENCES AND ASSUMPTIONS',
      position: 'user',
      tier: 'T1',
      kinds: ['requirement'],
      mandatory: false,
      variable: 'active_constraints',
    },
    {
      name: 'previous_chapter',
      title: 'PREVIOUS CHAPTER — accepted version only',
      position: 'user',
      tier: 'T1',
      kinds: ['summary', 'prev_chapter_hook', 'committed_delta', 'prev_chapter_tail'],
      mandatory: false,
      variable: 'previous_chapter_summary',
    },
    {
      name: 'states',
      title: 'CANON STATE — what has happened; current facts',
      position: 'user',
      tier: 'T1',
      kinds: ['fact', 'evidence', 'registry_slice'],
      mandatory: false,
      variable: 'canon_state',
    },
    {
      name: 'knowledge',
      title: 'KNOWLEDGE — who knows what',
      position: 'user',
      tier: 'T1',
      kinds: ['knowledge_state', 'proposition'],
      mandatory: false,
      variable: 'knowledge_state',
    },
    {
      name: 'relationships',
      title: 'RELATIONSHIPS — directional',
      position: 'user',
      tier: 'T1',
      kinds: ['relationship_state', 'register_digest'],
      mandatory: false,
      variable: 'canon_state',
    },
    {
      name: 'promises',
      title: 'OPEN PROMISES',
      position: 'user',
      tier: 'T1',
      kinds: ['promise'],
      mandatory: false,
      variable: 'open_promises',
    },
    {
      name: 'retrieved',
      title: 'RELATED OLDER EVENTS (T2)',
      position: 'user',
      tier: 'T2',
      kinds: ['event', 'evidence', 'summary', 'chapter_text', 'proposition', 'world_rule'],
      mandatory: false,
      variable: 'canon_state',
    },
  ],
  allowedSources: CANON_SOURCES,
  prohibitedSources: ['job_input'],
  chapterTextStatuses: [],
  ranking: RANK_WRITER,
  ladder: [
    'previous_tail_floor',
    'knowledge_contract_and_secrets_only',
    'compact_states_beyond_top4',
  ],
  labels: PROVENANCE_LABELS,
  validation: { requireIdentityBlock: true, requirePreviousChapter: true, allowUntrusted: true },
};

const CONTINUITY_CHECKER: PackTemplate = {
  name: 'pack.continuity_checker',
  version: '1.0.0',
  roles: ['continuity_checker', 'contract_compliance_judge'],
  identityVariant: null,
  budgetKey: 'input_budget_tokens',
  sections: [
    ...T0_CORE('timeline_position'),
    {
      name: 'contract',
      title:
        'CHAPTER CONTRACT — PLANNED (check the text against it; the text is the source of truth)',
      position: 'user',
      tier: 'T0',
      kinds: ['contract'],
      mandatory: true,
      variable: 'timeline_position',
    },
    {
      name: 'chapter_text',
      title: 'CHAPTER TEXT UNDER EVALUATION — job-scoped draft, not canon',
      position: 'user',
      tier: 'T0',
      kinds: ['chapter_text'],
      mandatory: true,
      variable: 'chapter_text',
    },
    {
      name: 'states',
      title: 'CANON STATE — participants, as of the chapter start (with evidence)',
      position: 'user',
      tier: 'T1',
      kinds: ['fact', 'evidence', 'registry_slice'],
      mandatory: false,
      variable: 'canon_state',
    },
    {
      name: 'knowledge',
      title: 'KNOWLEDGE — stances per participant',
      position: 'user',
      tier: 'T1',
      kinds: ['knowledge_state', 'proposition'],
      mandatory: false,
      variable: 'canon_state',
    },
    {
      name: 'relationships',
      title: 'RELATIONSHIPS — directional',
      position: 'user',
      tier: 'T1',
      kinds: ['relationship_state', 'register_digest'],
      mandatory: false,
      variable: 'canon_state',
    },
    {
      name: 'previous_chapter',
      title: 'PREVIOUS CHAPTER — accepted version only',
      position: 'user',
      tier: 'T1',
      kinds: ['summary', 'prev_chapter_hook', 'committed_delta', 'prev_chapter_tail'],
      mandatory: false,
      variable: 'recent_events',
    },
    {
      name: 'recent_events',
      title: 'RECENT EVENTS',
      position: 'user',
      tier: 'T1',
      kinds: ['event'],
      mandatory: false,
      variable: 'recent_events',
    },
    {
      name: 'world_rules',
      title: 'WORLD AND POWER RULES',
      position: 'user',
      tier: 'T1',
      kinds: ['world_rule'],
      mandatory: false,
      variable: 'world_rules',
    },
    {
      name: 'promises',
      title: 'PROMISES',
      position: 'user',
      tier: 'T2',
      kinds: ['promise'],
      mandatory: false,
      variable: 'recent_events',
    },
    {
      name: 'retrieved',
      title: 'RETRIEVED OLDER CANON (T2)',
      position: 'user',
      tier: 'T2',
      kinds: ['event', 'evidence', 'summary', 'chapter_text', 'proposition'],
      mandatory: false,
      variable: 'recent_events',
    },
  ],
  allowedSources: [...CANON_SOURCES, 'job_input'],
  prohibitedSources: ['untrusted_import'],
  chapterTextStatuses: ['working', 'approved'],
  ranking: RANK_CHECKER,
  ladder: ['previous_tail_floor', 'compact_states_beyond_top4'],
  labels: PROVENANCE_LABELS,
  validation: { requireIdentityBlock: false, requirePreviousChapter: false, allowUntrusted: false },
};

const EXTRACTOR: PackTemplate = {
  name: 'pack.extractor',
  version: '1.0.0',
  roles: ['canon_extractor', 'extractor_a', 'extractor_b'],
  identityVariant: null,
  budgetKey: 'input_budget_tokens',
  sections: [
    {
      name: 'timeline',
      title: 'STORY CLOCK AND TIMELINE',
      position: 'user',
      tier: 'T0',
      kinds: ['timeline'],
      mandatory: true,
      variable: 'story_clock',
    },
    {
      name: 'registry',
      title: 'REGISTRY — entities, ids, names, aliases; known propositions and promises',
      position: 'user',
      tier: 'T0',
      kinds: ['registry_slice', 'proposition', 'promise'],
      mandatory: true,
      variable: 'registry',
    },
    {
      name: 'hypotheses',
      title: 'HYPOTHESES — PLANNED by the contract; verify against the text',
      position: 'user',
      tier: 'T0',
      kinds: ['contract'],
      mandatory: true,
      variable: 'hypotheses',
    },
    {
      name: 'chapter_text',
      title: 'CHAPTER TEXT — approval-locked version, with paragraph ids',
      position: 'user',
      tier: 'T0',
      kinds: ['chapter_text'],
      mandatory: true,
      variable: 'chapter_text',
    },
    {
      name: 'states',
      title: 'EXISTING CANON STATE — supersede these ids on change (as of chapter start)',
      position: 'user',
      tier: 'T1',
      kinds: ['fact', 'locked_fact'],
      mandatory: false,
      variable: 'pre_pass',
    },
    {
      name: 'knowledge',
      title: 'EXISTING KNOWLEDGE STATES',
      position: 'user',
      tier: 'T1',
      kinds: ['knowledge_state'],
      mandatory: false,
      variable: 'pre_pass',
    },
    {
      name: 'relationships',
      title: 'EXISTING RELATIONSHIP STATES',
      position: 'user',
      tier: 'T1',
      kinds: ['relationship_state'],
      mandatory: false,
      variable: 'pre_pass',
    },
    {
      name: 'recent_events',
      title: 'RECENT EVENTS (T2)',
      position: 'user',
      tier: 'T2',
      kinds: ['event'],
      mandatory: false,
      variable: 'pre_pass',
    },
  ],
  allowedSources: [...CANON_SOURCES, 'job_input'],
  prohibitedSources: ['untrusted_import'],
  chapterTextStatuses: ['approved'],
  ranking: RANK_CHECKER,
  ladder: ['compact_states_beyond_top4'],
  labels: PROVENANCE_LABELS,
  validation: { requireIdentityBlock: false, requirePreviousChapter: false, allowUntrusted: false },
};

export const TEMPLATES: readonly PackTemplate[] = [
  SCENE_WRITER,
  CHAPTER_PLANNER,
  CONTINUITY_CHECKER,
  EXTRACTOR,
];

export function templateFor(role: string): PackTemplate | undefined {
  return TEMPLATES.find((t) => t.roles.includes(role));
}

export function templateByName(name: string): PackTemplate | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

export function templateRef(t: PackTemplate): string {
  return `${t.name}@${t.version}`;
}

export function templateHash(t: PackTemplate): string {
  return hashObject(t);
}

export function budgetFor(
  t: PackTemplate,
  ctx: {
    writer_input_budget_tokens?: number | undefined;
    input_budget_tokens?: Readonly<Record<string, number | undefined>> | undefined;
  },
): number | undefined {
  if (t.budgetKey === 'writer_input_budget_tokens') return ctx.writer_input_budget_tokens;
  return ctx.input_budget_tokens?.[t.name];
}
