/**
 * Korean webnovel lint, lang/ko@5 rules (ADR-0065). Every rule runs only when the language layer carries its
 * threshold, so projects pinned to an earlier layer lint byte-for-byte as before.
 */
import { type Paragraph } from './paragraphs.js';
import { parseStatusWindows } from './status-window.js';
import { toNfcText } from './nfc.js';

interface Threshold {
  readonly warn: number;
  readonly fail: number;
}
type Thresholds = Readonly<Record<string, Threshold | undefined>>;

export interface V5Finding {
  readonly rule_id: string;
  readonly kind:
    | 'translation_like_english'
    | 'weak_pacing'
    | 'weak_ending'
    | 'naming_registry_violation'
    | 'format_drift'
    | 'other';
  readonly severity: 'minor' | 'major';
  readonly message: string;
  readonly paragraph_ids: readonly string[];
  readonly quote?: string | undefined;
  readonly value?: number | undefined;
  readonly threshold?: number | undefined;
}

export interface V5Metrics {
  readonly overuse_per_1k: Readonly<Record<string, number>>;
  readonly comma_per_1k: number;
  readonly sentence_mean_chars: number;
  readonly sentence_p90_chars: number;
  readonly long_sentence_ratio: number;
  readonly talk_share: number;
}

/** 번역체/AI-prose constructions whose rate per 1,000자 is gated (KO-OVR-01..04). */
export const OVERUSE: readonly { id: string; label: string; pattern: RegExp }[] = [
  { id: 'KO-OVR-01', label: '~것이다/것이었다', pattern: /것이(?:다|었다)(?=[.!?…”’\s]|$)/gu },
  { id: 'KO-OVR-02', label: '~ㄹ 수 있었다', pattern: /[가-힣] 수 있었다/gu },
  { id: 'KO-OVR-03', label: '~기 시작했다', pattern: /기 시작했다/gu },
  { id: 'KO-OVR-04', label: '~것이 느껴졌다', pattern: /것이 느껴졌다/gu },
];

/**
 * Reflective or summary chapter endings (KO-END-03, replacing the single KO-END-01 pattern): the narrator steps
 * back instead of cutting on a crisis, a reveal, an arrival or a decision.
 */
export const REFLECTIVE_ENDINGS: readonly RegExp[] = [
  /그렇게 .{0,24}(하루|밤|날|하루하루|시간)(가|이|은|는)? ?(저물|지나|흘러|끝나)/u,
  /시작에 (불과|지나지 않)/u,
  /(세상|인생|사람|운명)(은|이란|이라는 것은) (원래|언제나|늘|결국|그렇게)/u,
  /(아직|그때는) (아무도|누구도|그 누구도) (몰랐다|알지 못했다)/u,
  /(앞으로|이제부터) (어떤|무슨) (일|운명|시련)(이|들이) .{0,16}(기다리|펼쳐질|닥칠)/u,
  /운명의 (수레바퀴|톱니바퀴)/u,
  /(모든 것이|모든 게) (달라질|바뀔|시작될) (것이다|터였다)/u,
  /(새로운|또 다른) (이야기|여정|시작)(가|이)? ?(시작되|펼쳐지|열리)/u,
  /(그것이|그게) (모든 것의 )?시작이었다/u,
];

const HANGUL = 0xac00;
const CHO = Array.from('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ');
const JUNG = Array.from('ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ');
const JONG = ['', ...Array.from('ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ')];

/**
 * Hangul syllables as compatibility jamo letters. Initial and final consonants share letters, so a name
 * misspelled by resyllabification (서지누 for 서진우) is one letter away, as it sounds.
 */
export function jamo(word: string): string[] {
  const out: string[] = [];
  for (const ch of word) {
    const cp = (ch.codePointAt(0) ?? 0) - HANGUL;
    if (cp < 0 || cp > 11171) {
      out.push(ch);
      continue;
    }
    out.push(CHO[Math.floor(cp / 588)] ?? '', JUNG[Math.floor((cp % 588) / 28)] ?? '');
    const f = JONG[cp % 28];
    if (f) out.push(f);
  }
  return out;
}

export function editDistance(a: readonly string[], b: readonly string[]): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] ?? 0;
      row[j] = Math.min(
        (row[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[b.length] ?? 0;
}

const PARTICLE =
  /(?:에게서|에게|한테|께서|이랑|랑|이나|이야|이여|씨|님|은|는|이|가|을|를|의|와|과|도|만|아|야|에|로|으로)$/u;

function shingles(text: string, n: number): Set<string> {
  const t = Array.from(text.replace(/\s+/gu, ''));
  const out = new Set<string>();
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n).join(''));
  return out;
}

