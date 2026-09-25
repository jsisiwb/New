import { describe, expect, it } from 'vitest';
import {
  compileBlock,
  composeIdentity,
  ProfileStore,
  requireVoiceProfile,
} from '@yeonjae/narrative';
import {
  identityProfileFromIntake,
  protagonistTypeOf,
  storyDeviceOf,
} from './identity-from-intake.js';
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

describe('operator voice profile and corpus exemplars (ADR-0083)', () => {
  const koStore = ProfileStore.fromDirectory();
  const voice = requireVoiceProfile('voice/operator@1');
  const intake: StoryIntake = {
    ...BASE,
    manuscript_language: 'ko',
    genre: { primary: 'academy' },
    main_character: { name: '이도윤', role: 'protagonist', description: '빙의자' },
    pov: 'first',
  };
  // Synthetic passages (short lines), standing in for pinned corpus passages.
  const exemplars = [
    {
      id: 'p-hook',
      functions: ['hook' as const],
      pov: 'first' as const,
      source: '책 1화',
      text: '덜컹.\n나는 눈을 떴다.',
    },
    {
      id: 'p-cut',
      functions: ['cliffhanger' as const],
      source: '책 9화',
      text: '“기회를 주마.”\n문이 닫혔다.',
    },
  ];
  const profile = identityProfileFromIntake('p-voice', intake, koStore, {
    languageLayer: 'lang/ko@7',
    voice,
    operatorExemplars: exemplars,
  });
  koStore.add(profile);
  const identity = composeIdentity(koStore, 'project/p-voice@1', 'v');

  it('copies the voice lines and the passages into the composed identity', () => {
    expect(profile.lineage?.output_language).toBe('lang/ko@7');
    expect(profile.preferences?.operator_voice?.ref).toBe('voice/operator@1');
    expect(profile.preferences?.operator_voice?.writer).toEqual(voice.writer);
    expect(profile.preferences?.operator_exemplars?.map((e) => e.id)).toEqual(['p-hook', 'p-cut']);
  });

  it('gives writers the voice and the operator’s passages instead of studio exemplars, planners the chapter habits, judges the conventions', () => {
    const writer = compileBlock(identity, { role: 'writer_full', budgetTokens: 14000 }).text;
    expect(writer).toContain('## 작가 문체 (작가 원고에서 잰 기준)');
    expect(writer).toContain(voice.writer[0]);
    expect(writer).toContain('이전 작품에서 직접 쓴 문장이다');
    expect(writer).toContain('덜컹.\n나는 눈을 떴다.');
    expect(writer).not.toContain('스튜디오가 직접 쓴 합성 문장');
    // The source of a passage is provenance, never shown to the model.
    expect(writer).not.toContain('책 1화');
    const planner = compileBlock(identity, { role: 'planner_compact', budgetTokens: 8000 }).text;
    expect(planner).toContain('## 작가의 구성 습관');
    expect(planner).not.toContain('## 작가 문체 (작가 원고에서 잰 기준)');
    for (const role of [
      'judge_rubric_prose',
      'judge_rubric_structure',
      'judge_rubric_voice',
    ] as const) {
      const judge = compileBlock(identity, { role, budgetTokens: 8000 }).text;
      expect(judge).toContain('## 이 작가의 문체 (결함 아님)');
      expect(judge).not.toContain('## 작가 문체 (작가 원고에서 잰 기준)');
    }
    expect(
      compileBlock(identity, { role: 'judge_rubric_genre', budgetTokens: 8000 }).text,
    ).not.toContain('이 작가의 문체');
  });

  it('ignores a voice profile of the other language and composes without passages when none are given', () => {
    const en = identityProfileFromIntake('p-en', BASE, koStore, { voice });
    expect(en.preferences?.operator_voice).toBeUndefined();
    const bare = identityProfileFromIntake('p-bare', intake, koStore, {
      languageLayer: 'lang/ko@7',
    });
    expect(bare.preferences?.operator_voice).toBeUndefined();
    expect(bare.preferences?.operator_exemplars).toBeUndefined();
  });
});

