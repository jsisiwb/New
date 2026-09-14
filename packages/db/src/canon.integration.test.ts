import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Pool, CanonDbError } from './client.js';
import { databaseUrl, freshDatabase } from './testkit.js';
import {
  acceptedCorpus,
  approveManuscriptVersion,
  commitDelta,
  createChapter,
  createEntity,
  createManuscriptVersion,
  createProject,
  createTimeline,
  createWorkspace,
  factsForEntity,
  getFact,
  getManuscriptVersion,
  getProject,
  knowledgeAt,
  listCommits,
  quarantineContains,
  quarantineVersion,
  rollbackLatest,
  setChapterStatus,
  stateAt,
  truthAt,
} from './repo.js';
import { segmentParagraphs, toNfcText, quoteHash } from '@yeonjae/prose';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CH09 = readFileSync(`${ROOT}examples/fixture/manuscripts/ch09.accepted.txt`, 'utf8');
const REJECTED = readFileSync(
  `${ROOT}examples/fixture/manuscripts/ch09.rejected-draft.txt`,
  'utf8',
);

const clock = (chapter_no: number, ordinal: number) => ({
  chapter_no,
  ordinal,
  precision: 'exact' as const,
});

function evidenceFor(versionId: string, text: string, quote: string) {
  const nfc = toNfcText(text);
  const paragraphs = segmentParagraphs(nfc);
  const utf16 = nfc.text.indexOf(quote);
  if (utf16 < 0) throw new Error(`quote not found: ${quote}`);
  const start = Array.from(nfc.text.slice(0, utf16)).length;
  const end = start + Array.from(quote).length;
  const para = paragraphs.find((p) => p.start <= start && start < p.end);
  return {
    manuscript_version_id: versionId,
    chapter_no: 9,
    paragraph_id: para?.id,
    start,
    end,
    quote,
    quote_hash: quoteHash(quote),
  };
}

const fact = (
  local_id: string,
  op: string,
  payload: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  local_id,
  type: 'fact',
  op,
  frame: 'canonical',
  confidence: 1,
  importance: 'minor',
  evidence: [],
  payload,
  ...extra,
});

const run = databaseUrl() ? describe : describe.skip;

