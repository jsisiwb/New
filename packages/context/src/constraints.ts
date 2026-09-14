/**
 * Active Constraint Set compiler (ADR-0033, FR-1.8). Input: the pinned Story Spec (requirements with scope) and
 * the chapter's position (chapter number, arc, season, participants). Output: the deterministic, deduplicated,
 * grouped rendering of every in-scope requirement, each carrying its stable id, plus a content hash and the
 * classification hard / soft / assumption. Hard requirements and content restrictions are mandatory context
 * (T0); the cap applies to the whole set and exceeding it is `CONSTRAINTS_OVERFLOW`, never silent trimming.
 */
import { ContextError } from './errors.js';
import { cmp, estimateTokens, sha256, uuidFromHash } from './hash.js';
import { type Requirement, type StorySpec } from './types.js';

export interface ConstraintScope {
  readonly chapterNo: number;
  readonly arcId?: string | undefined;
  readonly minorArcId?: string | undefined;
  readonly seasonId?: string | undefined;
  readonly participantIds: readonly string[];
  /** Spec version being compiled; items retired at or before it, or effective after it, are excluded. */
  readonly specVersion: number;
}

export interface CompiledConstraint {
  readonly id: string;
  readonly kind: Requirement['kind'];
  readonly category: Requirement['category'];
  readonly text: string;
  readonly provenance: Requirement['provenance'];
  readonly confirmed: boolean;
  readonly scopeLabel: string;
  /** Ids of duplicates merged into this constraint (same kind + normalized text). */
  readonly mergedIds: readonly string[];
}

export interface ConstraintConflict {
  readonly itemIds: readonly string[];
  readonly description: string;
  readonly status: 'open' | 'resolved';
}

export interface ActiveConstraintSet {
  readonly id: string;
  readonly contentHash: string;
  readonly specVersion: number;
  readonly chapterNo: number;
  readonly hard: readonly CompiledConstraint[];
  readonly soft: readonly CompiledConstraint[];
  readonly assumptions: readonly CompiledConstraint[];
  readonly conflicts: readonly ConstraintConflict[];
  readonly renderedText: string;
  /** Rendering of the hard block only (what T0 must contain byte-for-byte). */
  readonly hardText: string;
  readonly tokenCount: number;
  readonly itemIds: readonly string[];
  readonly excluded: readonly { readonly id: string; readonly reason: string }[];
}

const CATEGORY_ORDER: readonly Requirement['category'][] = [
  'content_restriction',
  'forbidden_development',
  'premise',
  'genre',
  'character',
  'world',
  'progression',
  'romance',
  'mandatory_scene',
  'structure',
  'length',
  'tone',
  'ending',
  'style',
  'audience',
  'direction',
  'other',
];

const CATEGORY_TITLE: Readonly<Record<Requirement['category'], string>> = {
  content_restriction: 'Content restrictions',
  forbidden_development: 'Forbidden developments',
  premise: 'Premise',
  genre: 'Genre',
  character: 'Characters',
  world: 'World',
  progression: 'Progression',
  romance: 'Romance',
  mandatory_scene: 'Mandatory scenes',
  structure: 'Structure',
  length: 'Length',
  tone: 'Tone',
  ending: 'Ending',
  style: 'Style',
  audience: 'Audience',
  direction: 'Directions',
  other: 'Other',
};

export function requirementText(r: Requirement): string {
  const t = r.language === 'en' || r.language.startsWith('en-') ? r.text : r.text_en;
  if (!t) {
    throw new ContextError(
      'CONSTRAINT_UNRENDERABLE',
      `requirement ${r.id} is authored in ${r.language} and has no English working paraphrase (text_en)`,
      { requirementId: r.id },
    );
  }
  return t.replace(/\s+/g, ' ').trim();
}

/** Scope applicability (ADR-0033): series-wide always; season/arc/chapter range/entities by intersection. */
export function inScope(
  r: Requirement,
  scope: ConstraintScope,
): { ok: true } | { ok: false; reason: string } {
  if (r.retired_in_spec_version !== undefined && r.retired_in_spec_version <= scope.specVersion)
    return { ok: false, reason: `retired in spec version ${r.retired_in_spec_version}` };
  if (
    r.effective_from_spec_version !== undefined &&
    r.effective_from_spec_version > scope.specVersion
  )
    return {
      ok: false,
      reason: `effective only from spec version ${r.effective_from_spec_version}`,
    };
  const s = r.scope;
  switch (s.level) {
    case 'series':
      return { ok: true };
    case 'season':
      return scope.seasonId && (s.season_ids ?? []).includes(scope.seasonId)
        ? { ok: true }
        : { ok: false, reason: 'season scope does not include this chapter' };
    case 'arc': {
      const arcs = s.arc_ids ?? [];
      const hit = [scope.arcId, scope.minorArcId].some((a) => a !== undefined && arcs.includes(a));
      return hit ? { ok: true } : { ok: false, reason: 'arc scope does not include this chapter' };
    }
    case 'chapter_range': {
      const from = s.chapter_from ?? 1;
      const to = s.chapter_to ?? Number.MAX_SAFE_INTEGER;
      return scope.chapterNo >= from && scope.chapterNo <= to
        ? { ok: true }
        : {
            ok: false,
            reason: `chapter range ${from}–${s.chapter_to ?? '∞'} excludes chapter ${scope.chapterNo}`,
          };
    }
    case 'character':
    case 'relationship': {
      const ents = s.entity_ids ?? [];
      const hit = ents.some((e) => scope.participantIds.includes(e));
      return hit
        ? { ok: true }
        : { ok: false, reason: 'no scoped entity participates in this chapter' };
    }
  }
}

