import { describe, expect, it } from 'vitest';
import { normalizeSceneDraft } from './anchoring.js';
import {
  koQuoteMarks,
  proseEnvelope,
  sceneRole,
  stripProseChatter,
  validateSceneDraft,
} from './drafting.js';

describe('prose-only scene writer output (ADR-0056)', () => {
  it('strips assistant chatter, fences and edge labels but keeps the manuscript', () => {
    const raw =
      '물론입니다! 아래는 요청하신 장면입니다.\n\n```\n[장면 1]\n“비켜.”\n\n반장이 턱을 치켜들었다.\n```\n\n필요하시면 더 길게 써 드릴게요.';
    expect(stripProseChatter(raw)).toBe('“비켜.”\n\n반장이 턱을 치켜들었다.');
    // A narration line that merely starts with an episode number is manuscript, not a label.
    expect(stripProseChatter('원작 3화까지 사흘.\n\n“다음.”')).toBe(
      '원작 3화까지 사흘.\n\n“다음.”',
    );
    expect(stripProseChatter('3화. 마수 습격.\n\n사망자 명단 네 번째 줄.')).toMatch(
      /^3화\. 마수 습격\./,
    );
  });

  it('builds a valid scene-draft envelope from bare prose, and unwraps a JSON answer', () => {
    const draft = validateSceneDraft(
      normalizeSceneDraft(proseEnvelope('“비켜.”\n\n반장이 턱을 치켜들었다.', 2, 'ko')),
      2,
    );
    expect(draft.language).toBe('ko');
    expect(draft.paragraphs.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(draft.speaker_annotations).toEqual([]);
    const unwrapped = proseEnvelope(JSON.stringify({ text: '“싫은데?”' }), 1, 'ko');
    expect(unwrapped.text).toBe('“싫은데?”');
  });

  it('fails closed on truncated or malformed structured output and on empty prose', () => {
    for (const bad of ['{"scene_no": 1, "text": "The gate', '{"scene_no": 1}', '   ', '[1, 2']) {
      expect(() => proseEnvelope(bad, 1, 'ko')).toThrow(/SCENE_DRAFT_INVALID|prose writer/);
    }
  });

  it('pairs ASCII quotation marks into the Korean manuscript marks, line by line', () => {
    expect(koQuoteMarks('"어, 이안!"\n\n\'사흘.\'\n\n“이미 둥근.”')).toBe(
      '“어, 이안!”\n\n‘사흘.’\n\n“이미 둥근.”',
    );
    expect(koQuoteMarks('"그가 \'비켜\'라고 했다."')).toBe('“그가 ‘비켜’라고 했다.”');
    // An odd count on a line is ambiguous and left alone.
    expect(koQuoteMarks('"끝나지 않은 인용\n이어짐"')).toBe('"끝나지 않은 인용\n이어짐"');
    expect(proseEnvelope('"비켜."\n\n반장이 턱을 치켜들었다.', 1, 'ko').text).toBe(
      '“비켜.”\n\n반장이 턱을 치켜들었다.',
    );
    expect(proseEnvelope('"Move."', 1, 'en').text).toBe('"Move."');
  });

  it('tells each scene its place in the episode curve; only the last closes on the 절단', () => {
    expect(sceneRole(1, 3, 'ko')).toMatch(/첫 장면\(1\/3\).*훅/);
    expect(sceneRole(2, 3, 'ko')).toMatch(/중간 장면.*정리하지 말고/);
    expect(sceneRole(3, 3, 'ko')).toMatch(/마지막 장면.*절단/);
    expect(sceneRole(1, 1, 'ko')).toMatch(/단독 장면/);
    expect(sceneRole(3, 3, 'en')).toMatch(/last scene/);
  });
});
