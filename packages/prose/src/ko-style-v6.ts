/**
 * Korean webnovel lint, lang/ko@6 rules (ADR-0073, K5). Like the v5 rules, each runs only when the language
 * layer carries its threshold, so projects pinned to lang/ko@5 or earlier lint byte for byte as before.
 *
 * Already covered by earlier layers and not repeated here: repeated sentence endings (KO-END-02),
 * third-person pronouns 그/그녀 (TRN-KO-14, KO-PRN-RATE), ~에 의해 and ~되어지다 (TRN-KO-05/08),
 * ~것이다 overuse (KO-OVR-01, TRN-KO-11).
 *
 *   - KO-PUNCT-ELL / KO-PUNCT-DASH: ellipses (… or ...) and dashes (— ―) per 1,000자. Both are common in
 *     translated prose; the mobile serial uses them sparingly.
 *   - KO-IDIOM-01: Western idiom calques from the layer's `calque_phrases` (어깨를 으쓱, 한쪽 눈썹을 치켜…).
 *   - KO-ORDER-01: English-order modifier chains — narration sentences stacking three or more unmistakable
 *     adnominal forms (~하는, ~되는, ~있는, ~했던, ~적인 …) before their noun.
 *   - KO-NAME-03: misspelled names beyond one syllable: transposed syllables (진서우 for 서진우), a name split
 *     by a space (서 진우) and a doubled syllable (서진진우).
 */
import { editDistance, jamo } from './ko-style-v5.js';
import { type Paragraph } from './paragraphs.js';
import { codePointLength } from './codepoints.js';

interface Threshold {
  readonly warn: number;
  readonly fail: number;
}
type Thresholds = Readonly<Record<string, Threshold | undefined>>;

export interface V6Finding {
  readonly rule_id: string;
  readonly kind: 'translation_like_english' | 'naming_registry_violation' | 'format_drift';
  readonly severity: 'minor' | 'major';
  readonly message: string;
  readonly paragraph_ids: readonly string[];
  readonly quote?: string | undefined;
  readonly value?: number | undefined;
  readonly threshold?: number | undefined;
}

export interface V6Metrics {
  readonly ellipsis_per_1k: number;
  readonly dash_per_1k: number;
  readonly idioms: number;
  readonly modifier_chain_ratio: number;
}

export const V6_RULES = [
  'KO-PUNCT-ELL',
  'KO-PUNCT-DASH',
  'KO-IDIOM-01',
  'KO-ORDER-01',
  'KO-NAME-03',
];

const ELLIPSIS = /…+|\.{3,}/gu;
const DASH = /[—―]+/gu;
const QUOTED = /“[^”]*”|‘[^’]*’/gu;
/** Eojeols whose ending is unmistakably adnominal (modifies the following noun). */
const ADNOMINAL =
  /^[가-힣]*(?:하는|되는|있는|없는|하던|했던|되던|되었던|됐던|같은|다운|스러운|적인|로운|받는|당한|[가-힣]{2}한)$/u;
/** First-person forms in narration (나는/내가/나를/내/나의/나에게…). */
const FIRST_PERSON = /(?<![가-힣])(?:나는|내가|나를|나의|나에게|나도|나만|내게|내)(?![가-힣])/gu;
const PARTICLE =
  /(?:에게서|에게|한테|께서|이랑|랑|이나|이야|이여|씨|님|은|는|이|가|을|를|의|와|과|도|만|아|야|에|로|으로)$/u;

function permutations(chars: readonly string[]): string[] {
  if (chars.length <= 1) return [chars.join('')];
  const out = new Set<string>();
  chars.forEach((c, i) => {
    for (const rest of permutations([...chars.slice(0, i), ...chars.slice(i + 1)]))
      out.add(c + rest);
  });
  return [...out];
}

