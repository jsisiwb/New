import { describe, expect, it } from 'vitest';
import { ProfileStore } from '@yeonjae/narrative';
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
    expect(profile.lineage?.output_language).toBe('lang/ko@1');
    expect(profile.output_language?.language).toBe('ko');
    expect(profile.output_language?.locale).toBe('ko-KR');
  });
});
