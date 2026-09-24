/**
 * The bible's cast in three checkpointed batches (ADR-0072, `planning.design_batches`).
 *
 * Live, the one `character_designer` call that designs 6–12 characters with every register (up to 7,000
 * output tokens) failed on the Notion bridge three times in a row with HTTP 502 after ~16 minutes each,
 * and the whole bible waited on it. Three smaller calls — protagonist, core cast, supporting cast — each
 * produce a fraction of that output, and each is its own checkpoint, so a rerun resumes after the last
 * batch that completed instead of paying for the whole cast again.
 *
 * The same prompt (`character_designer`) runs each batch; only the workflow-written cast brief differs.
 * Later batches receive the names already designed, must not redesign them, and add one entry for the
 * protagonist carrying only the registers toward the new characters, which the merge folds into the
 * protagonist's design.
 */
import { type StoryIntake } from './planning.js';

export const CAST_BATCHES = ['protagonist', 'core', 'supporting'] as const;
export type CastBatch = (typeof CAST_BATCHES)[number];

export interface CastRegister {
  toward?: string;
  [k: string]: unknown;
}
export interface CastCharacter {
  display_name?: string;
  role?: string;
  registers?: CastRegister[];
  [k: string]: unknown;
}
export interface CastBatchOutput {
  characters?: CastCharacter[];
  propositions?: { statement?: string; [k: string]: unknown }[];
  [k: string]: unknown;
}

const ROLE_KO: Readonly<Record<string, string>> = {
  protagonist: '주인공',
  antagonist: '적대자',
  ally: '동료',
  mentor: '스승',
  love_interest: '연애 상대',
  foil: '대비 인물',
};

const keyOf = (name: unknown): string =>
  typeof name === 'string' ? name.trim().toLowerCase() : '';

function designedLine(c: CastCharacter, lang: 'en' | 'ko'): string {
  const name = (c.display_name ?? '').trim();
  const role = c.role ? (lang === 'ko' ? ROLE_KO[c.role] : c.role) : undefined;
  return role ? `${name}(${role})` : name;
}

