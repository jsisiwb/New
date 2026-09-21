import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toNfcText } from './nfc.js';
import { checkOutputLanguage, checkOutputLanguageKo } from './language.js';

const FIXTURE = fileURLToPath(
  new URL('../../../examples/fixture/manuscripts/ch09.accepted.txt', import.meta.url),
);

describe('deterministic output-language check (OUTPUT-EN-001)', () => {
  it('passes the English fixture chapter', () => {
    const r = checkOutputLanguage(toNfcText(readFileSync(FIXTURE, 'utf8')));
    expect(r.passed).toBe(true);
    expect(r.english_confidence).toBe(1);
    expect(r.offending_segments).toEqual([]);
  });

  it('fails Korean prose and mixed-script paragraphs', () => {
    const korean = toNfcText('측정 장치가 울었다.\n\n[F]\n\n붉은 글자가 떠올랐다.');
    const r = checkOutputLanguage(korean);
    expect(r.passed).toBe(false);
    expect(r.offending_segments.map((s) => s.reason)).toContain('non_latin_script');

    const mixed = toNfcText(
      'The device cried out and the hall went quiet.\n\n그는 웃었다. Then he walked to the left window.',
    );
    const m = checkOutputLanguage(mixed);
    expect(m.passed).toBe(false);
    expect(m.offending_segments[0]?.paragraph_id).toBe('p2');
  });

  it('excludes registry romanizations and preserved-script terms via the allowlist', () => {
    const t = toNfcText(
      'The sign over the door still read 협회 in faded paint, and the sunbae behind the desk did not look up.',
    );
    expect(checkOutputLanguage(t).passed).toBe(false);
    expect(checkOutputLanguage(t, { allowlist: ['협회', 'sunbae'] }).passed).toBe(true);
  });

  it('is not fooled by Latin-script non-English text with no English signal', () => {
    const t = toNfcText(
      'Dispositivo medición gritó fuerte carta roja apareció ventana registro portador izquierda.',
    );
    const r = checkOutputLanguage(t);
    expect(r.passed).toBe(false);
    expect(r.offending_segments[0]?.reason).toBe('no_english_signal');
  });

  it('ignores status-window separators and very short lines', () => {
    const t = toNfcText('[F]\n\n———\n\n“Two.”\n\nHe looked at the letter for a long time.');
    expect(checkOutputLanguage(t).passed).toBe(true);
  });
});

describe('deterministic output-language check, Korean (ADR-0054)', () => {
  it('passes natural Korean prose', () => {
    const t = toNfcText('문이 열리고 붉은 눈동자가 번뜩였다.\n\n그는 천천히 손을 들어 검을 뽑았다.');
    const r = checkOutputLanguageKo(t);
    expect(r.passed).toBe(true);
    expect(r.english_confidence).toBe(1);
  });

  it('fails English prose under the Korean check', () => {
    const en = toNfcText('The door opened and a pair of red eyes flashed.\n\nHe slowly raised his hand and drew the sword.');
    expect(checkOutputLanguageKo(en).passed).toBe(false);
  });

  it('passes mixed Korean with short Latin tokens (status windows, ranks)', () => {
    const t = toNfcText('[레벨이 올랐습니다]\n\n근력 +3 민첩 +2\n\n그는 인벤토리를 열었다.');
    expect(checkOutputLanguageKo(t).passed).toBe(true);
  });

  it('still fails Korean prose under the default English check', () => {
    const korean = toNfcText('문이 열리고 붉은 눈동자가 번뜩였다.');
    const r = checkOutputLanguage(korean);
    expect(r.passed).toBe(false);
    expect(r.offending_segments[0]?.reason).toBe('non_latin_script');
  });
});
