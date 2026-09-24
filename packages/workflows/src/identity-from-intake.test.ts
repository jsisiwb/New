import { describe, expect, it } from 'vitest';
import { compileBlock, composeIdentity, ProfileStore } from '@yeonjae/narrative';
import { identityProfileFromIntake } from './identity-from-intake.js';
import { type StoryIntake } from './planning.js';

const BASE: StoryIntake = {
  title_working: 'Test Novel',
  premise:
    'A disgraced cadet discovers the academy’s ledger of the world is being rewritten, one page at a time.',
  premise_language: 'en',
  genre: { primary: 'academy' },
  main_character: { name: 'Kael', role: 'protagonist', description: 'new arrival' },
  target_chapters: 200,
  target_words_per_chapter: 3000,
  operating_mode: 'autopilot',
};

const store = ProfileStore.fromDirectory();

describe('identityProfileFromIntake manuscript language (ADR-0054)', () => {
  it('defaults to the English output-language profile when unset', () => {
    const profile = identityProfileFromIntake('project-x', BASE, store);
    expect(profile.lineage?.output_language).toBe('lang/en@1');
    expect(profile.output_language?.language).toBe('en');
  });

  it('selects the Korean output-language profile when manuscript_language is ko', () => {
    const profile = identityProfileFromIntake(
      'project-x',
      { ...BASE, manuscript_language: 'ko' },
      store,
    );
    expect(profile.lineage?.output_language).toBe('lang/ko@5');
    expect(profile.lineage?.tradition).toBe('tradition/kr-webnovel@3');
    expect(profile.lineage?.genres).toEqual(['genre/academy@3']);
    expect(profile.output_language?.language).toBe('ko');
    expect(profile.output_language?.locale).toBe('ko-KR');
  });
});

describe('Korean identity block (ADR-0055)', () => {
  const koStore = ProfileStore.fromDirectory();
  const profile = identityProfileFromIntake(
    'project-ko',
    {
      ...BASE,
      manuscript_language: 'ko',
      genre: { primary: 'academy', secondary: ['possession'] },
      main_character: { name: '루카스 에버하트', role: 'protagonist', description: '엑스트라' },
    },
    koStore,
  );
  koStore.add(profile);
  const identity = composeIdentity(koStore, 'project/project-ko@1', 'version-1');

  it('drops the English-manuscript policies for a Korean fantasy project', () => {
    expect(profile.setting?.setting_type).toBe('secondary_world');
    expect(profile.naming?.style).toBe('western');
    expect(profile.naming?.romanization_system).toBeUndefined();
    const rules = JSON.stringify(profile.register_policy);
    expect(rules).not.toMatch(/sir|ma’am|contractions/i);
  });

  it.each([
    'writer_full',
    'editor_full',
    'planner_compact',
    'judge_rubric_prose',
    'judge_rubric_structure',
    'judge_rubric_genre',
    'judge_rubric_voice',
    'summarizer_min',
  ] as const)('renders the %s block in Korean with no English instructions', (role) => {
    const block = compileBlock(identity, { role, budgetTokens: 6000 });
    expect(block.outputLanguage).toBe('ko');
    const body = block.text.split('\n').slice(1).join('\n');
    expect(body).toMatch(/출력 언어 계약/);
    expect(body).not.toMatch(/Output-Language Contract|English|Never open with|Use these/);
    expect(body).not.toMatch(/\b(the|and|with|never|must) [a-z]+/i);
    if (block.identityTail) expect(block.identityTail).toMatch(/한국어/);
  });
});