describe('premise device (ADR-0084, U2)', () => {
  const koStore = ProfileStore.fromDirectory();
  const ko = (genre: StoryIntake['genre'], premise: string): StoryIntake => ({
    ...BASE,
    manuscript_language: 'ko',
    genre,
    premise,
  });

  it('tells regression, game possession and novel possession apart from the intake', () => {
    expect(storyDeviceOf(ko({ primary: 'regression' }, '마지막 생존자가 과거로 돌아온다.'))).toBe(
      'regression',
    );
    expect(
      storyDeviceOf(
        ko({ primary: 'academy', secondary: ['possession'] }, '게임 속 아카데미에 빙의한다.'),
      ),
    ).toBe('game_possession');
    expect(
      storyDeviceOf(
        ko({ primary: 'academy', secondary: ['possession'] }, '읽던 소설 속 악역에 빙의한다.'),
      ),
    ).toBe('novel_possession');
    expect(storyDeviceOf(ko({ primary: 'academy' }, '아카데미에 입학한다.'))).toBeUndefined();
  });

  it('records the device only under the policy flag and gives writers, planners and the genre judge its vocabulary', () => {
    const intake = ko({ primary: 'regression' }, '마지막 생존자가 과거로 돌아온다.');
    expect(
      identityProfileFromIntake('p-nodev', intake, koStore).preferences?.story_device,
    ).toBeUndefined();
    const profile = identityProfileFromIntake('p-dev', intake, koStore, { deviceLexicon: true });
    expect(profile.preferences?.story_device).toBe('regression');
    koStore.add(profile);
    const identity = composeIdentity(koStore, 'project/p-dev@1', 'v');
    for (const role of ['writer_full', 'planner_compact', 'judge_rubric_genre'] as const) {
      const text = compileBlock(identity, { role, budgetTokens: 12000 }).text;
      expect(text).toContain('## 장치 어휘 (절대)');
      expect(text).toContain('이 작품의 장치는 회귀다');
    }
    expect(
      compileBlock(identity, { role: 'judge_rubric_prose', budgetTokens: 8000 }).text,
    ).not.toContain('장치 어휘');
  });
});

describe('the 회빙환 overlay in the premise device’s own words (ADR-0089, G7-2)', () => {
  const koStore = ProfileStore.fromDirectory();
  const compose = (
    id: string,
    genre: StoryIntake['genre'],
    premise: string,
    opts: Parameters<typeof identityProfileFromIntake>[3] = {},
  ) => {
    const profile = identityProfileFromIntake(
      id,
      { ...BASE, manuscript_language: 'ko', genre, premise },
      koStore,
      opts,
    );
    koStore.add(profile);
    return { profile, identity: composeIdentity(koStore, `project/${id}@1`, 'v') };
  };
  const block = (
    identity: ReturnType<typeof composeIdentity>,
    role: 'writer_full' | 'planner_compact' | 'judge_rubric_genre',
  ) => compileBlock(identity, { role, budgetTokens: 12000 }).text;
  // The device rule and the overlay's words-to-avoid line name the foreign words in order to ban them.
  const told = (text: string) =>
    text
      .split('\n')
      .filter((l) => !l.includes('쓰지 않는'))
      .join('\n');
  const regression = { primary: 'regression' };
  const regressionPremise = '마지막 생존자가 과거로 돌아온다.';
  const v4 = { deviceLexicon: true, genreLayers: ['genre/regression@4'] };

  it('keeps genre/regression@3 unless the policy names v4', () => {
    expect(compose('p-g3', regression, regressionPremise).profile.lineage?.genres).toEqual([
      'genre/regression@3',
    ]);
    expect(compose('p-g4', regression, regressionPremise, v4).profile.lineage?.genres).toEqual([
      'genre/regression@4',
    ]);
  });

  it('tells a regression writer, planner and genre judge the past life, never the 원작', () => {
    const before = compose('p-g3dev', regression, regressionPremise, { deviceLexicon: true });
    // The G7 regression chapter's prompt: the device rule bans 원작 while the overlay lists it as a term.
    expect(block(before.identity, 'writer_full')).toMatch(/장르 용어: 빙의, 원작, 원작 주인공/);
    const { identity } = compose('p-g4dev', regression, regressionPremise, v4);
    for (const role of ['writer_full', 'planner_compact', 'judge_rubric_genre'] as const)
      expect(told(block(identity, role))).not.toMatch(/원작|빙의/);
    expect(block(identity, 'writer_full')).toContain('‘지난 생에서는 여기서 죽었다.’');
    expect(block(identity, 'writer_full')).toContain(
      '쓰지 않는 말: 트랜스미그레이션, 이세카이, 원작',
    );
    expect(block(identity, 'judge_rubric_genre')).toContain('미래 지식의 결정적 사용');
    expect(identity.genres[0]?.device_variants).toBeUndefined();
  });

  it('tells a game-possession writer the game, not the novel it is not', () => {
    const { identity } = compose(
      'p-g4game',
      { primary: 'academy', secondary: ['possession'] },
      '게임 속 아카데미의 엑스트라에 빙의한다.',
      v4,
    );
    expect(identity.preferences?.story_device).toBe('game_possession');
    const writer = block(identity, 'writer_full');
    expect(told(writer)).not.toMatch(/원작\s?주인공|원작\s?소설/);
    expect(writer).toContain('‘게임에서는 여기서 죽었다.’');
    // The overlay's novel-possession exemplar does not reach a game-possession writer.
    expect(writer).not.toContain('열두 번 읽은 소설');
  });

  it('compiles v4 to v3’s bytes when the identity records no device', () => {
    const v3 = compose('p-nodev3', regression, regressionPremise).identity;
    const v4NoDevice = compose('p-nodev4', regression, regressionPremise, {
      genreLayers: ['genre/regression@4'],
    }).identity;
    for (const role of ['writer_full', 'planner_compact', 'judge_rubric_genre'] as const)
      expect(block(v4NoDevice, role).replace('p-nodev4', 'p-nodev3')).toBe(block(v3, role));
  });
});

