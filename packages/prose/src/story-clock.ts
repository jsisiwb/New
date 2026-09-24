/**
 * Countdown mentions in Korean webnovel prose (ADR-0063): `D-7`, `첫 게이트까지 열흘 남았다`, `이틀밖에 남지
 * 않았다`. The story-clock ledger keeps the latest accepted mention per countdown; a draft is checked against
 * it. `N일 뒤/후` is deliberately not a countdown: in narration it is usually a time skip ("사흘 뒤, 그는…").
 */
import { type NfcText } from './nfc.js';
import { segmentParagraphs } from './paragraphs.js';

export interface CountdownMention {
  /** What the countdown runs to (the 어절 before `까지`), `D` for `D-N` notation, or '' when unnamed. */
  readonly label: string;
  readonly days: number;
  readonly paragraph_id: string;
  readonly quote: string;
}

const NATIVE_DAYS: Readonly<Record<string, number>> = {
  하루: 1,
  이틀: 2,
  사흘: 3,
  나흘: 4,
  닷새: 5,
  엿새: 6,
  이레: 7,
  일주일: 7,
  여드레: 8,
  아흐레: 9,
  열흘: 10,
  보름: 15,
};
const NATIVE = Object.keys(NATIVE_DAYS).join('|');
const PARTICLE = '(?:밖에|이|가|만|정도|가량|도|쯤)?';
const DAYS_LEFT = new RegExp(
  `(?:([가-힣A-Za-z0-9]{1,12})\\s*까지\\s*)?(?:(\\d{1,4})\\s*일|(${NATIVE}))\\s*${PARTICLE}\\s*(?:안\\s*)?남`,
  'gu',
);
const D_MINUS = /(?<![A-Za-z])D\s*[-−–]\s*(\d{1,4})(?!\d)/gu;

export function extractCountdowns(text: NfcText): CountdownMention[] {
  const out: CountdownMention[] = [];
  for (const p of segmentParagraphs(text)) {
    const hits: { at: number; m: CountdownMention }[] = [];
    for (const m of p.text.matchAll(D_MINUS))
      hits.push({
        at: m.index,
        m: { label: 'D', days: Number(m[1]), paragraph_id: p.id, quote: m[0] },
      });
    for (const m of p.text.matchAll(DAYS_LEFT)) {
      const days = m[2] !== undefined ? Number(m[2]) : (NATIVE_DAYS[m[3] ?? ''] ?? NaN);
      if (!Number.isFinite(days)) continue;
      hits.push({
        at: m.index,
        m: { label: m[1] ?? '', days, paragraph_id: p.id, quote: m[0].trim() },
      });
    }
    out.push(...hits.sort((a, b) => a.at - b.at).map((h) => h.m));
  }
  return out;
}

export interface LedgerCountdown extends CountdownMention {
  /** Chapter of the accepted mention. */
  readonly chapter_no: number;
}

/** The latest mention per label across accepted chapters, oldest chapter first: what the ledger displays. */
export function latestCountdowns(
  byChapter: readonly { chapter_no: number; mentions: readonly CountdownMention[] }[],
): LedgerCountdown[] {
  const byLabel = new Map<string, LedgerCountdown>();
  for (const c of [...byChapter].sort((a, b) => a.chapter_no - b.chapter_no))
    for (const m of c.mentions)
      if (m.label !== '') byLabel.set(m.label, { ...m, chapter_no: c.chapter_no });
  return [...byLabel.values()].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

export interface CountdownFinding {
  readonly rule: 'CLOCK-COUNT-01' | 'CLOCK-COUNT-02';
  readonly severity: 'major' | 'minor';
  readonly label: string;
  readonly paragraph_id: string;
  readonly quote: string;
  readonly expected: number;
  readonly found: number;
  readonly message: string;
}

/**
 * A draft against the ledger. Only the draft's first mention of a countdown is compared with the ledger (the
 * count at the chapter's start); later mentions in the same draft may only count down. With the story days
 * elapsed since the ledger's mention, the first mention must equal the ledger's count minus those days
 * (CLOCK-COUNT-01, major); without them a countdown may never grow between chapters (CLOCK-COUNT-02, minor).
 */
export function checkCountdowns(
  draft: readonly CountdownMention[],
  ledger: readonly LedgerCountdown[],
  /** Story days from each ledger countdown's chapter to this chapter's start, by label, when known. */
  elapsedByLabel: Readonly<Record<string, number>>,
): CountdownFinding[] {
  const out: CountdownFinding[] = [];
  const first = new Map<string, CountdownMention>();
  const last = new Map<string, number>();
  for (const m of draft) {
    if (m.label === '') continue;
    const previous = last.get(m.label);
    if (previous !== undefined && m.days > previous)
      out.push({
        rule: 'CLOCK-COUNT-02',
        severity: 'minor',
        label: m.label,
        paragraph_id: m.paragraph_id,
        quote: m.quote,
        expected: previous,
        found: m.days,
        message: `같은 화 안에서 남은 날수가 늘었다: ${String(previous)}일 → ${String(m.days)}일 (‘${m.quote}’).`,
      });
    last.set(m.label, m.days);
    if (!first.has(m.label)) first.set(m.label, m);
  }
  for (const [label, m] of first) {
    const known = ledger.find((l) => l.label === label);
    if (!known) continue;
    const elapsedDays = elapsedByLabel[label];
    if (elapsedDays !== undefined) {
      const expected = known.days - elapsedDays;
      if (m.days !== expected)
        out.push({
          rule: 'CLOCK-COUNT-01',
          severity: 'major',
          label,
          paragraph_id: m.paragraph_id,
          quote: m.quote,
          expected,
          found: m.days,
          message: `카운트다운이 장부와 다르다: ${String(known.chapter_no)}화의 ‘${known.quote}’ 뒤로 ${String(elapsedDays)}일이 지났으니 ${String(expected)}일이어야 하는데 ‘${m.quote}’(${String(m.days)}일)로 썼다.`,
        });
    } else if (m.days > known.days)
      out.push({
        rule: 'CLOCK-COUNT-02',
        severity: 'minor',
        label,
        paragraph_id: m.paragraph_id,
        quote: m.quote,
        expected: known.days,
        found: m.days,
        message: `카운트다운이 거꾸로 늘었다: ${String(known.chapter_no)}화에서 ${String(known.days)}일이었는데 ‘${m.quote}’(${String(m.days)}일)로 썼다.`,
      });
  }
  return out;
}
