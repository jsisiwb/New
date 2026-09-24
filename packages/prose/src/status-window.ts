/**
 * Status windows (상태창) in Korean webnovel prose (ADR-0063). The first accepted window fixes the serial's
 * format (bracket style and field labels, in order); later windows keep it, and mobile layout wants one field
 * per line.
 */
import { type NfcText } from './nfc.js';
import { segmentParagraphs } from './paragraphs.js';

export interface StatusWindow {
  readonly paragraph_id: string;
  /** The opening bracket of the window's bracketed lines (`[`, `【`, `<`, `「`…) or '' when unbracketed. */
  readonly bracket: string;
  readonly labels: readonly string[];
  /** Lines that carry more than one `label: value` pair. */
  readonly crowded_lines: readonly string[];
}

const OPEN = '[\\[【<「〈『]';
const CLOSE = '[\\]】>」〉』]';
const BRACKETED = new RegExp(`^\\s*${OPEN}.*${CLOSE}\\s*$`, 'u');
const HEADER = new RegExp(`^\\s*${OPEN}[^:：]{1,24}${CLOSE}\\s*$`, 'u');
const STRIP = new RegExp(`^\\s*${OPEN}\\s*|\\s*${CLOSE}\\s*$`, 'gu');
const FIELD =
  /([가-힣A-Za-z][가-힣A-Za-z0-9·]{0,11}(?: [가-힣A-Za-z0-9·]{1,6})?)\s*[:：]\s*[^:：/|]+/gu;

function fieldsOf(line: string): string[] {
  return [...line.replace(STRIP, '').matchAll(FIELD)].map((m) => (m[1] ?? '').trim());
}

/**
 * A paragraph is a status window when every line is bracketed and it has a header or a field, or when it
 * has two or more `label: value` lines and nothing else but a header. Quoted speech is never a window.
 */
export function parseStatusWindows(text: NfcText): StatusWindow[] {
  const out: StatusWindow[] = [];
  for (const p of segmentParagraphs(text)) {
    if (/[“”"]/u.test(p.text)) continue;
    const lines = p.text.split('\n').filter((l) => l.trim().length > 0);
    const fieldLines = lines.filter((l) => fieldsOf(l).length > 0);
    const headers = lines.filter((l) => HEADER.test(l)).length;
    const bracketed = lines.length > 0 && lines.every((l) => BRACKETED.test(l));
    const isWindow =
      (bracketed && (headers > 0 || fieldLines.length > 0)) ||
      (fieldLines.length >= 2 && fieldLines.length + headers === lines.length);
    if (!isWindow) continue;
    const firstBracketed = lines.find((l) => BRACKETED.test(l));
    out.push({
      paragraph_id: p.id,
      bracket: firstBracketed ? (firstBracketed.trim()[0] ?? '') : '',
      labels: fieldLines.flatMap(fieldsOf),
      crowded_lines: fieldLines.filter((l) => fieldsOf(l).length > 1),
    });
  }
  return out;
}

export interface StatusWindowFormat {
  readonly bracket: string;
  readonly labels: readonly string[];
  readonly chapter_no: number;
}

/** The serial's format: the first accepted window with at least one field, chapters in order. */
export function statusWindowFormat(
  byChapter: readonly { chapter_no: number; windows: readonly StatusWindow[] }[],
): StatusWindowFormat | undefined {
  for (const c of [...byChapter].sort((a, b) => a.chapter_no - b.chapter_no)) {
    const w = c.windows.find((x) => x.labels.length > 0);
    if (w) return { bracket: w.bracket, labels: w.labels, chapter_no: c.chapter_no };
  }
  return undefined;
}

export interface StatusWindowFinding {
  readonly rule: 'FMT-WINDOW-01' | 'FMT-WINDOW-02';
  readonly severity: 'minor';
  readonly paragraph_id: string;
  readonly message: string;
}

/**
 * A draft's windows against the serial's format. FMT-WINDOW-01: another bracket style, or a window of three
 * or more fields that reuses fewer than half of the format's labels. FMT-WINDOW-02: more than one field on a
 * line (mobile readers see a status window one field per line).
 */
export function checkStatusWindows(
  windows: readonly StatusWindow[],
  format: StatusWindowFormat | undefined,
): StatusWindowFinding[] {
  const out: StatusWindowFinding[] = [];
  for (const w of windows) {
    if (w.crowded_lines.length)
      out.push({
        rule: 'FMT-WINDOW-02',
        severity: 'minor',
        paragraph_id: w.paragraph_id,
        message: `상태창 한 줄에 항목이 여러 개다: ‘${w.crowded_lines[0] ?? ''}’. 모바일에서는 한 줄에 한 항목씩 쓴다.`,
      });
    if (!format) continue;
    const bracketDiffers =
      format.bracket !== '' && w.bracket !== '' && w.bracket !== format.bracket;
    const shared = w.labels.filter((l) => format.labels.includes(l)).length;
    const drift = w.labels.length >= 3 && format.labels.length >= 3 && shared * 2 < w.labels.length;
    if (bracketDiffers || drift)
      out.push({
        rule: 'FMT-WINDOW-01',
        severity: 'minor',
        paragraph_id: w.paragraph_id,
        message: `상태창 형식이 ${String(format.chapter_no)}화에서 정한 형식과 다르다${bracketDiffers ? ` (괄호 ‘${format.bracket}’ 대신 ‘${w.bracket}’)` : ''}${drift ? ` (항목 ${String(w.labels.length)}개 중 기존 항목명 ${String(shared)}개; 기존: ${format.labels.slice(0, 8).join(' / ')})` : ''}.`,
      });
  }
  return out;
}