describe('the device rule as the operator writes it, and the protagonist type (ADR-0090)', () => {
  const koStore = ProfileStore.fromDirectory();
  const compose = (id: string, opts: Parameters<typeof identityProfileFromIntake>[3]) => {
    const profile = identityProfileFromIntake(
      id,
      {
        ...BASE,
        manuscript_language: 'ko',
        genre: { primary: 'academy', secondary: ['possession'] },
        premise: '게임 속 아카데미의 엑스트라에 빙의한다.',
        protagonist_type: '먼치킨',
      },
      koStore,
      opts,
    );
    koStore.add(profile);
    return composeIdentity(koStore, `project/${id}@1`, 'v');
  };
  const block = (
    identity: ReturnType<typeof composeIdentity>,
    role: Parameters<typeof compileBlock>[1]['role'],
  ) => compileBlock(identity, { role, budgetTokens: 12000 }).text;

  it('lets a game-possession serial call the game the 원작 under device rules 2 (G8-2)', () => {
    const before = block(compose('p-dr1', { deviceLexicon: true }), 'judge_rubric_genre');
    expect(before).toContain('‘원작’, ‘원작 주인공’ 같은 소설 빙의 어휘는 쓰지 않는다');
    const identity = compose('p-dr2', { deviceLexicon: true, deviceRules: 2 });
    expect(identity.preferences?.story_device_rules).toBe(2);
    const genre = block(identity, 'judge_rubric_genre');
    expect(genre).toContain('게임 자체를 ‘원작’이라 부를 수는 있다');
    expect(genre).toContain(
      '‘원작 주인공’, ‘원작 소설’처럼 소설 속으로 들어간 이야기의 어휘는 쓰지 않는다',
    );
    // Without the device lexicon no rule is recorded at all.
    expect(compose('p-dr3', { deviceRules: 2 }).preferences?.story_device_rules).toBeUndefined();
  });

  it('tells writers, planners and the genre and structure judges that the 먼치킨 hero is the premise (G8-4)', () => {
    expect(protagonistTypeOf({ ...BASE, protagonist_type: '먼치킨' })).toBe('munchkin');
    expect(protagonistTypeOf({ ...BASE, protagonist_type: '평범한 대학생' })).toBeUndefined();
    const off = compose('p-pt0', { deviceLexicon: true });
    expect(off.preferences?.protagonist_type).toBeUndefined();
    const on = compose('p-pt1', { deviceLexicon: true, protagonistType: true });
    expect(on.preferences?.protagonist_type).toBe('munchkin');
    for (const role of [
      'writer_full',
      'planner_compact',
      'judge_rubric_genre',
      'judge_rubric_structure',
    ] as const) {
      expect(block(on, role)).toContain('## 주인공 유형');
      expect(block(off, role)).not.toContain('주인공 유형');
    }
    expect(block(on, 'judge_rubric_genre')).toContain('힘에 대가나 제약이 없다는 이유만으로');
    expect(block(on, 'judge_rubric_prose')).not.toContain('주인공 유형');
  });
});
