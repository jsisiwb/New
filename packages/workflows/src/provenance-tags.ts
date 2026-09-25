/**
 * Provenance tags label context items for the model and stay identifiers in the prompt (ADR-0055). A designer or
 * planner that copies one into its answer turns prompt metadata into story data: in G7 the concept, power system
 * and blueprint carried `[FACT]`/`[PLANNED]`/`[SUMMARY]`, and three locked bible facts read "… [PLANNED] …".
 */

/** Pre-draft roles: their answers are design data and never quote a draft span, so a tag is never meaningful. */
export const DESIGN_FAMILIES: ReadonlySet<string> = new Set([
  'requirement_interpreter',
  'concept_generator',
  'character_designer',
  'world_builder',
  'power_system_designer',
  'story_architect',
  'arc_planner',
  'chapter_planner',
  'scene_planner',
  'plan_critic',
]);

// `[FACT]`, `[FACT v128 ch.12]`, `[SUMMARY L2]`, `[EVIDENCE ch.9 ¶14]` … (docs/05-generation/03-prompt-architecture.md);
// a status window such as `[이름: 카일]` never starts with one of these words.
const TAG = /\[(?:FACT|PLANNED|SUMMARY|EVIDENCE|UNTRUSTED)(?:[ \t][^\]\n]{0,40})?\][ \t]*/gu;

export function stripProvenanceTags(text: string): string {
  const out = text.replace(TAG, '');
  if (out === text) return text;
  return out.replace(/[ \t]{2,}/gu, ' ').replace(/[ \t]+$/gmu, '');
}

/** Every string leaf with its tags removed; `removed` counts the leaves that changed. */
export function stripProvenanceTagsDeep<T>(value: T): { value: T; removed: number } {
  let removed = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const s = stripProvenanceTags(v);
      if (s !== v) removed++;
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(value) as T;
  return { value: removed ? out : value, removed };
}
