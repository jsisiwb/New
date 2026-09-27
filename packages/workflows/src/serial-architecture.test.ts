import { sceneCraftContext } from './craft-context.js';
import { type WorkflowContext } from './runtime.js';
import { type ScenePlan } from './drafting.js';
import { describe, expect, it } from 'vitest';
import { requirePolicy, validatorFor, type Generated } from '@yeonjae/domain';
import {
  validateSerialCoverage,
  renderOpeningChapter,
  renderEpisode,
} from './serial-architecture.js';
import { serialPlanFixture } from './serial-architecture.testkit.js';
import { scheduleFromBlueprint } from './story-plan.js';

type Blueprint = Generated.SeriesBlueprintSchema.SeriesBlueprint;
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture');
  return value;
}
const base = {
  project_id: '01900000-0000-7000-8000-000000000001',
  version: 1,
  story_promise: '선택의 책임',
  reader_fantasy: '자기 자리를 얻는다',
  main_conflict: '돌아갈지 남을지',
  protagonist_arc: {
    entity_id: '01900000-0000-7000-8000-000000000002',
    start_state: '고립',
    end_state: '연대',
    turning_points: [{ id: 'turn', description: '첫 선택', window: { from: 1, to: 1 } }],
  },
  ending: { type: 'happy', final_state_assertions: ['돌아갈 문을 연다'] },
  endgame_requirements: [],
} as Omit<Blueprint, 'seasons'>;
function blueprint(): Blueprint {
  const serial = serialPlanFixture(200);
  const episode = serial.episodes[0];
  serial.episodes = [
    [1, 4],
    [5, 12],
    [13, 50],
    [51, 110],
    [111, 200],
  ].map(([from, to]) => ({
    ...episode,
    season_ordinal: required(from) > 50 ? 2 : 1,
    chapter_range: { from: required(from), to: required(to) },
  })) as typeof serial.episodes;
  return {
    ...base,
    serial_plan: serial,
    seasons: [
      {
        ordinal: 1,
        title: '도착과 관계',
        objective: '자리를 얻는다',
        chapter_range_est: { from: 1, to: 50 },
      },
      {
        ordinal: 2,
        title: '책임과 귀환',
        objective: '선택의 대가를 치른다',
        chapter_range_est: { from: 51, to: 200 },
      },
    ],
  };
}

describe('causal serial architecture', () => {
  it('validates an entire 200-chapter plan and schedules authored episode boundaries', () => {
    const b = blueprint();
    expect(validatorFor('series-blueprint.schema.json')(b)).toMatchObject({ ok: true });
    expect(() => {
      validateSerialCoverage(b, 200, 10);
    }).not.toThrow();
    const arcs = scheduleFromBlueprint(b.project_id, b).arcs;
    expect(arcs.map((a) => [a.from, a.to])).toEqual([
      [1, 4],
      [5, 12],
      [13, 50],
      [51, 110],
      [111, 200],
    ]);
    expect(arcs.map((a) => a.arcInSeason)).toEqual([1, 2, 3, 1, 2]);
    expect(new Set(arcs.map((a) => a.id)).size).toBe(5);
    expect(renderEpisode(required(b.serial_plan), required(required(arcs[0]).episode))).toContain(
      '이번 에피소드의 이탈 상태',
    );
    expect(
      renderEpisode(required(b.serial_plan), required(required(arcs[0]).episode)),
    ).not.toContain('독자발견5');
  });
  it.each([
    'missing',
    'gap',
    'overlap',
    'short',
    'cross-season',
    'unknown-season',
    'opening-gap',
    'opening-extra',
  ])('rejects %s instead of inventing story to fill it', (kind) => {
    const b = blueprint();
    const p = required(b.serial_plan);
    if (kind === 'missing') delete b.serial_plan;
    if (kind === 'gap') required(p.episodes[1]).chapter_range.from++;
    if (kind === 'overlap') required(p.episodes[1]).chapter_range.from--;
    if (kind === 'short') p.episodes.pop();
    if (kind === 'cross-season') required(p.episodes[2]).chapter_range.to = 51;
    if (kind === 'unknown-season') p.episodes[0].season_ordinal = 9;
    if (kind === 'opening-gap') required(p.opening_chapters[1]).chapter = 3;
    if (kind === 'opening-extra') p.opening_chapters.push(p.opening_chapters[0]);
    expect(() => {
      validateSerialCoverage(b, 200, 10);
    }).toThrow('Serial architecture');
  });
  it('keeps future chapters and episode payoffs out of the current writer brief', () => {
    const p = serialPlanFixture(10);
    const first = required(renderOpeningChapter(p, 1));
    expect(first).toContain(p.arrival.reality_test);
    expect(first).toContain('독자발견1');
    expect(first).not.toContain('독자발견2');
    expect(first).not.toContain(p.episodes[0].payoff);
    const second = required(renderOpeningChapter(p, 2));
    expect(second).toContain('독자발견2');
    expect(second).not.toContain(p.arrival.last_memory);
    expect(renderOpeningChapter(p, 11)).toBeUndefined();
  });
  it('keeps old blueprints valid with their historical equal-window schedule', () => {
    const b = blueprint();
    delete b.serial_plan;
    expect(validatorFor('series-blueprint.schema.json')(b)).toMatchObject({ ok: true });
    expect(scheduleFromBlueprint(b.project_id, b).arcs[0]).toMatchObject({ from: 1, to: 10 });
  });
  it('carries the current opening when serial architecture is the only craft feature enabled', () => {
    const policy = requirePolicy('policy/standard@43');
    const ctx = {
      policy: {
        ...policy,
        planning: { serial_architecture: { opening_chapters: 10 } },
        drafting: {},
      },
      identity: { outputLanguage: { language: 'ko' } },
      bindings: {},
    } as Pick<WorkflowContext, 'policy' | 'identity' | 'bindings'>;
    const plan = serialPlanFixture();
    const bible = {
      version: 1,
      serial_plan: plan,
      entities: [],
      propositions: [],
      promises: [],
      commits: [],
    };
    const scene = { pov: { character_id: 'hero' }, location_id: 'room' } as ScenePlan;
    expect(sceneCraftContext(ctx, 1, scene, bible)).toContain(plan.arrival.reality_test);
    expect(sceneCraftContext(ctx, 2, scene, bible)).not.toContain(plan.arrival.reality_test);
  });
  it('rejects blank or missing arrival fields at the schema boundary', () => {
    const b = blueprint();
    required(b.serial_plan).arrival.reality_test = '   ';
    expect(validatorFor('series-blueprint.schema.json')(b).ok).toBe(false);
  });
});