const QUOTED = /“[^”]*”|‘[^’]*’/gu;

export function lintV5(input: {
  readonly text: string;
  readonly paragraphs: readonly Paragraph[];
  readonly chars: number;
  readonly thresholds: Thresholds | undefined;
  readonly personNames: readonly string[];
  readonly allowlist: readonly string[];
  readonly exemplarTexts: readonly string[];
}): { findings: V5Finding[]; metrics: V5Metrics | undefined } {
  const t = input.thresholds ?? {};
  const v5 = [
    'KO-OVR-01',
    'KO-COMMA-RATE',
    'KO-SENT-LONG',
    'KO-DLG-SHARE',
    'KO-END-03',
    'EXEMPLAR-NEAR',
    'KO-NAME-02',
    'KO-WIN-LINE',
  ];
  if (!v5.some((id) => t[id])) return { findings: [], metrics: undefined };
  const findings: V5Finding[] = [];
  const per1k = (n: number) => Math.round((n / input.chars) * 1000 * 100) / 100;
  const narration = input.paragraphs.map((p) => ({ id: p.id, text: p.text.replace(QUOTED, ' ') }));
  const idsWith = (re: RegExp) =>
    input.paragraphs
      .filter((p) => new RegExp(re.source, re.flags.replace('g', '')).test(p.text))
      .map((p) => p.id);
  const gate = (
    id: string,
    value: number,
    message: (th: Threshold) => string,
    kind: V5Finding['kind'],
    ids: readonly string[],
    inverted = false,
  ) => {
    const th = t[id];
    if (!th) return;
    const warn = inverted ? value < th.warn : value >= th.warn;
    if (!warn) return;
    const fail = inverted ? value < th.fail : value >= th.fail;
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

  const overuse: Record<string, number> = {};
  for (const o of OVERUSE) {
    const n = [...input.text.matchAll(o.pattern)].length;
    overuse[o.id] = per1k(n);
    gate(
      o.id,
      per1k(n),
      (th) =>
        `‘${o.label}’ ${String(n)}회 (1,000자당 ${String(per1k(n))}, 기준 ${String(th.warn)}). 번역체 습관이다. 동작과 감각을 직접 쓴다.`,
      'translation_like_english',
      idsWith(o.pattern),
    );
  }

  const commas = narration.reduce((a, p) => a + [...p.text.matchAll(/,/gu)].length, 0);
  gate(
    'KO-COMMA-RATE',
    per1k(commas),
    (th) =>
      `서술 쉼표가 1,000자당 ${String(per1k(commas))}개 (기준 ${String(th.warn)}). 쉼표로 이어 붙인 문장을 끊는다.`,
    'translation_like_english',
    narration.filter((p) => /,.*,/u.test(p.text)).map((p) => p.id),
  );

  const sentences = narration
    .flatMap((p) =>
      [...p.text.matchAll(/[^.!?…\n]+[.!?…]+/gu)].map((m) => ({
        id: p.id,
        len: Array.from(m[0].trim()).length,
      })),
    )
    .filter((s) => s.len > 1);
  const lens = sentences.map((s) => s.len).sort((a, b) => a - b);
  const mean = lens.length
    ? Math.round((lens.reduce((a, b) => a + b, 0) / lens.length) * 10) / 10
    : 0;
  const p90 = lens.length
    ? (lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.9))] ?? 0)
    : 0;
  const longRatio = lens.length
    ? Math.round((sentences.filter((s) => s.len > 60).length / lens.length) * 1000) / 1000
    : 0;
  gate(
    'KO-SENT-LONG',
    longRatio,
    (th) =>
      `60자를 넘는 서술 문장 비율 ${String(Math.round(longRatio * 100))}% (기준 ${String(Math.round(th.warn * 100))}%). 모바일 호흡에 맞게 문장을 나눈다.`,
    'weak_pacing',
    [...new Set(sentences.filter((s) => s.len > 60).map((s) => s.id))],
  );

  const talkChars = input.paragraphs.reduce(
    (a, p) => a + [...p.text.matchAll(QUOTED)].reduce((b, m) => b + Array.from(m[0]).length, 0),
    0,
  );
  const talkShare = Math.round((talkChars / input.chars) * 1000) / 1000;
  gate(
    'KO-DLG-SHARE',
    talkShare,
    (th) =>
      `대사와 속마음(‘…’) 비중 ${String(Math.round(talkShare * 100))}% (기준 ${String(Math.round(th.warn * 100))}% 이상). 요약 서술을 대사와 반응 비트로 바꾼다.`,
    'weak_pacing',
    [],
    true,
  );

  const last = input.paragraphs[input.paragraphs.length - 1];
  if (t['KO-END-03'] && last && REFLECTIVE_ENDINGS.some((re) => re.test(last.text)))
    findings.push({
      rule_id: 'KO-END-03',
      kind: 'weak_ending',
      severity: 'major',
      message:
        '마지막 문단이 요약·관조로 닫힌다. 다음 화를 누르게 만드는 절단(위기·폭로·등장·결단)으로 끝낸다.',
      paragraph_ids: [last.id],
    });

  const near = t['EXEMPLAR-NEAR'];
  if (near && input.exemplarTexts.length) {
    const ex = new Set(input.exemplarTexts.flatMap((e) => [...shingles(toNfcText(e).text, 8)]));
    for (const p of input.paragraphs) {
      const sh = shingles(p.text, 8);
      if (sh.size < 12) continue;
      const shared = [...sh].filter((s) => ex.has(s)).length / sh.size;
      if (shared >= near.warn)
        findings.push({
          rule_id: 'EXEMPLAR-NEAR',
          kind: 'other',
          severity: shared >= near.fail ? 'major' : 'minor',
          message: `문단의 ${String(Math.round(shared * 100))}%가 스튜디오 예문과 거의 같다. 예문은 호흡 참고용이다. 자기 문장으로 다시 쓴다.`,
          paragraph_ids: [p.id],
          value: Math.round(shared * 1000) / 1000,
          threshold: shared >= near.fail ? near.fail : near.warn,
        });
    }
  }

  const nameTh = t['KO-NAME-02'];
  if (nameTh) {
    const known = new Set([...input.allowlist, ...input.personNames]);
    const names = [...new Set(input.personNames.filter((n) => /^[가-힣]{2,4}$/u.test(n)))];
    const found = new Map<string, { name: string; id: string }>();
    for (const p of input.paragraphs)
      for (const m of p.text.matchAll(/[가-힣]{2,6}/gu)) {
        const word = m[0].replace(PARTICLE, '');
        if (word.length < 2 || known.has(word) || found.has(word)) continue;
        for (const n of names) {
          if (
            Math.abs(Array.from(word).length - Array.from(n).length) > 1 ||
            !word.startsWith(n.slice(0, 1))
          )
            continue;
          const d = editDistance(jamo(word), jamo(n));
          // One or two jamo apart: 서지누 for 서진우, 서지얀 for 서지안; never an exact name, short form or alias.
          if (d >= 1 && d <= (Array.from(n).length >= 3 ? 2 : 1)) {
            found.set(word, { name: n, id: p.id });
            break;
          }
        }
      }
    if (found.size >= nameTh.warn)
      for (const [word, { name, id }] of found)
        findings.push({
          rule_id: 'KO-NAME-02',
          kind: 'naming_registry_violation',
          severity: found.size >= nameTh.fail ? 'major' : 'minor',
          message: `등록된 이름과 자모 한두 개가 다르다: “${word}” — ‘${name}’의 오기인지 확인한다.`,
          paragraph_ids: [id],
          quote: word,
        });
  }

  if (t['KO-WIN-LINE'])
    for (const w of parseStatusWindows(toNfcText(input.text)))
      if (w.crowded_lines.length)
        findings.push({
          rule_id: 'KO-WIN-LINE',
          kind: 'format_drift',
          severity: 'minor',
          message: `상태창 한 줄에 항목이 여러 개다: ‘${w.crowded_lines[0] ?? ''}’. 모바일에서는 한 줄에 한 항목씩 쓴다.`,
          paragraph_ids: [w.paragraph_id],
        });

  return {
    findings,
    metrics: {
      overuse_per_1k: overuse,
      comma_per_1k: per1k(commas),
      sentence_mean_chars: mean,
      sentence_p90_chars: p90,
      long_sentence_ratio: longRatio,
      talk_share: talkShare,
    },
  };
}
