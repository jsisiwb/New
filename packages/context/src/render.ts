/**
 * Deterministic English renderers for canon rows and the Chapter Contract (docs/04-memory-canon/04 §2.4). No
 * LLM is involved; every renderer is a pure function of its inputs so identical rows give identical bytes.
 * Plans are always rendered under a PLANNED label and in the conditional mood ("must happen"), never as
 * events that occurred.
 */
import { elapsedDays, type StoryClock } from '@yeonjae/domain';
import { countWords } from './hash.js';
import { type ChapterContract } from './types.js';

export type NameOf = (id: string) => string;

export function clockLabel(c: StoryClock | null | undefined): string {
  if (!c) return 'open';
  const world = c.world_date ? ` (${c.world_date}${c.precision === 'approx' ? ' ±' : ''})` : '';
  return `ch.${c.chapter_no}.${c.ordinal}${world}`;
}

export function trimQuote(quote: string, maxWords = 60): string {
  const words = quote.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return quote;
  return `${words.slice(0, maxWords).join(' ')} …`;
}

export function valueLabel(value: unknown, valueText: string | null | undefined): string {
  if (valueText) return valueText;
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function attributeLabel(attribute: string, key: string | null | undefined): string {
  return key ? `${attribute}[${key}]` : attribute;
}

export interface RegisterLike {
  formality?: number | undefined;
  deference?: number | undefined;
  familiarity?: number | undefined;
  intimacy?: number | undefined;
  directness?: number | undefined;
  contractions?: string | undefined;
  hedging?: string | undefined;
  address_terms?: string[] | undefined;
  titles?: string[] | undefined;
}

export function registerLabel(r: RegisterLike | null | undefined): string {
  if (!r) return 'register unspecified';
  const parts: string[] = [];
  for (const k of ['formality', 'deference', 'familiarity', 'intimacy', 'directness'] as const) {
    const v = r[k];
    if (v !== undefined) parts.push(`${k} ${v}`);
  }
  if (r.contractions) parts.push(`contractions ${r.contractions}`);
  if (r.hedging) parts.push(`hedging ${r.hedging}`);
  if (r.address_terms?.length)
    parts.push(`address terms: ${r.address_terms.map((t) => `"${t}"`).join(', ')}`);
  if (r.titles?.length) parts.push(`titles: ${r.titles.map((t) => `"${t}"`).join(', ')}`);
  return parts.join('; ');
}

export function elapsedLabel(from: StoryClock | undefined, to: StoryClock): string | undefined {
  if (!from) return undefined;
  const e = elapsedDays(from, to);
  if (!e.comparable) return undefined;
  const days = Math.round(e.days * 10) / 10;
  return `${days} day${days === 1 ? '' : 's'} of story time (${from.world_date ?? '?'} → ${to.world_date ?? '?'})`;
}

/** The Chapter Contract as PLANNED text: objectives, not history. */
export function renderContract(c: ChapterContract, nameOf: NameOf): string {
  const lines: string[] = [];
  lines.push(
    `Chapter ${c.chapter_number} contract v${c.version} (${c.status}) — everything below is PLANNED and has not happened yet.`,
  );
  lines.push(`Purpose: ${c.purpose}`);
  if (c.reader_experience) lines.push(`Reader experience: ${c.reader_experience}`);
  if (c.arc_objective_contribution) lines.push(`Arc contribution: ${c.arc_objective_contribution}`);
  lines.push(
    `POV: ${nameOf(c.pov.character_id)} (${c.pov.person.replace('_', ' ')}). Participants: ${c.participants
      .map(
        (p) => `${nameOf(p.character_id)} [${p.role_in_chapter}${p.on_page ? '' : ', off-page'}]`,
      )
      .join('; ')}.`,
  );
  if (c.mentioned_only?.length)
    lines.push(`Mentioned only: ${c.mentioned_only.map(nameOf).join(', ')}.`);
  lines.push(`Locations: ${c.locations.map(nameOf).join(', ') || '—'}.`);
  lines.push(
    `Story time: ${clockLabel(c.story_time.start)} → ${clockLabel(c.story_time.end)}${
      c.story_time.elapsed_since_previous
        ? `; since previous chapter: ${c.story_time.elapsed_since_previous}`
        : ''
    }.`,
  );
  lines.push('Must happen (PLANNED):');
  for (const m of c.must_happen)
    lines.push(`- ${m.id} (${m.kind}; verified by ${m.verifiable_by}): ${m.description}`);
  lines.push('Must NOT happen:');
  for (const m of c.must_not_happen)
    lines.push(
      `- ${m.id} [${m.source}${m.requirement_id ? ` ${m.requirement_id}` : ''}]: ${m.description}`,
    );
  if (c.state_deltas.length) {
    lines.push('Planned state changes (PLANNED — not yet true):');
    for (const d of c.state_deltas)
      lines.push(
        `- ${nameOf(d.entity_id)} · ${attributeLabel(d.attribute, d.key)}: ${valueLabel(d.from, undefined)} → ${valueLabel(d.to, undefined)}${
          d.when_in_chapter ? ` (${d.when_in_chapter})` : ''
        }${d.description ? ` — ${d.description}` : ''}`,
      );
  }
  if (c.knowledge_deltas.length) {
    lines.push('Planned knowledge changes (PLANNED — require an on-page channel):');
    for (const d of c.knowledge_deltas) {
      const who =
        d.knower.kind === 'character' && d.knower.entity_id
          ? nameOf(d.knower.entity_id)
          : d.knower.kind;
      lines.push(
        `- ${who}: ${d.from_stance} → ${d.to_stance}${d.proposition_id ? ` on ${d.proposition_id}` : ''} — ${d.how}`,
      );
    }
  }
  if (c.relationship_deltas.length) {
    lines.push('Planned relationship changes (PLANNED):');
    for (const d of c.relationship_deltas)
      lines.push(
        `- ${nameOf(d.from_id)} → ${nameOf(d.to_id)}: ${d.axis} ${d.direction}${d.new_type ? ` to ${d.new_type}` : ''}${
          d.address_term_change?.length
            ? `; address terms → ${d.address_term_change.map((t) => `"${t}"`).join(', ')}`
            : ''
        }${d.description ? ` — ${d.description}` : ''}`,
      );
  }
  if (c.setups.length || c.payoffs.length) {
    lines.push('Promises touched (PLANNED):');
    for (const s of c.setups) lines.push(`- setup/${s.kind ?? 'touch'} ${s.promise_id}: ${s.how}`);
    for (const s of c.payoffs) lines.push(`- payoff/${s.kind ?? 'pay'} ${s.promise_id}: ${s.how}`);
  }
  if (c.progression?.milestone_id)
    lines.push(
      `Progression: ${c.progression.milestone_id} (${c.progression.magnitude ?? 'minor'}) via ${c.progression.mechanism ?? '—'}.`,
    );
  lines.push(
    `Emotional movement: ${c.emotional_movement.start} → ${c.emotional_movement.peak ? `${c.emotional_movement.peak} → ` : ''}${c.emotional_movement.end}.`,
  );
  lines.push(
    `Conflict (${c.conflict.type}): ${c.conflict.description}${c.conflict.reversal ? ` Reversal: ${c.conflict.reversal}` : ''}`,
  );
  lines.push(
    `Local satisfaction: ${c.local_satisfaction.map((s) => `${s.type} — ${s.description}`).join('; ')}.`,
  );
  lines.push(`Opening (${c.opening.type}): ${c.opening.description}`);
  lines.push(`Ending state (PLANNED): ${c.ending_state}`);
  lines.push(
    `Hook (${c.hook.type}): ${c.hook.description}${c.hook.question_raised ? ` Question raised: ${c.hook.question_raised}` : ''}`,
  );
  lines.push(
    `Shape: ${c.scene_count} scenes; dialogue density target ${c.dialogue_density_target}; length ${c.length_target.value} ${c.length_target.unit} ±${Math.round(
      (c.length_target.tolerance_ratio ?? 0) * 100,
    )}%.`,
  );
  if (c.continuity_risks.length) {
    lines.push('Continuity risks:');
    for (const r of c.continuity_risks)
      lines.push(`- ${r.description}${r.mitigation ? ` (mitigation: ${r.mitigation})` : ''}`);
  }
  if (c.continuity_anchors.length) {
    lines.push('Continuity anchors (canon the chapter depends on):');
    for (const a of c.continuity_anchors)
      lines.push(
        `- ${a.statement}${a.evidence?.length ? ` — evidence ch.${a.evidence[0]?.chapter_no ?? '?'} ${a.evidence[0]?.paragraph_id ?? ''} “${trimQuote(a.evidence[0]?.quote ?? '')}”` : ''}`,
      );
  }
  lines.push(
    `Acceptance criteria: ${c.acceptance_criteria.map((a) => `${a.id} (${a.kind}${a.threshold !== undefined ? ` ≥ ${a.threshold}` : ''})`).join(', ')}.`,
  );
  return lines.join('\n');
}

/** Chapter text with stable paragraph ids for checkers/extractors. */
export function renderWithParagraphIds(
  paragraphs: readonly { id: string; text: string }[],
): string {
  return paragraphs.map((p) => `[${p.id}] ${p.text}`).join('\n\n');
}

export function wordsOf(text: string): number {
  return countWords(text);
}
