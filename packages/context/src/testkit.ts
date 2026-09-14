/**
 * In-memory fixtures for assembler unit tests: a compiled Narrative Identity Block for the fixture project,
 * the ch.12 contract, the v3 Story Spec and a minimal but complete `AssemblyInput` builder. No database.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileBlock, composeIdentity, ProfileStore } from '@yeonjae/narrative';
import { compileActiveConstraintSet } from './constraints.js';
import { sha256 } from './hash.js';
import { buildQueryPlan } from './plan.js';
import { renderContract } from './render.js';
import { templateFor } from './templates.js';
import { previousTail } from './tail.js';
import { type AssemblyInput, type ChapterContract, type Item, type StorySpec } from './types.js';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURE = {
  project: '0191b2a0-0000-7000-8000-000000000001',
  workspace: '0191b2a0-0000-7000-8000-000000000000',
  main: '0191b2a0-0000-7000-8000-000000050001',
  priorLoop: '0191b2a0-0000-7000-8000-000000050002',
  identity: '0191b2a0-0000-7000-8000-000000060001',
  doyoon: '0191b2a0-0000-7000-8000-0000000c0001',
  seoha: '0191b2a0-0000-7000-8000-0000000c0002',
  mujin: '0191b2a0-0000-7000-8000-0000000c0003',
  yuri: '0191b2a0-0000-7000-8000-0000000c0005',
  ch09Version: '0191b2a0-0000-7000-8000-000000030009',
  ch09Rejected: '0191b2a0-0000-7000-8000-000000030909',
  ch11Version: '0191b2a0-0000-7000-8000-000000030011',
  p1: '0191b2a0-0000-7000-8000-0000000b0001',
};

export const contract = JSON.parse(
  readFileSync(`${ROOT}examples/fixture/chapter-contract.ch12.json`, 'utf8'),
) as ChapterContract;
export const spec = JSON.parse(
  readFileSync(`${ROOT}examples/fixture/story-spec.v3.json`, 'utf8'),
) as StorySpec;
export const ch09Text = readFileSync(
  `${ROOT}examples/fixture/manuscripts/ch09.accepted.txt`,
  'utf8',
);
export const ch09Rejected = readFileSync(
  `${ROOT}examples/fixture/manuscripts/ch09.rejected-draft.txt`,
  'utf8',
);
export const POISON = 'left arm was severed';

export const NAMES: Record<string, string> = {
  [FIXTURE.doyoon]: 'Kang Do-yoon',
  [FIXTURE.seoha]: 'Lee Seo-ha',
  [FIXTURE.mujin]: 'Park Mu-jin',
  [FIXTURE.yuri]: 'Han Yu-ri',
};
export const nameOf = (id: string): string => NAMES[id] ?? id;

const store = ProfileStore.fromDirectory();
export function identityBlock(
  role: 'writer_full' | 'planner_compact',
  budget = 4000,
  contentRestrictions?: readonly string[],
) {
  const identity = composeIdentity(store, `project/${FIXTURE.project}@1`, FIXTURE.identity);
  const b = compileBlock(identity, { role, budgetTokens: budget, contentRestrictions });
  return {
    text: b.text,
    hash: b.hash,
    identityVersionId: b.identityVersionId,
    roleVariant: b.role,
    outputLanguageContractHash: b.outputLanguageContractHash,
    traditionContractHash: b.traditionContractHash,
    droppedSections: b.droppedSections,
    identityTail: b.identityTail,
  };
}

export function acsFor(chapterNo = 12) {
  const acs = compileActiveConstraintSet(
    spec,
    {
      chapterNo,
      arcId: contract.arc_id,
      minorArcId: contract.minor_arc_id,
      seasonId: contract.season_id,
      participantIds: contract.participants.map((p) => p.character_id),
      specVersion: spec.version,
    },
    { capTokens: 1200 },
  );
  return acs;
}

export function canon(ref: string, version: number, timeline = FIXTURE.main): Item['source'] {
  return {
    kind: 'canon',
    ref,
    version: String(version),
    project_id: FIXTURE.project,
    timeline_id: timeline,
  };
}

export interface BaseOptions {
  readonly role?: 'scene_writer' | 'chapter_planner' | 'continuity_checker' | 'canon_extractor';
  readonly canonVersion?: number;
  readonly withPrevious?: boolean;
  readonly extraItems?: readonly Item[];
  readonly narrative?: AssemblyInput['narrativeBlock'] | null;
  readonly budget?: number;
  readonly policyVersion?: string;
  readonly identityVersionId?: string;
}

/** A complete writer input for chapter 12 with chapter 11 = the ch.9 fixture text standing in as accepted k−1. */
export function baseInput(opts: BaseOptions = {}): AssemblyInput {
  const role = opts.role ?? 'scene_writer';
  const canonVersion = opts.canonVersion ?? 11;
  const acs = acsFor();
  const plan = buildQueryPlan(contract);
  const tail = previousTail(ch09Text, 400, 600);
  const floor = previousTail(ch09Text, 250);
  const prevVersion = FIXTURE.ch11Version;
  const summary =
    'Chapter 11 factual summary (L1, from the accepted version v1): Mu-jin mentions a daughter he has not seen in years; the party rests before re-entering the dungeon; Do-yoon counts his mana stones and says nothing about the venom.';
  const hook = 'Outside the gate, the black venom had climbed to Mu-jin’s knee.';
  const isWriter = role === 'scene_writer' || role === 'chapter_planner';
  const narrative =
    opts.narrative === null
      ? undefined
      : (opts.narrative ??
        (isWriter
          ? identityBlock(role === 'scene_writer' ? 'writer_full' : 'planner_compact')
          : undefined));
  const items: Item[] = [
    {
      kind: 'active_constraint_set',
      id: `active_constraint_set:${acs.id}`,
      section: 'active_constraints',
      tier: 'T0',
      provenance: 'hard_requirement',
      source: {
        kind: 'active_constraint_set',
        ref: acs.id,
        version: `spec3:${acs.contentHash.slice(7, 19)}`,
        project_id: FIXTURE.project,
      },
      text: acs.hardText,
      materiality: 'material',
    },
    {
      kind: 'timeline',
      id: `timeline:${FIXTURE.main}`,
      section: 'timeline',
      tier: 'T0',
      provenance: 'timeline',
      source: canon(FIXTURE.main, canonVersion),
      text: `Timeline: main (main). Reality frame: canonical. Story clock ch.12.0 → ch.12.99. Canon version ${canonVersion} pinned.`,
      materiality: 'material',
    },
    {
      kind: 'knowledge_guard',
      id: `knowledge_guard:${FIXTURE.seoha}:${FIXTURE.p1}`,
      section: 'knowledge_guards',
      tier: 'T0',
      provenance: 'hard_requirement',
      source: {
        kind: 'chapter_contract',
        ref: `${contract.id}#guard`,
        version: '2',
        project_id: FIXTURE.project,
      },
      text: 'Lee Seo-ha must NOT know (or speak/act as if knowing): “Kang Do-yoon is a regressor.”',
      materiality: 'material',
      entityIds: [FIXTURE.seoha],
    },
    {
      kind: 'contract',
      id: `contract:${contract.id}@${contract.version}`,
      section: role === 'canon_extractor' ? 'hypotheses' : 'contract',
      tier: 'T0',
      provenance: 'contract',
      source: {
        kind: 'chapter_contract',
        ref: contract.id,
        version: '2',
        project_id: FIXTURE.project,
      },
      text: renderContract(contract, nameOf),
      materiality: 'material',
    },
    ...(narrative && (role === 'scene_writer' || role === 'chapter_planner')
      ? [
          {
            kind: 'narrative_identity_block' as const,
            id: `narrative_identity_block:${narrative.identityVersionId}`,
            section: 'narrative_identity',
            tier: 'T0' as const,
            provenance: 'narrative_identity' as const,
            source: {
              kind: 'narrative_identity' as const,
              ref: `project/${FIXTURE.project}@1`,
              version: narrative.identityVersionId,
              project_id: FIXTURE.project,
            },
            text: narrative.text,
            materiality: 'material' as const,
          },
        ]
      : []),
    ...(role === 'continuity_checker' || role === 'canon_extractor'
      ? [
          {
            kind: 'chapter_text' as const,
            id: 'chapter_text:job',
            section: 'chapter_text',
            tier: 'T0' as const,
            provenance: 'draft_under_evaluation' as const,
            source: {
              kind: 'job_input' as const,
              ref: 'job',
              manuscript_status: 'approved' as const,
              chapter_no: 12,
              project_id: FIXTURE.project,
            },
            text: 'Chapter 12 text under evaluation:\n[p1] “You have to take one rookie,” the clerk said.',
            materiality: 'material' as const,
          },
        ]
      : []),
    {
      kind: 'fact',
      id: 'fact:0191b2a0-0000-7000-8000-000000040001',
      section: 'states',
      tier: 'T1',
      provenance: 'canon_fact',
      source: canon('0191b2a0-0000-7000-8000-000000040001', canonVersion),
      text: 'Park Mu-jin · status.injury[left_leg_venom] = Beast venom in the left calf (serious) (valid ch.9.46 → open; frame canonical; asserted v9) — evidence: ch.9 p46 “Black venom was climbing Mu-jin’s left calf.” — CONTINUITY ANCHOR',
      compressed: {
        method: 'table',
        text: 'Park Mu-jin · status.injury[left_leg_venom] = Beast venom in the left calf (serious) (valid ch.9.46 → open) — CONTINUITY ANCHOR',
      },
      materiality: 'material',
      entityIds: [FIXTURE.mujin],
      dedupeKey: `fact:${FIXTURE.mujin}:status.injury#left_leg_venom`,
      signals: { continuity_risk: 1, evidence_strength: 1 },
    },
    {
      kind: 'knowledge_state',
      id: 'knowledge_state:k-seoha-p1',
      section: 'knowledge',
      tier: 'T1',
      provenance: 'character_knowledge',
      source: canon('k-seoha-p1', canonVersion),
      text: 'Lee Seo-ha — UNAWARE: “Kang Do-yoon is a regressor.” [channel: narration; since ch.10.0]',
      materiality: 'material',
      entityIds: [FIXTURE.seoha],
      dedupeKey: `knowledge:${FIXTURE.seoha}:${FIXTURE.p1}`,
      signals: { contract_reference: 1 },
    },
    {
      kind: 'relationship_state',
      id: 'relationship_state:r-mujin-doyoon',
      section: 'relationships',
      tier: 'T1',
      provenance: 'relationship_state',
      source: canon('r-mujin-doyoon', canonVersion),
      text: 'Park Mu-jin → Kang Do-yoon: mentor (from_dominant); axes: affection 2, trust 3; register: formality 1; address terms: "kid", "Do-yoon", "son"; since ch.9.80',
      materiality: 'material',
      entityIds: [FIXTURE.mujin, FIXTURE.doyoon],
      dedupeKey: `relationship:${FIXTURE.mujin}:${FIXTURE.doyoon}`,
    },
    ...(opts.withPrevious === false
      ? []
      : [
          {
            kind: 'summary' as const,
            id: 'summary:s11',
            section: 'previous_chapter',
            tier: 'T1' as const,
            provenance: 'summary' as const,
            source: {
              kind: 'summary' as const,
              ref: 's11',
              version: `L1@canon${canonVersion}`,
              manuscript_version_id: prevVersion,
              manuscript_status: 'accepted' as const,
              chapter_no: 11,
              project_id: FIXTURE.project,
            },
            text: summary,
            materiality: 'material' as const,
          },
          {
            kind: 'prev_chapter_tail' as const,
            id: `prev_chapter_tail:${prevVersion}`,
            section: 'previous_chapter',
            tier: 'T1' as const,
            provenance: 'accepted_manuscript_excerpt' as const,
            source: {
              kind: 'accepted_manuscript' as const,
              ref: prevVersion,
              version: `v1@canon${canonVersion}`,
              manuscript_version_id: prevVersion,
              manuscript_status: 'accepted' as const,
              chapter_no: 11,
              project_id: FIXTURE.project,
            },
            text: `Chapter 11 ending, verbatim (last ${tail.words} words):\n${tail.text}`,
            compressed: {
              method: 'degraded' as const,
              text: `Chapter 11 ending, verbatim (last ${floor.words} words):\n${floor.text}`,
            },
            materiality: 'material' as const,
          },
          {
            kind: 'prev_chapter_hook' as const,
            id: `prev_chapter_hook:${prevVersion}`,
            section: 'previous_chapter',
            tier: 'T1' as const,
            provenance: 'accepted_manuscript_excerpt' as const,
            source: {
              kind: 'accepted_manuscript' as const,
              ref: prevVersion,
              version: `v1@canon${canonVersion}`,
              manuscript_version_id: prevVersion,
              manuscript_status: 'accepted' as const,
              chapter_no: 11,
              project_id: FIXTURE.project,
            },
            text: `Chapter 11 ending hook: “${hook}”`,
            materiality: 'material' as const,
          },
          {
            kind: 'committed_delta' as const,
            id: 'committed_delta:c11#f-1',
            section: 'previous_chapter',
            tier: 'T1' as const,
            provenance: 'canon_event' as const,
            source: {
              kind: 'canon' as const,
              ref: 'c11#f-1',
              version: String(canonVersion),
              manuscript_version_id: prevVersion,
              manuscript_status: 'accepted' as const,
              chapter_no: 11,
              project_id: FIXTURE.project,
            },
            text: 'Committed from chapter 11 (canon v11): fact/assert @ ch.11.40: Park Mu-jin · family.daughter = mentioned, not seen in years',
            materiality: 'material' as const,
          },
        ]),
    {
      kind: 'event',
      id: 'event:e-ch9-injury',
      section: 'retrieved',
      tier: 'T2',
      provenance: 'canon_event',
      source: {
        kind: 'lexical_index',
        ref: 'e-ch9-injury',
        version: '9',
        chapter_no: 9,
        project_id: FIXTURE.project,
        timeline_id: FIXTURE.main,
      },
      text: 'ch.9 event: Mu-jin shoves Do-yoon clear and takes a fog-beast tendril in the left calf; the venom spreads.',
      materiality: 'contextual',
      entityIds: [FIXTURE.mujin, FIXTURE.doyoon],
      dedupeKey: 'event:e-ch9-injury',
      signals: { lexical_relevance: 0.9, character_overlap: 1, recency: 0.75, importance: 1 },
    },
    {
      kind: 'event',
      id: 'event:e-ch3-compass',
      section: 'retrieved',
      tier: 'T2',
      provenance: 'canon_event',
      source: {
        kind: 'lexical_index',
        ref: 'e-ch3-compass',
        version: '3',
        chapter_no: 3,
        project_id: FIXTURE.project,
        timeline_id: FIXTURE.main,
      },
      text: 'ch.3 event: Do-yoon buys the old compass from a street vendor near Gangnam gate.',
      materiality: 'contextual',
      entityIds: [FIXTURE.doyoon],
      dedupeKey: 'event:e-ch3-compass',
      signals: { lexical_relevance: 0.4, character_overlap: 0.5, recency: 0.25, importance: 0.6 },
    },
  ];
  // Only sections the role's template defines exist for that role (the extractor has no constraint block);
  // extra items are passed through untouched so tests can inject anything.
  const template = templateFor(role);
  const registrySpec = template?.sections.find((s) => s.kinds.includes('registry_slice'));
  if (registrySpec) {
    items.push({
      kind: 'registry_slice',
      id: `registry_slice:${FIXTURE.mujin}`,
      section: registrySpec.name,
      tier: registrySpec.tier,
      provenance: 'registry',
      source: {
        kind: 'canon',
        ref: FIXTURE.mujin,
        version: String(canonVersion),
        project_id: FIXTURE.project,
      },
      text: `Park Mu-jin (character; id ${FIXTURE.mujin}); short: Mu-jin`,
      materiality: 'contextual',
      entityIds: [FIXTURE.mujin],
    });
  }
  const fits = (i: Item) =>
    template?.sections.some((s) => s.name === i.section && s.kinds.includes(i.kind)) ?? false;
  return {
    workspaceId: FIXTURE.workspace,
    projectId: FIXTURE.project,
    role,
    contract,
    clockStart: contract.story_time.start,
    items: [...items.filter(fits), ...(opts.extraItems ?? [])],
    narrativeBlock: narrative,
    activeConstraintSet: {
      id: acs.id,
      contentHash: acs.contentHash,
      renderedText: acs.renderedText,
      hardText: acs.hardText,
      tokenCount: acs.tokenCount,
      hardCount: acs.hard.length,
      softCount: acs.soft.length,
      assumptionCount: acs.assumptions.length,
      conflictCount: acs.conflicts.length,
      specVersion: acs.specVersion,
    },
    previousChapter:
      opts.withPrevious === false
        ? undefined
        : {
            chapterNo: 11,
            manuscriptVersionId: prevVersion,
            versionNo: 1,
            contentHash: sha256(ch09Text),
            acceptedCanonVersion: canonVersion,
            tail,
            tailFloor: floor,
            summaryL1: summary,
            endingHook: hook,
            committedItemCount: 1,
            endClock: { chapter_no: 11, ordinal: 90, precision: 'exact', world_date: 'D+40' },
          },
    pins: {
      canonVersion,
      specVersion: 3,
      bibleVersion: 2,
      narrativeIdentityVersionId: opts.identityVersionId ?? FIXTURE.identity,
      productionPolicyVersion: opts.policyVersion ?? 'policy/standard@1',
      promptSetId: 'set:fixture',
    },
    policyContext: {
      previous_tail_words: 400,
      previous_tail_floor_words: 250,
      active_constraints_cap_tokens: 1200,
      writer_input_budget_tokens: opts.budget ?? 24000,
      l1_summary_max_words: 120,
      input_budget_tokens: {
        'pack.chapter_planner': opts.budget ?? 14000,
        'pack.continuity_checker': opts.budget ?? 20000,
        'pack.extractor': opts.budget ?? 18000,
      },
    },
    retrieval: {
      lexical: 'ok',
      vector: 'not_configured',
      notes: ['vector retrieval not configured (ADR-0045): structured + lexical only'],
    },
    queryPlanHash: plan.hash,
  };
}
