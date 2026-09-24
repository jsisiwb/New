import { describe, expect, it } from 'vitest';
import { renderScenePlanKo } from './render.js';
import { type ScenePlan } from './types.js';

const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';
const L = '01900000-0000-7000-8000-00000000000c';
const P = '01900000-0000-7000-8000-00000000000d';
const names: Record<string, string> = { [A]: '서지안', [B]: '백태호', [L]: '길드 회계실' };
const nameOf = (id: string) => names[id] ?? id;

// Studio test strings for the renderer, not manuscript text.
const plan = {
  scene_no: 2,
  objective: '장부의 빈칸을 확인한다',
  pov: { character_id: A, person: 'first' },
  participants: [A, B],
  location_id: L,
  story_time: {
    start: { timeline_id: A, chapter_no: 3, ordinal: 1 },
    end: { timeline_id: A, chapter_no: 3, ordinal: 2 },
    elapsed_hint: '한 시간 뒤',
  },
  opening_beat_type: '대사로 연다',
  beats: [
    {
      type: 'revelation',
      description: '급여 대장에 없는 이름 셋',
      emotional_target: '서늘함',
      reveals_proposition_ids: [P],
      tags: ['information', 'tension'],
    },
    { type: 'cliffhanger', description: '문이 잠긴다' },
  ],
  entry_state: '의심',
  exit_state: '확신',
  dialogue_density_target: 0.4,
  continuity_anchors: [{ fact_id: P, statement: '회계실 열쇠는 하나다', evidence: [] }],
  must_not: ['장부 조작을 폭로하지 않는다'],
  speaker_pairs: [
    {
      speaker_id: B,
      addressee_id: A,
      register: { formality: 1, address_terms: ['지안아'] },
      allowed_shift: { reason: 'anger' },
    },
  ],
  length_target: { unit: 'characters', value: 1800 },
} as unknown as ScenePlan;

describe('a scene plan rendered as labelled Korean text (ADR-0068)', () => {
  it('names people and places, labels every field, and keeps the plan PLANNED', () => {
    const text = renderScenePlanKo(plan, nameOf);
    expect(text.split('\n')).toEqual([
      '장면 2 (PLANNED — 아직 일어나지 않았다)',
      '목표: 장부의 빈칸을 확인한다',
      '시점: 서지안 (1인칭)',
      '등장: 서지안, 백태호',
      '장소: 길드 회계실',
      '스토리 시간: 3화.1 → 3화.2 (한 시간 뒤)',
      '여는 방식: 대사로 연다',
      '시작 상태: 의심',
      '비트:',
      `1. [정보 공개] 급여 대장에 없는 이름 셋 (감정 목표: 서늘함; 효과: 정보, 긴장; 드러낼 명제: id ${P})`,
      '2. [절단] 문이 잠긴다',
      '끝 상태: 확신',
      '대사 비중 목표: 약 40%',
      '지켜야 할 확정 사실:',
      '- 회계실 열쇠는 하나다',
      '이 장면에서 하지 않을 것:',
      '- 장부 조작을 폭로하지 않는다',
      '말높이 (화자 → 청자):',
      '- 백태호 → 서지안: 격식 1; 호칭: "지안아" — 허용된 전환: 분노',
      '분량 목표: 1800자',
    ]);
    expect(text).not.toContain(A);
    expect(text).not.toContain(L);
  });
});
