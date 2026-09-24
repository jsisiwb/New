/**
 * ADR-0063: the story-clock and status-window ledgers read ACCEPTED text only. Korean chapters are accepted
 * through the real acceptance path; a working version's countdown never reaches the ledger.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approveManuscriptVersion,
  commitDelta,
  createManuscriptVersion,
  createPool,
  getProject,
  migrate,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl } from '@yeonjae/db/testkit';
import { loadLedgers, renderLedgers } from './ledgers.js';

const url = databaseUrl();
const run = url ? describe : describe.skip;

run('state ledgers over accepted Korean text (ADR-0063)', () => {
  let pool: Pool;
  let workspaceId = '';
  let projectId = '';
  const timelineId = randomUUID();

  async function chapter(no: number, text: string, accept: boolean): Promise<void> {
    const c = await pool.query<{ id: string }>(
      `INSERT INTO chapters (workspace_id, project_id, number, status) VALUES ($1, $2, $3, 'drafted') RETURNING id`,
      [workspaceId, projectId, no],
    );
    const chapterId = c.rows[0]?.id ?? '';
    const version = await createManuscriptVersion(pool, {
      workspaceId,
      projectId,
      chapterId,
      origin: 'assembled',
      text,
    });
    if (!accept) return;
    await approveManuscriptVersion(pool, version.id, 'fixture');
    await commitDelta(pool, {
      projectId,
      parentVersion: (await getProject(pool, projectId)).canon_version,
      source: 'chapter_acceptance',
      chapterId,
      manuscriptVersionId: version.id,
      delta: { items: [] },
    });
  }

  beforeAll(async () => {
    pool = createPool({ connectionString: url ?? '', max: 4 });
    await migrate(pool);
    const ws = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (name) VALUES ('ledgers') RETURNING id`,
    );
    workspaceId = ws.rows[0]?.id ?? '';
    const p = await pool.query<{ id: string }>(
      `INSERT INTO projects (workspace_id, title, production_policy_version, output_language)
       VALUES ($1, '장부 시험', 'standard.v1', 'ko') RETURNING id`,
      [workspaceId],
    );
    projectId = p.rows[0]?.id ?? '';
    await chapter(
      1,
      '눈을 떴다.\n\n【상태창】\n【이름: 강하준】\n【레벨: 1】\n【힘: 10】\n\n첫 게이트까지 열흘 남았다.',
      true,
    );
    await chapter(2, '하루하루가 빨랐다.\n\n게이트까지 이레 남았다.', true);
    await chapter(3, '게이트까지 하루 남았다.', false);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('keeps the latest accepted countdown and the first accepted status-window format', async () => {
    const ledgers = await loadLedgers(pool, {
      projectId,
      timelineId,
      canonVersion: (await getProject(pool, projectId)).canon_version,
      chapterNo: 4,
      clockStart: { chapter_no: 4, ordinal: 0, precision: 'exact' },
      onPageIds: [],
      speakerPairs: [],
    });
    // Chapter 3 is a working version: its "하루" never reaches the ledger.
    expect(ledgers.countdowns).toEqual([
      expect.objectContaining({ label: '게이트', days: 7, chapter_no: 2 }),
    ]);
    expect(ledgers.statusWindow).toEqual({
      bracket: '【',
      labels: ['이름', '레벨', '힘'],
      chapter_no: 1,
    });
    const ko = renderLedgers(ledgers, 'ko');
    expect(ko.clock).toContain(
      '- 게이트: 2화에서 ‘게이트까지 이레 남’(7일) → 경과 일수 미상, 늘어나면 안 된다',
    );
    expect(ko.statusWindow).toBe(
      '상태창 형식 (1화에서 확정): 괄호 ‘【’, 항목 순서 이름 / 레벨 / 힘. 한 줄에 한 항목씩 쓴다.',
    );
    expect(ko.cards).toBeUndefined();
  });
});
