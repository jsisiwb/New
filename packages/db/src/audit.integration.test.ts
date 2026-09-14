import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Pool } from './client.js';
import { databaseUrl, freshDatabase } from './testkit.js';
import { createProject, createWorkspace } from './repo.js';
import {
  findSucceededCall,
  insertLlmCall,
  projectSpendCents,
  upsertPromptVersions,
  type LlmCallInsert,
} from './audit.js';

const run = databaseUrl() ? describe : describe.skip;

run('gateway audit tables (migration 0002)', () => {
  let pool: Pool;
  let ws: string;
  let project: string;
  const base = (): LlmCallInsert => ({
    id: '0191b2a0-0000-7000-8000-00000000c001',
    workspaceId: ws,
    projectId: project,
    idempotencyKey: 'k1',
    role: 'scene_writer',
    promptVersionId: 'scene_writer@1.0.0',
    promptHash: 'sha256:p',
    productionPolicyVersion: 'policy/standard@1',
    narrativeBlockHash: 'sha256:b',
    outputLanguageContractHash: 'sha256:l',
    traditionContractHash: 'sha256:t',
    modelId: 'mock-p',
    modelClass: 'P',
    provider: 'mock',
    params: { temperature: 0.8 },
    inputHash: 'sha256:in',
    usage: { input: 100, output: 50, cached: 0 },
    costCents: 1.25,
    latencyMs: 10,
    attempt: 1,
    status: 'succeeded',
    repairAttempts: 0,
  });

  beforeAll(async () => {
    pool = await freshDatabase();
    ws = await createWorkspace(pool, 'audit');
    ({ projectId: project } = await createProject(pool, { workspaceId: ws, title: 'audit' }));
  });
  afterAll(async () => {
    await pool.end();
  });

  it('stores a call with both contract hashes and finds it by idempotency key; spend aggregates', async () => {
    await insertLlmCall(pool, base());
    const row = await findSucceededCall(pool, 'k1');
    expect(row?.tradition_contract_hash).toBe('sha256:t');
    expect(await projectSpendCents(pool, project)).toBeCloseTo(1.25);
  });

  it('refuses a style-sensitive row missing one contract hash (STYLE-GUARD-001 at the storage layer)', async () => {
    await expect(
      insertLlmCall(pool, {
        ...base(),
        id: '0191b2a0-0000-7000-8000-00000000c002',
        idempotencyKey: 'k2',
        traditionContractHash: undefined,
      }),
    ).rejects.toBeDefined();
  });

  it('audit is append-only and one succeeded row per idempotency key', async () => {
    await expect(
      pool.query(`UPDATE llm_calls SET cost_cents = 0 WHERE idempotency_key = 'k1'`),
    ).rejects.toMatchObject({ hint: 'AUDIT_APPEND_ONLY' });
    await expect(pool.query(`DELETE FROM llm_calls`)).rejects.toMatchObject({
      hint: 'AUDIT_APPEND_ONLY',
    });
    await expect(
      insertLlmCall(pool, { ...base(), id: '0191b2a0-0000-7000-8000-00000000c003' }),
    ).rejects.toBeDefined();
    // a failed attempt with the same key is allowed (history), a second success is not
    await insertLlmCall(pool, {
      ...base(),
      id: '0191b2a0-0000-7000-8000-00000000c004',
      status: 'failed',
    });
  });

  it('prompt versions mirror is immutable by hash', async () => {
    const v = {
      id: 'x@1.0.0',
      family: 'x',
      version: '1.0.0',
      content_hash: 'sha256:a',
      role: 'x',
      style_sensitive: false,
      manuscript_producing: false,
      identity_variant: null,
      model_class: 'C',
      output_schema: null,
      status: 'active',
      meta: {},
    };
    expect(await upsertPromptVersions(pool, [v])).toEqual({ inserted: 1, verified: 0 });
    expect(await upsertPromptVersions(pool, [v])).toEqual({ inserted: 0, verified: 1 });
    await expect(upsertPromptVersions(pool, [{ ...v, content_hash: 'sha256:b' }])).rejects.toThrow(
      /PROMPT_IMMUTABLE/,
    );
    await expect(
      pool.query(`UPDATE prompt_versions SET content_hash = 'sha256:z' WHERE id = 'x@1.0.0'`),
    ).rejects.toMatchObject({ hint: 'PROMPT_IMMUTABLE' });
  });
});