describe('Korean webnovel craft layers (ADR-0056)', () => {
  const craftStore = ProfileStore.fromDirectory();
  const profile = identityProfileFromIntake(
    'project-harem',
    {
      ...BASE,
      manuscript_language: 'ko',
      genre: { primary: 'academy', secondary: ['possession', 'harem'] },
      main_character: { name: '이안 하르트', role: 'protagonist', description: '엑스트라' },
    },
    craftStore,
  );
  craftStore.add(profile);
  const identity = composeIdentity(craftStore, 'project/project-harem@1', 'version-1');

  it('composes from the newest Korean layers, including the Korean-only harem overlay', () => {
    expect(profile.lineage?.genres).toEqual([
      'genre/academy@3',
      'genre/regression@3',
      'genre/harem@2',
    ]);
    // English projects never pick up the Korean-only layer.
    const en = identityProfileFromIntake(
      'project-en',
      { ...BASE, genre: { primary: 'academy', secondary: ['harem'] } },
      craftStore,
    );
    expect(en.lineage?.genres).toEqual(['genre/academy@1']);
  });

  it('gives writers and editors the avoid list and at most three studio exemplars; planners get neither', () => {
    for (const role of ['writer_full', 'editor_full'] as const) {
      const block = compileBlock(identity, { role, budgetTokens: 6000 });
      expect(block.sections).toEqual(expect.arrayContaining(['avoid', 'exemplars']));
      expect(block.text).toMatch(/## 쓰지 않는 문장 \(번역투·AI 상투구\)/);
      expect(block.text).toMatch(/## 문체 견본 \(리듬 참고용, 베끼기 금지\)/);
      expect(block.text.match(/〔견본 \d — /g)).toHaveLength(3);
      expect(block.text).toMatch(/절대 가져다 쓰지 않/);
    }
    const planner = compileBlock(identity, { role: 'planner_compact', budgetTokens: 6000 });
    expect(planner.sections).not.toContain('exemplars');
    expect(planner.text).not.toMatch(/문체 견본/);
    const judge = compileBlock(identity, { role: 'judge_rubric_prose', budgetTokens: 6000 });
    expect(judge.sections).toContain('avoid');
  });

  it('measures a Korean block in 자 and keeps the exemplars when lower sections must go (ADR-0062)', () => {
    const full = compileBlock(identity, { role: 'writer_full', budgetTokens: 20000 });
    expect(full.droppedSections).toEqual([]);
    expect(full.estTokens).toBe(Array.from(full.text.replace(/\n/g, '')).length);
    const tight = compileBlock(identity, {
      role: 'writer_full',
      budgetTokens: full.estTokens - 300,
    });
    expect(tight.sections).toContain('exemplars');
    expect(tight.droppedSections.length).toBeGreaterThan(0);
    for (const d of tight.droppedSections)
      expect(['setting', 'preferences', 'cadence', 'genres']).toContain(d);
  });

  it('sheds the exemplars before the core rules under a tight budget', () => {
    const block = compileBlock(identity, { role: 'writer_full', budgetTokens: 2600 });
    expect(block.droppedSections).toContain('exemplars');
    expect(block.sections).toContain('structure');
  });
});

describe('opt-in language layer, point of view, style sample and contrast pairs (ADR-0073)', () => {
  const koStore = ProfileStore.fromDirectory();
  const intake: StoryIntake = {
    ...BASE,
    manuscript_language: 'ko',
    genre: { primary: 'regression' },
    main_character: { name: '차강진', role: 'protagonist', description: '회귀자' },
    pov: 'first',
    // Synthetic test strings (two short sentences each), not manuscript prose.
    style_sample: '문이 열렸다. 나는 숨을 삼켰다.',
    contrast_pairs: [
      { translated: '그는 그녀에게 그것에 대해 말했다.', webnovel: '말했다. 짧게.' },
      { translated: '그것은 그의 것이었다.', webnovel: '내 거다.' },
      { translated: '그녀는 미소를 지었다.', webnovel: '웃었다.' },
      { translated: '그는 문을 통해 들어왔다.', webnovel: '문으로 들어왔다.' },
    ],
  };

  it('keeps new projects on lang/ko@5 unless the policy names a newer layer', () => {
    expect(identityProfileFromIntake('p-default', intake, koStore).lineage?.output_language).toBe(
      'lang/ko@5',
    );
    expect(
      identityProfileFromIntake('p-v7', intake, koStore, { languageLayer: 'lang/ko@6' }).lineage
        ?.output_language,
    ).toBe('lang/ko@6');
    // A layer of the other language, or an unknown one, is ignored.
    expect(
      identityProfileFromIntake('p-bad', intake, koStore, { languageLayer: 'lang/en@1' }).lineage
        ?.output_language,
    ).toBe('lang/ko@5');
  });

  const profile = identityProfileFromIntake('p-pov', intake, koStore, {
    languageLayer: 'lang/ko@6',
  });
  koStore.add(profile);
  const identity = composeIdentity(koStore, 'project/p-pov@1', 'version-1');

  it('carries the intake’s point of view, style sample and pairs in the preferences', () => {
    expect(profile.preferences?.pov).toBe('first');
    expect(profile.preferences?.style_sample?.text).toBe('문이 열렸다. 나는 숨을 삼켰다.');
    expect(profile.preferences?.contrast_pairs).toHaveLength(4);
  });

  it('puts the point of view, the operator’s sample first and a rotating window of pairs in writer blocks', () => {
    const ch1 = compileBlock(identity, {
      role: 'writer_full',
      budgetTokens: 12000,
      rotation: 1,
    }).text;
    const ch2 = compileBlock(identity, {
      role: 'writer_full',
      budgetTokens: 12000,
      rotation: 2,
    }).text;
    expect(ch1).toContain('## 시점 (절대)');
    expect(ch1).toContain('1인칭');
    expect(ch1).toContain('〔작가 문체 견본 — 최우선〕');
    expect(ch1.indexOf('〔작가 문체 견본')).toBeLessThan(ch1.indexOf('〔견본 1'));
    expect(ch1).toContain('번역체: 그는 그녀에게 그것에 대해 말했다.');
    // Four pairs, three per chapter: chapter 1 shows pairs 1–3, chapter 2 pairs 4, 1, 2.
    expect(ch1).toContain('번역체: 그녀는 미소를 지었다.');
    expect(ch2).not.toContain('번역체: 그녀는 미소를 지었다.');
    expect(ch2).toContain('번역체: 그는 문을 통해 들어왔다.');
    // The voice judge is told the point of view; planners are not given the pairs.
    expect(
      compileBlock(identity, { role: 'judge_rubric_voice', budgetTokens: 6000 }).text,
    ).toContain('## 시점 (절대)');
    expect(
      compileBlock(identity, { role: 'planner_compact', budgetTokens: 6000 }).text,
    ).not.toContain('대조 예문');
  });

  it('leaves blocks of identities without these preferences byte for byte as before', () => {
    const plain = identityProfileFromIntake(
      'p-plain',
      { ...intake, pov: undefined, style_sample: undefined, contrast_pairs: undefined },
      koStore,
    );
    koStore.add(plain);
    const text = compileBlock(composeIdentity(koStore, 'project/p-plain@1', 'v'), {
      role: 'writer_full',
      budgetTokens: 12000,
      rotation: 5,
    }).text;
    expect(text).not.toContain('시점 (절대)');
    expect(text).not.toContain('작가 문체 견본');
    expect(text).not.toContain('대조 예문');
  });
});
