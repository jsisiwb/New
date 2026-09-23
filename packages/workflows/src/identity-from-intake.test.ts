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
    expect(profile.lineage?.output_language).toBe('lang/ko@2');
    expect(profile.lineage?.tradition).toBe('tradition/kr-webnovel@2');
    expect(profile.lineage?.genres).toEqual(['genre/academy@2']);
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
