/**
 * The operator corpus as a voice reference (ADR-0083): passages by scene function (C5), selection per
 * project, the likeness score (C8) and stock-phrase mining (C7). Test strings are short synthetic lines.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chapterMetrics, distributions } from './corpus-stats.js';
import type { KoStyleSource } from './ko-style.js';
import {
  operatorLikeness,
  selectOperatorExemplars,
  stockPhraseCandidates,
  tagPassages,
  type StoredPassage,
} from './corpus-voice.js';

const narration = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `나는 ${String(from + i)}번째 계단을 천천히 밟고 올라갔다.`);

describe('tagPassages (passages@1)', () => {
  it('tags the opening of an early chapter and the last lines before an author’s note', () => {
    const text = [...narration(20), '작가의 말: 감사합니다.'].join('\n');
    const ps = tagPassages(text, { position: 1 });
    const hook = ps.find((p) => p.scene_type === 'hook');
    const cliff = ps.find((p) => p.scene_type === 'cliffhanger');
    expect(hook?.text.startsWith('나는 1번째')).toBe(true);
    expect(hook?.start_cp).toBe(0);
    expect(cliff?.text.endsWith('20번째 계단을 천천히 밟고 올라갔다.')).toBe(true);
    expect(cliff?.text).not.toContain('작가의 말');
    // Offsets are code points into the chapter text.
    expect(
      cliff && Array.from(text).slice(cliff.start_cp, cliff.end_cp).join('').endsWith('올라갔다.'),
    ).toBe(true);
    // A later chapter has no hook.
    expect(tagPassages(text, { position: 40 }).some((p) => p.scene_type === 'hook')).toBe(false);
  });

  it('tags dialogue-led windows with narration beats as banter, and bracketed system lines as a status window', () => {
    const banter = [
      '“오늘도 늦었네요.”',
      '그녀가 팔짱을 꼈다.',
      '“길이 막혔습니다.”',
      '“걸어서 오셨잖아요.”',
      '나는 먼 산을 바라보았다.',
      '“걸어도 막히는 날이 있습니다.”',
      '“…….”',
      '빠직.',
      '“장난입니다, 장난.”',
      '“하나도 안 웃겨요.”',
    ];
    const status = ['[특성 : 힘을 숨김.]', '[메인 퀘스트 : 시험 통과]', '-보상 : 없음'];
    const text = [
      ...narration(6),
      ...banter,
      ...narration(4, 7),
      ...status,
      ...narration(4, 11),
    ].join('\n');
    const ps = tagPassages(text, { position: 30 });
    const b = ps.find((p) => p.scene_type === 'banter');
    expect(b?.text.startsWith('“오늘도 늦었네요.”')).toBe(true);
    expect(b?.features.talk_share).toBeGreaterThan(0.35);
    expect(b?.text).toContain('“하나도 안 웃겨요.”');
    const s = ps.find((p) => p.scene_type === 'status_window');
    expect(s?.text).toContain('[특성 : 힘을 숨김.]');
    expect(s?.text).toContain('[메인 퀘스트 : 시험 통과]');
  });

  it('does not read spirit voices in brackets as a status window', () => {
    const text = [...narration(8), '[어디 갔어.]', '[여기 없어.]', ...narration(8, 9)].join('\n');
    expect(tagPassages(text, { position: 50 }).some((p) => p.scene_type === 'status_window')).toBe(
      false,
    );
  });
});

describe('selectOperatorExemplars', () => {
  const stored: StoredPassage[] = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((id, i) => [
    {
      id: `h-${id}`,
      scene_type: 'hook',
      text: `오프닝 ${id}`,
      pov: i < 3 ? 'first' : 'third',
      source: `책 ${String(i)}화`,
    },
    {
      id: `c-${id}`,
      scene_type: 'cliffhanger',
      text: `절단 ${id}`,
      pov: i < 3 ? 'first' : 'third',
      source: `책 ${String(i)}화`,
    },
  ]);

  it('prefers the project’s point of view, is stable per project and differs between projects', () => {
    const pick = (seed: string) =>
      selectOperatorExemplars(stored, {
        functions: ['hook', 'cliffhanger'],
        perFunction: 1,
        pov: 'first',
        seed,
      });
    const one = pick('project-1');
    expect(one.map((e) => e.functions[0])).toEqual(['hook', 'cliffhanger']);
    expect(one.every((e) => e.pov === 'first')).toBe(true);
    expect(pick('project-1')).toEqual(one);
    const seeds = Array.from({ length: 12 }, (_, i) => pick(`project-${String(i)}`)[0]?.id);
    expect(new Set(seeds).size).toBeGreaterThan(1);
    // No passage in the point of view: fall back to any.
    expect(
      selectOperatorExemplars(
        stored.filter((p) => p.pov === 'third'),
        {
          functions: ['hook'],
          perFunction: 2,
          pov: 'first',
          seed: 's',
        },
      ),
    ).toHaveLength(2);
  });
});

describe('operatorLikeness (C8)', () => {
  // Metrics are taken with the language layer's lists and thresholds, as the CLI does.
  const ol = (
    JSON.parse(
      readFileSync(
        new URL('../../../examples/narrative-profiles/lang-ko.v7.json', import.meta.url),
        'utf8',
      ),
    ) as {
      output_language: {
        translation_markers: KoStyleSource['translationMarkers'];
        forbidden_patterns: KoStyleSource['forbiddenPatterns'];
        lint_thresholds: KoStyleSource['thresholds'];
        calque_phrases: string[];
      };
    }
  ).output_language;
  const source: KoStyleSource = {
    translationMarkers: ol.translation_markers,
    forbiddenPatterns: ol.forbidden_patterns,
    thresholds: ol.lint_thresholds,
    calquePhrases: ol.calque_phrases,
  };
  const operator = [
    ['“왔어?”', '나는 고개를 끄덕였다.', '“응.”', '짧은 대답.', '그런데.', '문이 열렸다.'],
    ['“늦었네.”', '그녀가 웃었다.', '“미안.”', '바람이 불었다.', '하지만.', '발소리가 멈췄다.'],
    ['“누구야?”', '대답은 없었다.', '“…….”', '나는 숨을 골랐다.', '그리고.', '불이 꺼졌다.'],
  ].map((ls) => ls.join('\n'));
  const bands = distributions(operator.map((t) => chapterMetrics(t, source)));

  it('scores a chapter in the operator’s bands high and a translated-style block low', () => {
    const like = operatorLikeness(chapterMetrics(operator[0] ?? '', source), bands);
    expect(like.total).toBe(20);
    expect(like.score).toBeGreaterThanOrEqual(80);
    const unlike = operatorLikeness(
      chapterMetrics(
        '그는 그녀에게 그것에 대해 천천히, 그리고 조심스럽게, 마치 오래된 비밀을 털어놓듯이 길게 이야기를 이어 나가기 시작했으며, 그녀는 그의 말을 통해 모든 것을 이해하게 되었다 — 적어도 그렇게 믿었다.',
        source,
      ),
      bands,
    );
    expect(unlike.score).toBeLessThan(like.score);
    expect(unlike.outside.map((o) => o.key)).toEqual(
      expect.arrayContaining(['dash_per_1k', 'talk_share', 'pronoun_per_1k']),
    );
  });
});

describe('stockPhraseCandidates (C7)', () => {
  it('keeps phrases the drafts repeat and the operator never uses', () => {
    const drafts = [
      '입꼬리가 비릿하게 올라갔다. 나는 웃었다.',
      '그의 입꼬리가 비릿하게 말렸다.',
      '입꼬리가 비릿하게 휘었다. 나는 웃었다.',
    ];
    const corpus = ['나는 웃었다. 바람이 불었다.'];
    const found = stockPhraseCandidates(drafts, corpus, { n: 2, minDrafts: 3, maxCorpusUses: 0 });
    expect(found.map((f) => f.phrase)).toEqual(['입꼬리가 비릿하게']);
    expect(found[0]).toMatchObject({ drafts: 3, corpus_uses: 0 });
  });
});