run('canon core (Postgres integration)', () => {
  let pool: Pool;
  let ws: string;
  let project: string;
  let main: string;
  let mujin: string;
  let doyoon: string;
  let ch9: string;
  let ch9Version: string;

  beforeAll(async () => {
    pool = await freshDatabase();
    ws = await createWorkspace(pool, 'test');
    ({ projectId: project, mainTimelineId: main } = await createProject(pool, {
      workspaceId: ws,
      title: 'Second Awakening',
    }));
    mujin = await createEntity(pool, {
      workspaceId: ws,
      projectId: project,
      type: 'character',
      displayName: 'Park Mu-jin',
      shortForms: ['Mu-jin'],
    });
    doyoon = await createEntity(pool, {
      workspaceId: ws,
      projectId: project,
      type: 'character',
      displayName: 'Kang Do-yoon',
      shortForms: ['Do-yoon'],
    });
    ch9 = await createChapter(pool, { workspaceId: ws, projectId: project, number: 9 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('manuscript versions are created working, NFC-normalized, and become immutable once approved', async () => {
    const v = await createManuscriptVersion(pool, {
      workspaceId: ws,
      projectId: project,
      chapterId: ch9,
      origin: 'assembled',
      text: 'cafe\u0301 — draft',
    });
    expect(v.status).toBe('working');
    expect(v.text).toBe('café — draft');
    await pool.query(`UPDATE manuscript_versions SET text = 'café — draft 2' WHERE id = $1`, [
      v.id,
    ]);
    await approveManuscriptVersion(pool, v.id, 'test');
    await expect(
      pool.query(`UPDATE manuscript_versions SET text = 'x' WHERE id = $1`, [v.id]),
    ).rejects.toMatchObject({ hint: 'IMMUTABLE_MANUSCRIPT' });
    await expect(
      pool.query(`DELETE FROM manuscript_versions WHERE id = $1`, [v.id]),
    ).rejects.toMatchObject({ hint: 'IMMUTABLE_MANUSCRIPT' });
    await expect(
      pool.query(`UPDATE manuscript_versions SET status = 'accepted' WHERE id = $1`, [v.id]),
    ).rejects.toMatchObject({ hint: 'CANON_WRITE_OUTSIDE_COMMIT' });
    await expect(
      pool.query(
        `INSERT INTO manuscript_versions (workspace_id, project_id, chapter_id, version_no, origin, status, text, length, content_hash)
         VALUES ($1,$2,$3,99,'assembled','accepted','x','{}','h')`,
        [ws, project, ch9],
      ),
    ).rejects.toMatchObject({ hint: 'ILLEGAL_TRANSITION' });
    await quarantineVersion(pool, v.id, 'test cleanup');
  });

  it('canon tables reject writes outside canon.commit_delta and never delete', async () => {
    await expect(
      pool.query(
        `INSERT INTO facts (workspace_id, project_id, timeline_id, entity_id, attribute, valid_from, asserted_at_version, source, frame, commit_id)
         VALUES ($1,$2,$3,$4,'status.alive','{"chapter_no":1,"ordinal":0}',1,'bible','canonical',canon.uuid_v7())`,
        [ws, project, main, mujin],
      ),
    ).rejects.toMatchObject({ hint: 'CANON_WRITE_OUTSIDE_COMMIT' });
    await expect(pool.query('DELETE FROM facts')).rejects.toMatchObject({
      hint: 'CANON_DELETE_FORBIDDEN',
    });
    await expect(pool.query('TRUNCATE facts CASCADE')).rejects.toMatchObject({
      hint: 'CANON_DELETE_FORBIDDEN',
    });
  });

  it('bible commit v1: locked facts without evidence; optimistic version check', async () => {
    const r = await commitDelta(pool, {
      projectId: project,
      parentVersion: 0,
      source: 'bible',
      delta: {
        items: [
          fact('b1', 'assert', {
            entity_id: mujin,
            attribute: 'status.location',
            value: 'seoul',
            value_text: 'Seoul',
            valid_from: clock(1, 0),
            valid_to: null,
            locked: true,
          }),
          fact('b2', 'assert', {
            entity_id: doyoon,
            attribute: 'power.rank',
            value: 'E',
            value_text: 'E-rank',
            valid_from: clock(8, 0),
            valid_to: null,
          }),
        ],
      },
    });
    expect(r.version).toBe(1);
    expect((await getProject(pool, project)).canon_version).toBe(1);
    await expect(
      commitDelta(pool, {
        projectId: project,
        parentVersion: 0,
        source: 'bible',
        delta: { items: [] },
      }),
    ).rejects.toMatchObject({ code: 'STALE_CANON' });
  });

  it('chapter acceptance: extraction only from approved; commit sets accepted; evidence verified on code points', async () => {
    const v = await createManuscriptVersion(pool, {
      workspaceId: ws,
      projectId: project,
      chapterId: ch9,
      origin: 'assembled',
      text: CH09,
    });
    ch9Version = v.id;
    const q = 'Black venom was climbing Mu-jin’s left calf.';
    const locationFact = (await factsForEntity(pool, project, mujin))[0];
    const delta = {
      items: [
        fact(
          'f-1',
          'assert',
          {
            entity_id: mujin,
            attribute: 'status.injury',
            key: 'left_leg_venom',
            value: { part: 'left calf' },
            value_text: 'Beast venom in the left calf',
            valid_from: clock(9, 46),
            valid_to: null,
          },
          {
            confidence: 0.97,
            importance: 'core',
            story_clock: clock(9, 46),
            evidence: [evidenceFor(v.id, CH09, q)],
          },
        ),
        fact(
          'f-2',
          'supersede',
          {
            entity_id: mujin,
            attribute: 'status.location',
            value: 'poison_fog_2f',
            value_text: 'Poison Fog Dungeon, second floor',
            valid_from: clock(9, 6),
            valid_to: null,
          },
          {
            confidence: 0.9,
            story_clock: clock(9, 6),
            supersedes_ref: locationFact?.id,
            evidence: [
              evidenceFor(v.id, CH09, 'Past the second-floor stairs the fog rose to their knees.'),
            ],
          },
        ),
      ],
    };
    await expect(
      commitDelta(pool, {
        projectId: project,
        parentVersion: 1,
        source: 'chapter_acceptance',
        delta,
        chapterId: ch9,
        manuscriptVersionId: v.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_EXTRACTABLE' });
    await setChapterStatus(pool, ch9, 'review_pending');
    await approveManuscriptVersion(pool, v.id, 'tester');
    expect((await getManuscriptVersion(pool, v.id))?.status).toBe('approved');
    const r = await commitDelta(pool, {
      projectId: project,
      parentVersion: 1,
      source: 'chapter_acceptance',
      delta,
      chapterId: ch9,
      manuscriptVersionId: v.id,
      clockMax: clock(9, 999),
    });
    expect(r.version).toBe(2);
    expect((await getManuscriptVersion(pool, v.id))?.status).toBe('accepted');
    const ch = await pool.query<{ status: string; accepted_version_id: string }>(
      'SELECT status, accepted_version_id FROM chapters WHERE id = $1',
      [ch9],
    );
    expect(ch.rows[0]).toMatchObject({ status: 'accepted', accepted_version_id: v.id });
    const ev = await pool.query<{ start_cp: number; end_cp: number; quote_hash: string }>(
      'SELECT start_cp, end_cp, quote_hash FROM evidence_spans WHERE quote = $1',
      [q],
    );
    expect(ev.rows[0]).toMatchObject({ start_cp: 4907, end_cp: 4951, quote_hash: quoteHash(q) });
    const loc = (await factsForEntity(pool, project, mujin)).filter(
      (f) => f.attribute === 'status.location',
    );
    expect(loc).toHaveLength(2);
    expect(loc[0]?.valid_to).toEqual(clock(9, 6));
    expect(loc[0]?.retracted_at_version).toBeNull();
    expect(loc[0]?.superseded_by_fact_id).toBe(loc[1]?.id);
  });

  it('rejects evidence that does not match the manuscript, and evidence into working versions', async () => {
    const bad = {
      ...evidenceFor(ch9Version, CH09, 'Black venom was climbing Mu-jin’s left calf.'),
      quote: 'Dark venom was climbing Mu-jin’s left calf.',
    };
    await expect(
      commitDelta(pool, {
        projectId: project,
        parentVersion: 2,
        source: 'user_correction',
        justification: 'test',
        delta: {
          items: [
            fact(
              'x',
              'assert',
              {
                entity_id: mujin,
                attribute: 'status.condition',
                value: 'x',
                valid_from: clock(9, 50),
                valid_to: null,
              },
              { evidence: [bad] },
            ),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_MISMATCH' });
    const working = await createManuscriptVersion(pool, {
      workspaceId: ws,
      projectId: project,
      chapterId: ch9,
      origin: 'candidate',
      text: 'A working candidate with a sentence.',
    });
    await expect(
      commitDelta(pool, {
        projectId: project,
        parentVersion: 2,
        source: 'user_correction',
        justification: 'test',
        delta: {
          items: [
            fact(
              'x',
              'assert',
              {
                entity_id: mujin,
                attribute: 'status.condition',
                value: 'x',
                valid_from: clock(9, 50),
                valid_to: null,
              },
              {
                evidence: [
                  evidenceFor(
                    working.id,
                    'A working candidate with a sentence.',
                    'working candidate',
                  ),
                ],
              },
            ),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_MISMATCH' });
    expect((await getProject(pool, project)).canon_version).toBe(2);
    await quarantineVersion(pool, working.id, 'test');
  });

  it('non-BMP evidence: offsets are code points, not UTF-16 units', async () => {
    const chX = await createChapter(pool, { workspaceId: ws, projectId: project, number: 90 });
    const text =
      'The 🔥 sign glowed over the gate. 𝔘 was the mark on the door.\n\nHe read it twice.';
    const v = await createManuscriptVersion(pool, {
      workspaceId: ws,
      projectId: project,
      chapterId: chX,
      origin: 'assembled',
      text,
    });
    await approveManuscriptVersion(pool, v.id, 'tester');
    const q = '𝔘 was the mark';
    const r = await commitDelta(pool, {
      projectId: project,
      parentVersion: 2,
      source: 'chapter_acceptance',
      chapterId: chX,
      manuscriptVersionId: v.id,
      delta: {
        items: [
          fact(
            'e',
            'assert',
            {
              entity_id: doyoon,
              attribute: 'status.location',
              value: 'gate',
              valid_from: clock(90, 1),
              valid_to: null,
            },
            {
              evidence: [
                {
                  manuscript_version_id: v.id,
                  chapter_no: 90,
                  start: 33,
                  end: 33 + Array.from(q).length,
                  quote: q,
                },
              ],
            },
          ),
        ],
      },
    });
    expect(r.version).toBe(3);
    const ev = await pool.query<{ start_cp: number; end_cp: number }>(
      'SELECT start_cp, end_cp FROM evidence_spans WHERE quote = $1',
      [q],
    );
    expect(ev.rows[0]).toEqual({ start_cp: 33, end_cp: 47 });
    expect(q.length).toBe(15); // UTF-16 length; the span is 14 code points
    expect(text.indexOf(q)).toBe(34); // UTF-16 index differs from the code-point offset 33
  });

  it('TR1 transition: healing closes validity and keeps history; as-of queries answer correctly', async () => {
    const injury = (await factsForEntity(pool, project, mujin)).find(
      (f) => f.attribute === 'status.injury',
    );
    if (!injury) throw new Error('injury fact missing');
    const ch14 = await createChapter(pool, { workspaceId: ws, projectId: project, number: 14 });
    const v = await createManuscriptVersion(pool, {
      workspaceId: ws,
      projectId: project,
      chapterId: ch14,
      origin: 'assembled',
      text: 'By morning the venom was gone, but the leg would never be the same.\n\nHe walked with a limp.',
    });
    await approveManuscriptVersion(pool, v.id, 'tester');
    const r = await commitDelta(pool, {
      projectId: project,
      parentVersion: 3,
      source: 'chapter_acceptance',
      chapterId: ch14,
      manuscriptVersionId: v.id,
      delta: {
        items: [
          fact(
            'heal',
            'close',
            { entity_id: mujin, attribute: 'status.injury', key: 'left_leg_venom' },
            {
              importance: 'core',
              story_clock: clock(14, 20),
              supersedes_ref: injury.id,
              evidence: [
                {
                  manuscript_version_id: v.id,
                  start: 0,
                  end: 30,
                  quote: 'By morning the venom was gone,',
                },
              ],
            },
          ),
          fact(
            'limp',
            'assert',
            {
              entity_id: mujin,
              attribute: 'status.condition',
              key: 'left_leg',
              value: 'permanent limp',
              value_text: 'Left-leg scarring, permanent limp',
              valid_from: clock(14, 20),
              valid_to: null,
            },
            {
              importance: 'core',
              story_clock: clock(14, 20),
              evidence: [
                { manuscript_version_id: v.id, start: 69, end: 90, quote: 'He walked with a limp' },
              ],
            },
          ),
        ],
      },
    });
    expect(r.version).toBe(4);
    const after = await getFact(pool, injury.id);
    expect(after?.valid_to).toEqual(clock(14, 20));
    expect(after?.retracted_at_version).toBeNull();
    expect(
      (
        await stateAt(pool, {
          projectId: project,
          entityId: mujin,
          attribute: 'status.injury',
          clock: clock(11, 0),
        })
      ).map((f) => f.key),
    ).toEqual(['left_leg_venom']);
    expect(
      await stateAt(pool, {
        projectId: project,
        entityId: mujin,
        attribute: 'status.injury',
        clock: clock(15, 0),
      }),
    ).toEqual([]);
    expect(
      (
        await stateAt(pool, {
          projectId: project,
          entityId: mujin,
          attribute: 'status.condition',
          clock: clock(15, 0),
        })
      ).map((f) => f.key),
    ).toEqual(['left_leg']);
    expect(
      await stateAt(pool, {
        projectId: project,
        entityId: mujin,
        attribute: 'status.injury',
        clock: clock(11, 0),
        asOfVersion: 1,
      }),
    ).toEqual([]);
  });

  it('a chapter-acceptance delta may not retract (transitions only); overlapping validity is refused atomically', async () => {
    const chZ = await createChapter(pool, { workspaceId: ws, projectId: project, number: 91 });
    const v = await createManuscriptVersion(pool, {
      workspaceId: ws,
      projectId: project,
      chapterId: chZ,
      origin: 'assembled',
      text: 'Some accepted text here.',
    });
    await approveManuscriptVersion(pool, v.id, 'tester');
    const rank = (await factsForEntity(pool, project, doyoon)).find(
      (f) => f.attribute === 'power.rank',
    );
    const ev = [{ manuscript_version_id: v.id, start: 0, end: 4, quote: 'Some' }];
    await expect(
      commitDelta(pool, {
        projectId: project,
        parentVersion: 4,
        source: 'chapter_acceptance',
        chapterId: chZ,
        manuscriptVersionId: v.id,
        delta: {
          items: [
            fact(
              'r',
              'retract',
              { entity_id: doyoon, attribute: 'power.rank' },
              { supersedes_ref: rank?.id, evidence: ev },
            ),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_OP' });
    await expect(
      commitDelta(pool, {
        projectId: project,
        parentVersion: 4,
        source: 'chapter_acceptance',
        chapterId: chZ,
        manuscriptVersionId: v.id,
        delta: {
          items: [
            fact(
              'r2',
              'assert',
              {
                entity_id: doyoon,
                attribute: 'power.rank',
                value: 'D',
                valid_from: clock(20, 0),
                valid_to: null,
              },
              { evidence: ev },
            ),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDITY_OVERLAP' });
    expect((await getProject(pool, project)).canon_version).toBe(4);
    expect((await getManuscriptVersion(pool, v.id))?.status).toBe('approved');
  });

  it('C1 correction retracts (system time) without touching story-time validity; RB1 rollback restores exactly', async () => {
    const rank = (await factsForEntity(pool, project, doyoon)).find(
      (f) => f.attribute === 'power.rank' && f.retracted_at_version === null,
    );
    if (!rank) throw new Error('rank missing');
    const c = await commitDelta(pool, {
      projectId: project,
      parentVersion: 4,
      source: 'user_correction',
      justification: 'Do-yoon re-measured E at ch.8, not F',
      delta: {
        items: [
          fact(
            'fix-old',
            'retract',
            { entity_id: doyoon, attribute: 'power.rank' },
            { importance: 'core', supersedes_ref: rank.id },
          ),
          fact(
            'fix-new',
            'assert',
            {
              entity_id: doyoon,
              attribute: 'power.rank',
              value: 'E',
              value_text: 'E-rank (corrected)',
              valid_from: clock(8, 0),
              valid_to: null,
              justification: 'user correction',
            },
            { importance: 'core' },
          ),
        ],
      },
    });
    expect(c.version).toBe(5);
    const old = await getFact(pool, rank.id);
    expect(old?.retracted_at_version).toBe(5);
    expect(old?.valid_to).toBeNull();
    expect(
      (
        await stateAt(pool, {
          projectId: project,
          entityId: doyoon,
          attribute: 'power.rank',
          clock: clock(10, 0),
        })
      ).map((f) => f.value_text),
    ).toEqual(['E-rank (corrected)']);
    expect(
      (
        await stateAt(pool, {
          projectId: project,
          entityId: doyoon,
          attribute: 'power.rank',
          clock: clock(10, 0),
          asOfVersion: 4,
        })
      ).map((f) => f.id),
    ).toEqual([rank.id]);

    const rb = await rollbackLatest(pool, project);
    expect(rb).toMatchObject({ version: 6, rolled_back_version: 5 });
    expect((await getFact(pool, rank.id))?.retracted_at_version).toBeNull();
    const commits = await listCommits(pool, project);
    expect(commits.map((x) => x.source)).toEqual([
      'bible',
      'chapter_acceptance',
      'chapter_acceptance',
      'chapter_acceptance',
      'user_correction',
      'rollback',
    ]);
    expect((await getProject(pool, project)).canon_version).toBe(6);
  });

  it('rollback of a chapter acceptance re-opens closed validity and returns the version to approved', async () => {
    const chR = await createChapter(pool, { workspaceId: ws, projectId: project, number: 92 });
    const v = await createManuscriptVersion(pool, {
      workspaceId: ws,
      projectId: project,
      chapterId: chR,
      origin: 'assembled',
      text: 'Mu-jin took the stairs two at a time.',
    });
    await approveManuscriptVersion(pool, v.id, 'tester');
    const limp = (await factsForEntity(pool, project, mujin)).find(
      (f) => f.attribute === 'status.condition',
    );
    if (!limp) throw new Error('limp fact missing');
    const r = await commitDelta(pool, {
      projectId: project,
      parentVersion: 6,
      source: 'chapter_acceptance',
      chapterId: chR,
      manuscriptVersionId: v.id,
      delta: {
        items: [
          fact(
            'cured',
            'close',
            { entity_id: mujin, attribute: 'status.condition', key: 'left_leg' },
            {
              importance: 'core',
              story_clock: clock(92, 5),
              supersedes_ref: limp.id,
              evidence: [{ manuscript_version_id: v.id, start: 0, end: 6, quote: 'Mu-jin' }],
            },
          ),
        ],
      },
    });
    expect(r.version).toBe(7);
    expect((await getFact(pool, limp.id))?.valid_to).toEqual(clock(92, 5));
    const rb = await rollbackLatest(pool, project);
    expect(rb.version).toBe(8);
    expect((await getFact(pool, limp.id))?.valid_to).toBeNull();
    expect((await getManuscriptVersion(pool, v.id))?.status).toBe('approved');
    const ch = await pool.query<{ status: string }>('SELECT status FROM chapters WHERE id = $1', [
      chR,
    ]);
    expect(ch.rows[0]?.status).toBe('approved');
  });

  it('T16 quarantine: a rejected draft never reaches the accepted corpus or canon', async () => {
    const draft = await createManuscriptVersion(pool, {
      workspaceId: ws,
      projectId: project,
      chapterId: ch9,
      origin: 'candidate',
      text: REJECTED,
    });
    await quarantineVersion(pool, draft.id, 'rejected by reviewer: continuity break');
    expect(await getManuscriptVersion(pool, draft.id)).toBeUndefined();
    expect(await quarantineContains(pool, project, 'left arm was severed')).toBe(true);
    for (const t of await acceptedCorpus(pool, project))
      expect(t).not.toContain('left arm was severed');
    await expect(
      pool.query(
        `INSERT INTO evidence_spans (workspace_id, manuscript_version_id, start_cp, end_cp, quote, quote_hash) VALUES ($1,$2,0,5,'The f','')`,
        [ws, draft.id],
      ),
    ).rejects.toBeDefined();
    await expect(quarantineVersion(pool, ch9Version, 'nope')).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
    });
  });

  it('frame × timeline kind (ADR-0039) and per-timeline truth inheritance (ADR-0031)', async () => {
    const prior = await createTimeline(pool, {
      workspaceId: ws,
      projectId: project,
      name: 'prior_loop_1',
      kind: 'prior_loop',
      parentTimelineId: main,
      divergenceClock: clock(1, 0),
    });
    const source = await createTimeline(pool, {
      workspaceId: ws,
      projectId: project,
      name: 'original novel',
      kind: 'source_story',
    });
    await expect(
      createTimeline(pool, {
        workspaceId: ws,
        projectId: project,
        name: 'bad',
        kind: 'source_story',
        parentTimelineId: main,
      }),
    ).rejects.toBeDefined();
    await expect(
      commitDelta(pool, {
        projectId: project,
        parentVersion: 8,
        source: 'user_correction',
        justification: 't',
        delta: {
          items: [
            fact(
              'bad',
              'assert',
              {
                entity_id: doyoon,
                attribute: 'status.alive',
                value: false,
                timeline_id: main,
                valid_from: clock(0, 1),
                valid_to: null,
              },
              { frame: 'prior_loop' },
            ),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'FRAME_VIOLATION' });
    const r = await commitDelta(pool, {
      projectId: project,
      parentVersion: 8,
      source: 'user_correction',
      justification: 'seed',
      delta: {
        items: [
          fact(
            'pl',
            'assert',
            {
              entity_id: mujin,
              attribute: 'status.alive',
              value: false,
              value_text: 'Died in the Collapse (first life)',
              timeline_id: prior,
              valid_from: clock(0, 500),
              valid_to: null,
            },
            { frame: 'prior_loop', importance: 'core' },
          ),
          fact(
            'ss',
            'assert',
            {
              entity_id: doyoon,
              attribute: 'status.alive',
              value: false,
              timeline_id: source,
              valid_from: clock(0, 1),
              valid_to: null,
            },
            { frame: 'source_story', importance: 'core' },
          ),
          {
            local_id: 'p5',
            type: 'proposition',
            op: 'create',
            frame: 'canonical',
            confidence: 1,
            importance: 'core',
            evidence: [],
            payload: {
              statement: 'The Gangnam gate break happens on March 14 with 200 casualties.',
              kind: 'event',
              truth: [{ timeline_id: prior, value: 'true' }],
            },
          },
        ],
      },
    });
    const p5 = r.item_ids.p5;
    if (!p5) throw new Error('p5 missing');
    expect(await truthAt(pool, p5, prior, clock(5, 0))).toBe('true');
    expect(await truthAt(pool, p5, main, clock(5, 0))).toBe('unknown');
    await commitDelta(pool, {
      projectId: project,
      parentVersion: 9,
      source: 'user_correction',
      justification: 'divergence',
      delta: {
        items: [
          {
            local_id: 't',
            type: 'proposition_truth',
            op: 'assert',
            frame: 'canonical',
            confidence: 1,
            importance: 'core',
            evidence: [],
            payload: {
              proposition_id: p5,
              timeline_id: main,
              value: 'false',
              valid_from: clock(19, 80),
            },
          },
        ],
      },
    });
    expect(await truthAt(pool, p5, main, clock(18, 0))).toBe('unknown');
    expect(await truthAt(pool, p5, main, clock(20, 0))).toBe('false');
    expect(await truthAt(pool, p5, prior, clock(20, 0))).toBe('true');
    const alt = await createTimeline(pool, {
      workspaceId: ws,
      projectId: project,
      name: 'alt',
      kind: 'alternate',
      parentTimelineId: main,
      divergenceClock: clock(30, 0),
    });
    expect(await truthAt(pool, p5, alt, clock(25, 0))).toBe('false');
    expect(await truthAt(pool, p5, alt, clock(31, 0))).toBe('unknown');
  });

  it('knowledge: a knows-stance on a secret needs a channel; as-of queries per knower', async () => {
    const r = await commitDelta(pool, {
      projectId: project,
      parentVersion: 10,
      source: 'user_correction',
      justification: 'seed P1',
      delta: {
        items: [
          {
            local_id: 'p1',
            type: 'proposition',
            op: 'create',
            frame: 'canonical',
            confidence: 1,
            importance: 'core',
            evidence: [],
            payload: {
              statement: 'Kang Do-yoon is a regressor.',
              kind: 'secret',
              secret: { owner_ids: [doyoon], allowed_knower_ids: [] },
              truth: [{ timeline_id: main, value: 'true' }],
            },
          },
        ],
      },
    });
    const p1 = r.item_ids.p1;
    if (!p1) throw new Error('p1 missing');
    const ks = (
      local_id: string,
      op: string,
      payload: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ) => ({
      local_id,
      type: 'knowledge_state',
      op,
      frame: 'canonical',
      confidence: 1,
      importance: 'core',
      evidence: [],
      payload,
      ...extra,
    });
    await expect(
      commitDelta(pool, {
        projectId: project,
        parentVersion: 11,
        source: 'user_correction',
        justification: 'leak',
        delta: {
          items: [
            ks('k', 'assert', {
              knower: { kind: 'character', entity_id: mujin },
              proposition_id: p1,
              stance: 'knows',
              source: { kind: 'narration', chapter_id: ch9 },
              valid_from: clock(9, 0),
              valid_to: null,
            }),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_LEAK' });
    const ok = await commitDelta(pool, {
      projectId: project,
      parentVersion: 11,
      source: 'user_correction',
      justification: 'seed',
      delta: {
        items: [
          ks('k1', 'assert', {
            knower: { kind: 'character', entity_id: doyoon },
            proposition_id: p1,
            stance: 'knows',
            source: { kind: 'prior_loop_memory', chapter_id: ch9 },
            valid_from: clock(1, 0),
            valid_to: null,
          }),
          ks('k2', 'assert', {
            knower: { kind: 'character', entity_id: mujin },
            proposition_id: p1,
            stance: 'unaware',
            source: { kind: 'narration', chapter_id: ch9 },
            valid_from: clock(2, 0),
            valid_to: null,
          }),
        ],
      },
    });
    expect(ok.version).toBe(12);
    expect(
      (
        await knowledgeAt(pool, {
          projectId: project,
          knowerKind: 'character',
          knowerEntityId: mujin,
          propositionId: p1,
          clock: clock(9, 0),
        })
      ).map((k) => k.stance),
    ).toEqual(['unaware']);
    expect(
      (
        await knowledgeAt(pool, {
          projectId: project,
          knowerKind: 'character',
          knowerEntityId: doyoon,
          propositionId: p1,
          clock: clock(9, 0),
        })
      ).map((k) => k.stance),
    ).toEqual(['knows']);
    await commitDelta(pool, {
      projectId: project,
      parentVersion: 12,
      source: 'user_correction',
      justification: 'seed',
      delta: {
        items: [
          ks(
            'k3',
            'supersede',
            {
              knower: { kind: 'character', entity_id: mujin },
              proposition_id: p1,
              stance: 'suspects',
              certainty: 0.5,
              source: { kind: 'deduced', chapter_id: ch9 },
              valid_from: clock(52, 10),
              valid_to: null,
            },
            { supersedes_ref: ok.item_ids.k2, confidence: 0.6, importance: 'major' },
          ),
        ],
      },
    });
    expect(
      (
        await knowledgeAt(pool, {
          projectId: project,
          knowerKind: 'character',
          knowerEntityId: mujin,
          propositionId: p1,
          clock: clock(40, 0),
        })
      ).map((k) => k.stance),
    ).toEqual(['unaware']);
    expect(
      (
        await knowledgeAt(pool, {
          projectId: project,
          knowerKind: 'character',
          knowerEntityId: mujin,
          propositionId: p1,
          clock: clock(53, 0),
        })
      ).map((k) => k.stance),
    ).toEqual(['suspects']);
  });

  it('racing commits: exactly one wins, the others get STALE_CANON, version bumps once', async () => {
    const version = (await getProject(pool, project)).canon_version;
    const mk = (n: number) =>
      commitDelta(pool, {
        projectId: project,
        parentVersion: version,
        source: 'user_correction',
        justification: `race ${n}`,
        delta: {
          items: [
            fact(`r${n}`, 'assert', {
              entity_id: doyoon,
              attribute: `resource.race_${['a', 'b', 'c'][n - 1] ?? 'z'}`,
              value: n,
              valid_from: clock(1, 0),
              valid_to: null,
            }),
          ],
        },
      });
    const results = await Promise.allSettled([mk(1), mk(2), mk(3)]);
    const fulfilled = results.filter((x) => x.status === 'fulfilled');
    const failed = results.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(CanonDbError);
      expect((f.reason as CanonDbError).code).toBe('STALE_CANON');
    }
    expect((await getProject(pool, project)).canon_version).toBe(version + 1);
  });

  it('fault mid-transaction leaves no partial canon and no version bump', async () => {
    const version = (await getProject(pool, project)).canon_version;
    const before = (await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM facts'))
      .rows[0]?.n;
    await expect(
      commitDelta(pool, {
        projectId: project,
        parentVersion: version,
        source: 'user_correction',
        justification: 'fault',
        delta: {
          items: [
            fact('good', 'assert', {
              entity_id: doyoon,
              attribute: 'resource.money',
              value: 120,
              valid_from: clock(15, 0),
              valid_to: null,
            }),
            fact(
              'bad',
              'supersede',
              {
                entity_id: doyoon,
                attribute: 'resource.money',
                value: 20,
                valid_from: clock(16, 0),
                valid_to: null,
              },
              { supersedes_ref: '0191b2a0-0000-7000-8000-00000000dead' },
            ),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      (await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM facts')).rows[0]?.n,
    ).toBe(before);
    expect((await getProject(pool, project)).canon_version).toBe(version);
  });
});