function scopeLabel(r: Requirement): string {
  const s = r.scope;
  switch (s.level) {
    case 'series':
      return 'series';
    case 'season':
      return 'season';
    case 'arc':
      return 'arc';
    case 'chapter_range':
      return `ch.${s.chapter_from ?? 1}–${s.chapter_to ?? '∞'}`;
    case 'character':
      return 'character';
    case 'relationship':
      return 'relationship';
  }
}

function normalizedKey(kind: Requirement['kind'], text: string): string {
  return `${kind}|${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()}`;
}

function renderGroup(title: string, items: readonly CompiledConstraint[]): string {
  const byCat = new Map<Requirement['category'], CompiledConstraint[]>();
  for (const c of items) {
    const arr = byCat.get(c.category) ?? [];
    arr.push(c);
    byCat.set(c.category, arr);
  }
  const lines: string[] = [`### ${title}`];
  for (const cat of CATEGORY_ORDER) {
    const arr = byCat.get(cat);
    if (!arr?.length) continue;
    lines.push(`${CATEGORY_TITLE[cat]}:`);
    for (const c of arr) {
      const merged = c.mergedIds.length ? ` (also ${c.mergedIds.join(', ')})` : '';
      const conf = c.kind === 'assumption' && !c.confirmed ? ' [unconfirmed]' : '';
      lines.push(`- [${c.id}] ${c.text}${merged}${conf} {scope: ${c.scopeLabel}}`);
    }
  }
  return lines.join('\n');
}

export interface CompileConstraintsOptions {
  readonly capTokens: number;
  /** Additional hard lines (e.g. locked facts touching participants) rendered under "Locked facts". */
  readonly lockedFacts?: readonly { readonly id: string; readonly text: string }[] | undefined;
}

export function compileActiveConstraintSet(
  spec: StorySpec,
  scope: ConstraintScope,
  opts: CompileConstraintsOptions,
): ActiveConstraintSet {
  const excluded: { id: string; reason: string }[] = [];
  const merged = new Map<string, CompiledConstraint>();
  const sorted = [...spec.items].sort((a, b) => cmp(a.id, b.id));
  for (const r of sorted) {
    const scoped = inScope(r, scope);
    if (!scoped.ok) {
      excluded.push({ id: r.id, reason: scoped.reason });
      continue;
    }
    const text = requirementText(r);
    const key = normalizedKey(r.kind, text);
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, mergedIds: [...existing.mergedIds, r.id].sort(cmp) });
      continue;
    }
    merged.set(key, {
      id: r.id,
      kind: r.kind,
      category: r.category,
      text,
      provenance: r.provenance,
      confirmed: r.confirmed_by_user ?? false,
      scopeLabel: scopeLabel(r),
      mergedIds: [],
    });
  }
  const all = [...merged.values()].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || cmp(a.id, b.id),
  );
  const hard = all.filter((c) => c.kind === 'hard');
  const soft = all.filter((c) => c.kind === 'soft');
  const assumptions = all.filter((c) => c.kind === 'assumption');
  const included = new Set(all.flatMap((c) => [c.id, ...c.mergedIds]));
  const conflicts: ConstraintConflict[] = (spec.conflicts ?? [])
    .filter((c) => c.item_ids.some((i) => included.has(i)))
    .map((c) => ({
      itemIds: [...c.item_ids].sort(cmp),
      description: c.description,
      status: c.status,
    }))
    .sort((a, b) => cmp(a.itemIds.join(','), b.itemIds.join(',')));

  const hardLines = [renderGroup('Hard requirements (mandatory — never violate)', hard)];
  if (opts.lockedFacts?.length) {
    hardLines.push(
      [
        'Locked facts:',
        ...[...opts.lockedFacts]
          .sort((a, b) => cmp(a.id, b.id))
          .map((f) => `- [${f.id}] ${f.text}`),
      ].join('\n'),
    );
  }
  const openConflicts = conflicts.filter((c) => c.status === 'open');
  if (openConflicts.length) {
    hardLines.push(
      [
        'Open conflicts (resolve before relying on either side):',
        ...openConflicts.map((c) => `- ${c.itemIds.join(' vs ')}: ${c.description}`),
      ].join('\n'),
    );
  }
  const hardText = hardLines.join('\n');
  const parts = [
    `## Active Constraint Set (spec v${spec.version}, chapter ${scope.chapterNo})`,
    hardText,
    ...(soft.length
      ? [renderGroup('Soft preferences (follow unless a hard requirement or canon forbids)', soft)]
      : []),
    ...(assumptions.length
      ? [renderGroup('Assumptions (model-inferred; treat as defaults, not facts)', assumptions)]
      : []),
  ];
  const renderedText = parts.join('\n\n');
  const tokenCount = estimateTokens(renderedText);
  const contentHash = sha256(renderedText);
  if (tokenCount > opts.capTokens) {
    throw new ContextError(
      'CONSTRAINTS_OVERFLOW',
      `the Active Constraint Set for chapter ${scope.chapterNo} needs ${tokenCount} tokens but policy.context.active_constraints_cap_tokens is ${opts.capTokens}; consolidate or narrow the scope of ${all.length} in-scope requirements (hard requirements are never trimmed)`,
      {
        tokenCount,
        capTokens: opts.capTokens,
        hard: hard.length,
        soft: soft.length,
        assumptions: assumptions.length,
      },
    );
  }
  return {
    id: uuidFromHash(contentHash),
    contentHash,
    specVersion: spec.version,
    chapterNo: scope.chapterNo,
    hard,
    soft,
    assumptions,
    conflicts,
    renderedText,
    hardText,
    tokenCount,
    itemIds: [...included].sort(cmp),
    excluded: excluded.sort((a, b) => cmp(a.id, b.id)),
  };
}
