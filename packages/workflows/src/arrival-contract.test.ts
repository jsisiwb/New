import { describe, expect, it } from 'vitest';
import { validatorFor, type Generated } from '@yeonjae/domain';
import { compileActiveConstraintSet } from '@yeonjae/context';
import { withArrivalRequirements, bindArrivalRequirements } from './arrival-contract.js';
type Intake = Generated.StoryIntakeSchema.StoryIntake;
type Contract = Generated.ChapterContractSchema.ChapterContract;
const intake: Intake = {
  title_working: '도착',
  premise: '게임 속 자신이 키운 인물의 몸으로 옮겨간 사람의 이야기.',
  genre: { primary: 'academy', secondary: ['possession'] },
  target_chapters: 200,
  manuscript_language: 'ko',
};
const project = '01900000-0000-7000-8000-000000000001';
describe('arrival requirements', () => {
  it('adds schema-valid chapter-one hard requirements with truthful provenance and unique IDs', () => {
    const first = withArrivalRequirements([], intake, true);
    expect(first).toHaveLength(3);
    expect(
      first.every(
        (r) => r.kind === 'hard' && r.provenance === 'system_default' && !r.confirmed_by_user,
      ),
    ).toBe(true);
    expect(
      validatorFor('story-spec.schema.json')({ project_id: project, version: 1, items: first }).ok,
    ).toBe(true);
    const collision = withArrivalRequirements(first, { ...intake, opening_mode: 'arrival' }, true);
    expect(new Set(collision.map((r) => r.id)).size).toBe(6);
    expect(collision.slice(3).every((r) => r.provenance === 'user' && r.confirmed_by_user)).toBe(
      true,
    );
  });
  it('does not impose arrival on old policies, English, native-world stories or explicit established openings', () => {
    expect(withArrivalRequirements([], intake, false)).toEqual([]);
    expect(withArrivalRequirements([], { ...intake, manuscript_language: 'en' }, true)).toEqual([]);
    expect(withArrivalRequirements([], { ...intake, genre: { primary: 'academy' } }, true)).toEqual(
      [],
    );
    expect(withArrivalRequirements([], { ...intake, opening_mode: 'established' }, true)).toEqual(
      [],
    );
  });
  it('distinguishes regression from possession and does not invent transmigration for an explicit native arrival', () => {
    const r = withArrivalRequirements([], { ...intake, genre: { primary: 'regression' } }, true);
    expect(r[0]?.text).toContain('회귀');
    expect(r[0]?.text).not.toContain('빙의');
    const native = withArrivalRequirements(
      [],
      { ...intake, genre: { primary: 'academy' }, opening_mode: 'arrival' },
      true,
    );
    expect(native[0]?.text).toContain('처지의 변화');
    expect(native[0]?.text).not.toContain('빙의');
  });
  it('survives planner omission, preserves concrete detail, and binds idempotently only in chapter one', () => {
    const reqs = withArrivalRequirements([], intake, true);
    const content: Partial<Contract> = {
      must_happen: [
        {
          id: 'authored',
          kind: 'event',
          description: '명부와 자기 손을 비교한다',
          requirement_id: reqs[0]?.id,
          verifiable_by: 'judge',
        },
        { id: 'other', kind: 'event', description: '문을 두드린다', verifiable_by: 'judge' },
      ],
    };
    const bound = bindArrivalRequirements(content, reqs, 1, true);
    expect(bound.must_happen).toHaveLength(4);
    expect(bound.must_happen?.[0]?.description).toContain('명부와 자기 손');
    expect(
      bound.must_happen
        ?.slice(0, 3)
        .every((e) => e.kind === 'required_scene' && e.verifiable_by === 'judge'),
    ).toBe(true);
    expect(bound.hard_requirement_refs).toEqual(reqs.map((r) => r.id));
    expect(bindArrivalRequirements(bound, reqs, 1, true)).toEqual(bound);
    expect(bindArrivalRequirements(content, reqs, 2, true)).toBe(content);
    expect(bindArrivalRequirements(content, reqs, 1, false)).toBe(content);
  });
  it('activates all arrival checkpoints in chapter one and none in chapter two', () => {
    const spec = {
      project_id: project,
      version: 1,
      items: withArrivalRequirements([], intake, true),
    };
    for (const chapterNo of [1, 2]) {
      const acs = compileActiveConstraintSet(
        spec,
        { chapterNo, participantIds: [], specVersion: 1 },
        { capTokens: 2400, workingLanguage: 'ko' },
      );
      if (chapterNo === 1) expect(acs.hardText).toContain('확인 행동');
      else expect(acs.hardText).not.toContain('확인 행동');
    }
  });
});