function sketch(c: NonNullable<StoryIntake['main_character']>, lang: 'en' | 'ko'): string {
  // Intake roles are schema enum values; a Korean brief names them in Korean.
  const role = c.role ? (lang === 'ko' ? (ROLE_KO[c.role] ?? c.role) : c.role) : undefined;
  return [
    c.name,
    role ? `(${role})` : '',
    c.description ?? '',
    c.speech_notes ? `${lang === 'ko' ? '말투' : 'Speech'}: ${c.speech_notes}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Supplied character names (intake) that no batch has designed yet. */
export function missingSuppliedNames(
  intake: StoryIntake,
  designed: readonly CastCharacter[],
): string[] {
  const have = new Set(designed.map((c) => keyOf(c.display_name)));
  return [intake.main_character, ...(intake.supporting_characters ?? [])]
    .filter((c): c is NonNullable<StoryIntake['main_character']> => c !== undefined)
    .map((c) => c.name.trim())
    .filter((n) => n.length > 0 && !have.has(keyOf(n)));
}

/** The cast brief for one batch, in the manuscript language. */
export function castBatchBrief(
  batch: CastBatch,
  lang: 'en' | 'ko',
  input: { intake: StoryIntake; designed: readonly CastCharacter[] },
): string {
  const { intake, designed } = input;
  const protagonist = designed.find((c) => c.role === 'protagonist') ?? designed[0];
  const protagonistName = (protagonist?.display_name ?? '').trim();
  const designedList = designed.map((c) => designedLine(c, lang)).join(', ');
  const missing = missingSuppliedNames(intake, designed);
  if (lang === 'ko') {
    if (batch === 'protagonist')
      return [
        intake.main_character
          ? `주인공: ${sketch(intake.main_character, lang)}`
          : '주인공: 전제와 콘셉트에서 도출한다.',
        '이번 호출에서는 주인공 한 명만 설계한다. characters 배열에는 주인공 한 명만 넣는다. 핵심 인물과 조연은 다음 호출에서 따로 설계하므로 지금은 만들지 않는다. 주인공의 registers는 비워 둔다.',
        '위에 이름이 주어진 주인공은 그 이름 그대로 쓴다.',
      ].join('\n');
    const supplied = (intake.supporting_characters ?? [])
      .filter((c) => missing.includes(c.name.trim()))
      .map((c) => `조연: ${sketch(c, lang)}`);
    const scope =
      batch === 'core'
        ? '이번 호출에서는 핵심 인물 3~5명을 설계한다: 적대자, 동료·스승 1~2명, 로맨스가 있으면 연애 상대(하렘이면 히로인마다 등장 시기와 관계 단계가 다르게).'
        : '이번 호출에서는 조연 2~4명을 설계한다: 대비 인물 하나 이상과, 이야기에 필요한 조력자·주변 인물.';
    return [
      `이미 설계된 인물: ${designedList}. 이 인물들은 다시 설계하지 않는다.`,
      scope,
      ...supplied,
      ...(missing.length > 0 && batch === 'supporting'
        ? [
            `위에 이름이 주어졌지만 아직 설계되지 않은 인물은 이번에 반드시 그 이름 그대로 포함한다: ${missing.join(', ')}.`,
          ]
        : []),
      `새 인물은 모두 주요 상대마다 말높이(registers)를 가지며, ${protagonistName}을(를) 향한 registers를 반드시 포함한다.`,
      `마지막으로 characters 배열 끝에 display_name이 ${protagonistName}이고 registers만 있는 항목 하나를 넣어, ${protagonistName}이(가) 이번에 설계한 인물 각각을 향할 때의 말높이를 적는다.`,
    ].join('\n');
  }
  if (batch === 'protagonist')
    return [
      intake.main_character
        ? `Main character: ${sketch(intake.main_character, lang)}`
        : 'Main character: derive from the premise and concept.',
      'Design only the protagonist in this call: the characters array holds exactly one character. The core and supporting cast are designed in later calls, so do not create them now; leave the protagonist’s registers empty.',
      'Keep a supplied protagonist’s name exactly.',
    ].join('\n');
  const supplied = (intake.supporting_characters ?? [])
    .filter((c) => missing.includes(c.name.trim()))
    .map((c) => `Supporting: ${sketch(c, lang)}`);
  const scope =
    batch === 'core'
      ? 'Design the core cast in this call, 3–5 characters: antagonist(s), 1–2 allies/mentors, a love interest if romance is present.'
      : 'Design the supporting cast in this call, 2–4 characters: at least one foil, plus the helpers the story needs.';
  return [
    `Already designed: ${designedList}. Do not redesign them.`,
    scope,
    ...supplied,
    ...(missing.length > 0 && batch === 'supporting'
      ? [
          `Supplied characters not designed yet must be included now under their exact names: ${missing.join(', ')}.`,
        ]
      : []),
    `Every new character needs registers toward each key counterpart, including ${protagonistName}.`,
    `Finally, append one entry whose display_name is ${protagonistName} with only registers: how ${protagonistName} addresses each character designed in this call.`,
  ].join('\n');
}

/**
 * Merge batch outputs in order. The first design of a name wins; a later entry with the same name
 * contributes only registers toward counterparts the first design does not address yet. Propositions are
 * concatenated without repeating a statement.
 */
export function mergeCastBatches(outputs: readonly CastBatchOutput[]): CastBatchOutput {
  const characters: CastCharacter[] = [];
  const index = new Map<string, number>();
  const propositions: NonNullable<CastBatchOutput['propositions']> = [];
  const statements = new Set<string>();
  for (const out of outputs) {
    for (const c of out.characters ?? []) {
      const key = keyOf(c.display_name);
      if (!key) continue;
      const at = index.get(key);
      if (at === undefined) {
        index.set(key, characters.length);
        characters.push({ ...c, ...(c.registers ? { registers: [...c.registers] } : {}) });
        continue;
      }
      const existing = characters[at];
      if (!existing) continue;
      const toward = new Set((existing.registers ?? []).map((r) => keyOf(r.toward)));
      const registers = Array.isArray(c.registers) ? c.registers : [];
      const added = registers.filter((r: unknown): r is CastRegister => {
        if (typeof r !== 'object' || r === null) return false;
        const k = keyOf((r as CastRegister).toward);
        if (!k || toward.has(k) || k === key) return false;
        toward.add(k);
        return true;
      });
      if (added.length > 0)
        characters[at] = { ...existing, registers: [...(existing.registers ?? []), ...added] };
    }
    for (const p of out.propositions ?? []) {
      const s = (p.statement ?? '').trim().toLowerCase();
      if (!s || statements.has(s)) continue;
      statements.add(s);
      propositions.push(p);
    }
  }
  return { characters, propositions };
}

/** Characters of a batch that are new, i.e. not a register-only entry for someone already designed. */
export function newCharacters(
  batch: CastBatchOutput,
  designed: readonly CastCharacter[],
): CastCharacter[] {
  const have = new Set(designed.map((c) => keyOf(c.display_name)));
  return (batch.characters ?? []).filter((c) => {
    const k = keyOf(c.display_name);
    return k.length > 0 && !have.has(k);
  });
}