export function lintV6(input: {
  readonly text: string;
  readonly paragraphs: readonly Paragraph[];
  readonly chars: number;
  readonly thresholds: Thresholds | undefined;
  readonly personNames: readonly string[];
  readonly allowlist: readonly string[];
  readonly calquePhrases: readonly string[];
  /**
   * Registered characters' full display names (no short forms or aliases). KO-NAME-03/04 compare against
   * these only: the live Phase A chapter showed aliases (쓰레기, 곰탱이) and two-syllable short forms
   * (수아, 지수) matching ordinary words (defect A-2, ADR-0074).
   */
  readonly displayNames?: readonly string[] | undefined;
  /** The project's point of view (ADR-0073); KO-POV-01 runs only when it is known. */
  readonly pov?: 'first' | 'third_limited' | 'third_omniscient' | undefined;
}): { findings: V6Finding[]; metrics: V6Metrics | undefined } {
  const t = input.thresholds ?? {};
  if (!V6_RULES.some((id) => t[id])) return { findings: [], metrics: undefined };
  const findings: V6Finding[] = [];
  const per1k = (n: number) => Math.round((n / input.chars) * 1000 * 100) / 100;
  const idsMatching = (re: RegExp) =>
    input.paragraphs
      .filter((p) => new RegExp(re.source, re.flags.replace('g', '')).test(p.text))
      .map((p) => p.id);
  const gate = (
    id: string,
    value: number,
    message: (th: Threshold) => string,
    kind: V6Finding['kind'],
    ids: readonly string[],
  ) => {
    const th = t[id];
    if (!th || value < th.warn) return;
    const fail = value >= th.fail;
    findings.push({
      rule_id: id,
      kind,
      severity: fail ? 'major' : 'minor',
      message: message(th),
      paragraph_ids: ids.slice(0, 8),
      value,
      threshold: fail ? th.fail : th.warn,
    });
  };

  const ellipses = [...input.text.matchAll(ELLIPSIS)].length;
  gate(
    'KO-PUNCT-ELL',
    per1k(ellipses),
    (th) =>
      `말줄임표가 1,000자당 ${String(per1k(ellipses))}개 (기준 ${String(th.warn)}). 여운은 문장으로 끊고, 말줄임표는 망설임이 있는 대사에만 쓴다.`,
    'translation_like_english',
    idsMatching(ELLIPSIS),
  );
  const dashes = [...input.text.matchAll(DASH)].length;
  gate(
    'KO-PUNCT-DASH',
    per1k(dashes),
    (th) =>
      `줄표가 1,000자당 ${String(per1k(dashes))}개 (기준 ${String(th.warn)}). 줄표로 잇는 삽입구는 번역문 버릇이다. 문장을 나눈다.`,
    'translation_like_english',
    idsMatching(DASH),
  );

  const idiomHits: { phrase: string; id: string }[] = [];
  for (const phrase of input.calquePhrases) {
    if (!phrase.trim()) continue;
    for (const p of input.paragraphs)
      if (p.text.includes(phrase)) idiomHits.push({ phrase, id: p.id });
  }
  const idiomTh = t['KO-IDIOM-01'];
  if (idiomTh && idiomHits.length >= idiomTh.warn)
    for (const hit of idiomHits.slice(0, 8))
      findings.push({
        rule_id: 'KO-IDIOM-01',
        kind: 'translation_like_english',
        severity: idiomHits.length >= idiomTh.fail ? 'major' : 'minor',
        message: `서양식 관용 표현 “${hit.phrase}” — 한국 독자에게 번역문처럼 읽힌다. 인물의 반응을 한국어 몸짓과 말로 쓴다.`,
        paragraph_ids: [hit.id],
        quote: hit.phrase,
      });

  const narration = input.paragraphs.map((p) => ({ id: p.id, text: p.text.replace(QUOTED, ' ') }));
  const sentences = narration.flatMap((p) =>
    [...p.text.matchAll(/[^.!?…\n]+[.!?…]+/gu)].map((m) => ({ id: p.id, text: m[0] })),
  );
  const chained = sentences.filter(
    (s) =>
      s.text.split(/\s+/u).filter((w) => ADNOMINAL.test(w.replace(/[,.!?…]+$/u, ''))).length >= 3,
  );
  const chainRatio = sentences.length
    ? Math.round((chained.length / sentences.length) * 1000) / 1000
    : 0;
  gate(
    'KO-ORDER-01',
    chainRatio,
    (th) =>
      `수식어를 셋 이상 겹쳐 명사 앞에 쌓은 서술 문장이 ${String(Math.round(chainRatio * 100))}% (기준 ${String(Math.round(th.warn * 100))}%). 영어 어순의 관계절이다. 문장을 둘로 나누고 동작을 먼저 쓴다.`,
    'translation_like_english',
    [...new Set(chained.map((s) => s.id))],
  );

  const nameTh = t['KO-NAME-03'];
  if (nameTh) {
    const known = new Set([...input.allowlist, ...input.personNames]);
    const names = [
      ...new Set(
        (input.displayNames ?? input.personNames).filter((n) => /^[가-힣]{3,4}$/u.test(n)),
      ),
    ];
    const found = new Map<string, { name: string; id: string; how: string }>();
    for (const n of names) {
      const syll = Array.from(n);
      const swapped = permutations(syll).filter((w) => w !== n && !known.has(w));
      const split = syll
        .slice(1)
        .map((_, i) => `${syll.slice(0, i + 1).join('')} ${syll.slice(i + 1).join('')}`);
      const doubled = syll.map((c, i) =>
        [...syll.slice(0, i + 1), c, ...syll.slice(i + 1)].join(''),
      );
      for (const p of input.paragraphs) {
        for (const m of p.text.matchAll(/[가-힣]{3,8}/gu)) {
          const word = m[0].replace(PARTICLE, '');
          if (known.has(word)) continue;
          // The misspelled form followed by at most a short ending (진서우가, 서진진우라니).
          const at = (forms: readonly string[]) =>
            forms.find(
              (f) => word.startsWith(f) && Array.from(word).length - Array.from(f).length <= 3,
            );
          const sw = at(swapped);
          const db = sw ? undefined : at(doubled);
          const hit = sw ?? db;
          if (hit && !found.has(hit) && !known.has(hit))
            found.set(hit, { name: n, id: p.id, how: sw ? '글자 순서' : '겹친 글자' });
        }
        for (const s of split)
          if (p.text.includes(s) && !found.has(s))
            found.set(s, { name: n, id: p.id, how: '띄어쓰기' });
      }
    }
    if (found.size >= nameTh.warn)
      for (const [word, { name, id, how }] of found)
        findings.push({
          rule_id: 'KO-NAME-03',
          kind: 'naming_registry_violation',
          severity: found.size >= nameTh.fail ? 'major' : 'minor',
          message: `등록된 이름 ‘${name}’의 ${how} 오류로 보인다: “${word}”.`,
          paragraph_ids: [id],
          quote: word,
        });
  }

  // KO-NAME-04 (replaces KO-NAME-02 in lang/ko@6; defect A-2): a word a jamo or two from a registered
  // full name. Only display names of three or four syllables are targets; a two-jamo distance counts only
  // when exactly one syllable differs, a one-jamo distance may span syllables (서지누 for 서진우).
  const name4 = t['KO-NAME-04'];
  if (name4) {
    const known = new Set([...input.allowlist, ...input.personNames]);
    const targets = [
      ...new Set((input.displayNames ?? []).filter((n) => /^[가-힣]{3,4}$/u.test(n))),
    ];
    const found = new Map<string, { name: string; id: string }>();
    for (const p of input.paragraphs)
      for (const m of p.text.matchAll(/[가-힣]{3,8}/gu)) {
        const raw = m[0].replace(PARTICLE, '');
        if (Array.from(raw).length < 3 || known.has(raw)) continue;
        for (const n of targets) {
          const b = Array.from(n);
          // The word's first syllables against the name (백도헌이었다 → 백도헌), as KO-NAME-01 reads them.
          const a = Array.from(raw).slice(0, b.length);
          const word = a.join('');
          if (a.length !== b.length || a[0] !== b[0] || known.has(word) || found.has(word))
            continue;
          const d = editDistance(jamo(word), jamo(n));
          const differing = a.filter((ch, i) => ch !== b[i]).length;
          if (d === 1 || (d === 2 && differing === 1)) {
            found.set(word, { name: n, id: p.id });
            break;
          }
        }
      }
    if (found.size >= name4.warn)
      for (const [word, { name, id }] of found)
        findings.push({
          rule_id: 'KO-NAME-04',
          kind: 'naming_registry_violation',
          severity: found.size >= name4.fail ? 'major' : 'minor',
          message: `등록된 이름과 자모 한두 개가 다르다: “${word}” — ‘${name}’의 오기인지 확인한다.`,
          paragraph_ids: [id],
          quote: word,
        });
  }

  // KO-POV-01: narration against the project's point of view. First person: narration that never says
  // ‘나’ has slipped into third person. Third person: ‘나’ in narration (outside dialogue and 속마음).
  const povTh = t['KO-POV-01'];
  if (povTh && input.pov) {
    const hits = narration.flatMap((p) => [...p.text.matchAll(FIRST_PERSON)].map(() => p.id));
    if (input.pov === 'first') {
      if (hits.length === 0 && input.chars >= 800)
        findings.push({
          rule_id: 'KO-POV-01',
          kind: 'format_drift',
          severity: 'major',
          message: '1인칭 시점인데 서술에 ‘나’가 한 번도 없다. 시점 인물을 ‘나’로 서술한다.',
          paragraph_ids: [],
        });
    } else if (hits.length >= povTh.warn)
      findings.push({
        rule_id: 'KO-POV-01',
        kind: 'format_drift',
        severity: hits.length >= povTh.fail ? 'major' : 'minor',
        message: `3인칭 시점인데 서술에 ‘나’가 ${String(hits.length)}번 나온다. 대사와 속마음 밖에서는 이름과 호칭으로 쓴다.`,
        paragraph_ids: [...new Set(hits)].slice(0, 8),
        value: hits.length,
        threshold: hits.length >= povTh.fail ? povTh.fail : povTh.warn,
      });
  }

  return {
    findings,
    metrics: {
      ellipsis_per_1k: per1k(ellipses),
      dash_per_1k: per1k(dashes),
      idioms: idiomHits.length,
      modifier_chain_ratio: chainRatio,
    },
  };
}

/**
 * ADR-0090 (live defect G8-5): a first-person scene narrated in the third person — the narration names the POV
 * character as subject or object and hardly says ‘나’. KO-POV-01 reads the whole chapter, so one first-person
 * scene hid two third-person ones.
 */
export function thirdPersonDrift(
  text: string,
  povNames: readonly string[],
): { firstPerson: number; named: number; drifted: boolean } {
  const narration = text.replace(QUOTED, ' ');
  const firstPerson = [...narration.matchAll(FIRST_PERSON)].length;
  const names = [...new Set(povNames.map((n) => n.trim()).filter((n) => codePointLength(n) >= 2))];
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const named = escaped.length
    ? [
        ...narration.matchAll(
          new RegExp(
            `(?<![가-힣])(?:${escaped.join('|')})(?:은|는|이|가|을|를|의|에게|도|만|과|와)`,
            'gu',
          ),
        ),
      ].length
    : 0;
  return { firstPerson, named, drifted: named >= 3 && firstPerson <= 1 };
}
