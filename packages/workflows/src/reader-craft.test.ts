import { describe, expect, it } from 'vitest';
import { requirePolicy } from '@yeonjae/domain';
import { sceneCraftContext } from './craft-context.js';
import { type WorkflowContext } from './runtime.js';
import { type StoryBible, type ChapterContract } from './planning.js';
import { type ScenePlan } from './drafting.js';
import { voiceCards } from './evaluator-inputs.js';
import {
  openingDesign,
  arcOpeningBrief,
  renderDeviceLedger,
  renderVoiceCard,
  settingNote,
} from './reader-craft.js';

const voice = {
  archetype: '성실한 약자',
  emotional_anchor: '지키지 못한 약속',
  habits: ['남의 손부터 본다'],
  under_pressure: '농담이 사라진다',
  never: ['계획대로'],
};
const bible = {
  version: 1,
  entities: [
    {
      id: 'hero',
      type: 'character',
      display_name: '지안',
      design: { inner_voice: voice, secrets: ['HIDDEN_TWIST'], arc: 'FUTURE_EVENT' },
    },
    {
      id: 'room',
      type: 'location',
      display_name: '장부방',
      design: {
        senses: { sound: '옆방 주판 소리', touch: '닳아 꺼진 문턱' },
        life: '점심에도 교대하는 서기',
        detail: '손 높이의 잉크 자국',
        secrets: ['SECRET_PASSAGE'],
      },
    },
  ],
  propositions: [],
  promises: [],
  commits: [],
} satisfies StoryBible;
const scene = { pov: { character_id: 'bound-hero' }, location_id: 'bound-room' } as ScenePlan;
const context = (version: 37 | 38, lang = 'ko') =>
  ({
    policy: requirePolicy(`policy/standard@${version}`),
    identity: { outputLanguage: { language: lang } },
    bindings: { hero: 'bound-hero', room: 'bound-room' },
  }) as Pick<WorkflowContext, 'policy' | 'identity' | 'bindings'>;

describe('reader craft carried to draft and rewrite (ADR-0120–0123)', () => {
  it('honors the opening window without imposing chapter-specific plot events', () => {
    expect(openingDesign(1, 2)).toContain('어디에 있는지');
    expect(openingDesign(2, 2)).toContain('직전 절단');
    expect(openingDesign(3, 2)).toBeUndefined();
    expect(openingDesign(0, 2)).toBeUndefined();
    expect(arcOpeningBrief(5)).toContain('5화까지');
    expect(arcOpeningBrief(5)).not.toContain('1~3');
  });
  it('resolves bound IDs and passes current craft fields, never arbitrary secrets or future plot', () => {
    const note = sceneCraftContext(context(38), 1, scene, bible) ?? '';
    for (const value of ['성실한 약자', '농담이 사라진다', '옆방 주판 소리', '지금 어디에'])
      expect(note).toContain(value);
    for (const value of ['HIDDEN_TWIST', 'FUTURE_EVENT', 'SECRET_PASSAGE'])
      expect(note).not.toContain(value);
    expect(note).toContain('정사·현재 상태·공개 일정이 우선');
    const later = sceneCraftContext(context(38), 4, scene, bible) ?? '';
    expect(later).not.toContain('[도입부 설계');
    expect(later).toContain('옆방 주판 소리');
  });
  it('leaves prior policies and English calls unchanged, and tolerates old bibles without cards', () => {
    expect(sceneCraftContext(context(37), 1, scene, bible)).toBeUndefined();
    expect(sceneCraftContext(context(38, 'en'), 1, scene, bible)).toBeUndefined();
    expect(() => sceneCraftContext(context(38), 1, scene, undefined)).not.toThrow();
    expect(renderVoiceCard('누군가', { inner_voice: 'bad' })).toBeUndefined();
    expect(settingNote('빈 방', undefined)).toBeUndefined();
  });
  it('gives the voice judge the same pressure response only when enabled', () => {
    const contract = { participants: [{ character_id: 'hero' }] } as ChapterContract;
    expect(voiceCards(contract, bible, 'ko', true)).toContain('농담이 사라진다');
    expect(voiceCards(contract, bible, 'ko')).not.toContain('농담이 사라진다');
  });
  it('ignores future devices and permits callbacks and no-comedy scenes', () => {
    const ledger =
      renderDeviceLedger(
        3,
        [1, 2, 4].map((chapter_number) => ({
          chapter_number,
          opening: { type: 'sharp_dialogue' },
          hook: { type: 'reveal' },
          devices: { comedy: 'misunderstanding' },
        })),
      ) ?? '';
    expect(ledger).toContain('1화: 웃음 착각');
    expect(ledger).toContain('2화: 웃음 착각');
    expect(ledger).not.toContain('4화:');
    expect(ledger).toContain('반복 개그라면 달라진 관계·결과');
    expect(ledger).toContain('웃음 없는 장면');
  });
});
