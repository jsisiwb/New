import { describe, expect, it } from 'vitest';
import { codePointLength, toNfcText } from '@yeonjae/prose';
import { anchorPatchSpan, normalizePatchFields } from './revision.js';

const TEXT = toNfcText(
  '루카스는 검을 들었다.\n\n그녀는 알 수 없는 감정을 느꼈다.\n\n"비켜."\n\n그녀는 알 수 없는 감정을 느꼈다.',
);
const FIRST = '그녀는 알 수 없는 감정을 느꼈다.';
const firstAt = TEXT.text.indexOf(FIRST);
const secondAt = TEXT.text.lastIndexOf(FIRST);

describe('anchorPatchSpan (live reviser spans, ADR-0056 §11)', () => {
  it('keeps offsets the quote confirms', () => {
    const span = { start: firstAt, end: firstAt + FIRST.length, original_quote: FIRST };
    expect(anchorPatchSpan(TEXT, { start: 0, end: 60 }, span)).toEqual(span);
  });

  it('re-anchors a quote whose offsets the model could not count, preferring the window', () => {
    const window = { start: secondAt - 2, end: TEXT.text.length };
    const got = anchorPatchSpan(TEXT, window, { start: 0, end: 120, original_quote: FIRST });
    expect(got).toEqual({ start: secondAt, end: secondAt + FIRST.length, original_quote: FIRST });
  });

  it('finds a quote outside the window and fails closed on one that is not in the text', () => {
    expect(
      anchorPatchSpan(TEXT, { start: 0, end: 5 }, { original_quote: '"비켜."' }),
    ).toMatchObject({
      original_quote: '"비켜."',
    });
    expect(anchorPatchSpan(TEXT, { start: 0, end: 5 }, { original_quote: '없는 문장.' })).toBe(
      undefined,
    );
  });

  it('anchors a whole-window quote whose quotation marks the reviser retyped (live chapter 1)', () => {
    const chapter = toNfcText('“이게 무슨……”\n\n‘이 얼굴은 내가 아니다.’\n\n문이 열렸다.');
    const total = codePointLength(chapter.text);
    const retyped = '"이게 무슨……"\n\n\'이 얼굴은 내가 아니다.\'\n\n문이 열렸다.';
    expect(
      anchorPatchSpan(
        chapter,
        { start: 0, end: total },
        { start: 0, end: 20, original_quote: retyped },
      ),
    ).toEqual({ start: 0, end: total, original_quote: chapter.text });
  });

  it('treats a missing span as the whole window and leaves unquoted offsets to the range check', () => {
    expect(anchorPatchSpan(TEXT, { start: 3, end: 40 }, undefined)).toEqual({ start: 3, end: 40 });
    expect(anchorPatchSpan(TEXT, { start: 3, end: 40 }, { start: 7 })).toEqual({
      start: 7,
      end: -1,
    });
  });
});

describe('normalizePatchFields', () => {
  const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

  it('rewrites only the shapes the v4.0.0 note taught the model', () => {
    const out = normalizePatchFields({
      new_text: 'x',
      changed_claims: [{ before: '밤', after: '새벽' }, '검을 뽑았다'],
      regression: false,
      preserved_facts_ack: ['지킨 사실', ID],
    });
    expect(out.changed_claims).toEqual(['밤 → 새벽', '검을 뽑았다']);
    expect('regression' in out).toBe(false);
    expect(out.preserved_facts_ack).toEqual([ID]);
  });

  it('infers a missing or invalid scope from the replacement text (live standard.v8, ADR-0076)', () => {
    // Synthetic test strings (two short sentences at most), not manuscript prose.
    const scope = (new_text: string, s?: unknown) =>
      normalizePatchFields({ new_text, ...(s === undefined ? {} : { scope: s }) }).scope;
    expect(scope('문이 열렸다.\n\n그가 들어왔다.')).toBe('scene');
    expect(scope('문이 열렸다.\n그가 들어왔다.')).toBe('paragraph');
    expect(scope('문이 열렸다. 그가 들어왔다.')).toBe('paragraph');
    expect(scope('문이 열렸다.')).toBe('sentence');
    expect(scope('문이 열렸다.', 'chapter')).toBe('sentence');
    expect(scope('문이 열렸다.\n\n그가 들어왔다.', 'dialogue')).toBe('dialogue');
    // No replacement text: nothing to infer from.
    expect('scope' in normalizePatchFields({ changed_claims: [] })).toBe(false);
  });

  it('leaves schema-shaped fields untouched', () => {
    const valid = {
      changed_claims: ['a'],
      preserved_facts_ack: [ID],
      regression: { passed: true },
    };
    expect(normalizePatchFields(valid)).toEqual(valid);
  });
});
