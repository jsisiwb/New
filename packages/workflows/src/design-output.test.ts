import { describe, expect, it } from 'vitest';
import { WorkflowError } from './errors.js';
import { assertDesignOutput } from './design-output.js';

describe('assertDesignOutput', () => {
  it('accepts the supported designer shapes', () => {
    expect(() => {
      assertDesignOutput('cast', {
        characters: [
          {
            display_name: 'Mina',
            role: 'protagonist',
            background: 'A careful novice escaping an inherited debt.',
            goals: ['escape'],
            flaws: ['Refuses help.'],
            voice_notes: ['Precise and guarded.'],
            arc: {
              start_state: 'isolated novice',
              end_state: 'trusted leader',
              turning_points: [
                { description: 'Chooses the team', chapter_from: 8, chapter_to: 10 },
              ],
            },
            secrets: [{ statement: 'is a spy', known_by: ['Mina'] }],
            registers: [{ toward: 'Joon', address_terms: ['captain'] }],
          },
        ],
        propositions: [{ statement: 'the gate is sealed', entity_names: ['Gate'] }],
      });
    }).not.toThrow();
    expect(() => {
      assertDesignOutput('cast', {
        characters: [
          {
            display_name: 'Legacy',
            role: 'ally',
            background: 'A former guard.',
            goals: ['Protect the gate.'],
            flaws: ['Overconfident.'],
            voice_notes: ['Short, direct sentences.'],
            arc: 'old arc',
          },
        ],
      });
    }).not.toThrow();
    expect(() => {
      assertDesignOutput('world', {
        world_rules: [{ attribute: 'mana_cost', statement: 'Magic has a cost', locked: true }],
        locations: [
          {
            display_name: 'The Gate',
            description: 'A sealed gate beneath the city.',
            aliases: ['Gate'],
          },
        ],
        organizations: [{ display_name: 'Wardens', short_forms: ['W'] }],
        terminology: [{ term: 'core', english: 'core' }],
      });
    }).not.toThrow();
    expect(() => {
      assertDesignOutput('power_system', {
        system_rules: [{ attribute: 'rank', statement: 'Ranks are earned' }],
        ranks: [{ name: 'A', description: 'Elite' }],
        abilities: [{ display_name: 'Blink', description: 'Teleport', owner: 'Mina' }],
        milestones: [{ description: 'Awakens', chapter_from: 1, chapter_to: 3 }],
      });
    }).not.toThrow();
  });

  const invalid: [string, 'cast' | 'world' | 'power_system', unknown][] = [
    ['root', 'cast', null],
    ['characters', 'cast', { characters: {} }],
    ['character item', 'cast', { characters: [null] }],
    [
      'cast role',
      'cast',
      {
        characters: [
          {
            display_name: 'Mina',
            background: 'A past.',
            goals: ['win'],
            flaws: ['proud'],
            voice_notes: ['terse'],
            arc: 'changes',
          },
        ],
      },
    ],
    ['aliases', 'cast', { characters: [{ aliases: [null] }] }],
    ['secrets', 'cast', { characters: [{ secrets: [{ known_by: [3] }] }] }],
    ['registers', 'cast', { characters: [{ registers: [{ address_terms: [false] }] }] }],
    ['register date', 'cast', { characters: [{ registers: [{ since_chapter: '1화' }] }] }],
    [
      'arc turning point',
      'cast',
      { characters: [{ arc: { turning_points: [{ description: 3 }] } }] },
    ],
    ['propositions', 'cast', { propositions: [{ entity_names: 'Mina' }] }],
    ['world rule', 'world', { world_rules: [{ attribute: 7 }] }],
    ['world value', 'world', { world_rules: [{ value: () => 1 }] }],
    ['locations', 'world', { locations: [{ description: [] }] }],
    ['location description', 'world', { locations: [{ display_name: 'The Gate' }] }],
    ['power rules', 'power_system', { system_rules: [{ statement: {} }] }],
    ['abilities', 'power_system', { abilities: [{ display_name: ['Blink'] }] }],
    [
      'progression capabilities',
      'power_system',
      {
        system_rules: [{ statement: 'Ranks require witnessed clears.' }],
        milestones: [{ description: 'First clear' }],
      },
    ],
    [
      'progression milestone',
      'power_system',
      {
        system_rules: [{ statement: 'Ranks require witnessed clears.' }],
        abilities: [{ display_name: 'Blink', description: 'A short-range step.' }],
      },
    ],
  ];

  it.each(invalid)('rejects malformed %s as a regeneration error', (_name, kind, value) => {
    expect(() => {
      assertDesignOutput(kind, value);
    }).toThrow(WorkflowError);
    try {
      assertDesignOutput(kind, value);
    } catch (error) {
      expect(error).toMatchObject({ code: 'SPEC_INVALID' });
    }
  });

  it('validates world and power nested fields with their own kind', () => {
    expect(() => {
      assertDesignOutput('world', { locations: [{ aliases: [null] }] });
    }).toThrow(WorkflowError);
    expect(() => {
      assertDesignOutput('power_system', { ranks: [{ description: 9 }] });
    }).toThrow(WorkflowError);
  });
});
