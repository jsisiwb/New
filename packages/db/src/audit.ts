/**
 * Postgres-backed AuditStore for the gateway (llm_calls, migration 0002) and a budget ledger that sums
 * recorded spend per project against the project's hard limit.
 */
import { type Pool } from './client.js';

export interface LlmCallRow {
  id: string;
  workspace_id: string;
  project_id: string;
  job_id: string | null;
  activity_id: string | null;
  idempotency_key: string;
  role: string;
  prompt_version_id: string;
  prompt_hash: string;
  pack_id: string | null;
  pack_hash: string | null;
  production_policy_version: string;
  narrative_identity_version_id: string | null;
  narrative_block_hash: string | null;
  output_language_contract_hash: string | null;
  tradition_contract_hash: string | null;
  output_language_check: unknown;
  model_id: string;
  model_class: string;
  provider: string;
  params: unknown;
  input_hash: string;
  output_hash: string | null;
  usage: { input: number; output: number; cached: number };
  cost_cents: string | number;
  latency_ms: number;
  attempt: number;
  status: string;
  finish_reason: string | null;
  schema_valid: boolean | null;
  repair_attempts: number;
  error: unknown;
  fallback_from_model_id: string | null;
  artifact_ref: unknown;
  created_at: Date;
}

export interface LlmCallInsert {
  id: string;
  workspaceId: string;
  projectId: string;
  jobId?: string | undefined;
  activityId?: string | undefined;
  idempotencyKey: string;
  role: string;
  promptVersionId: string;
  promptHash: string;
  packId?: string | undefined;
  packHash?: string | undefined;
  productionPolicyVersion: string;
  narrativeIdentityVersionId?: string | undefined;
  narrativeBlockHash?: string | undefined;
  outputLanguageContractHash?: string | undefined;
  traditionContractHash?: string | undefined;
  outputLanguageCheck?: unknown;
  modelId: string;
  modelClass: string;
  provider: string;
  params: unknown;
  inputHash: string;
  outputHash?: string | undefined;
  usage: { input: number; output: number; cached: number };
  costCents: number;
  latencyMs: number;
  attempt: number;
  status: string;
  finishReason?: string | undefined;
  schemaValid?: boolean | undefined;
  repairAttempts: number;
  error?: unknown;
  fallbackFromModelId?: string | undefined;
  artifactRef?: unknown;
}

export async function insertLlmCall(pool: Pool, r: LlmCallInsert): Promise<void> {
  await pool.query(
    `INSERT INTO llm_calls (id, workspace_id, project_id, job_id, activity_id, idempotency_key, role, prompt_version_id, prompt_hash, pack_id, pack_hash,
       production_policy_version, narrative_identity_version_id, narrative_block_hash, output_language_contract_hash, tradition_contract_hash,
       output_language_check, model_id, model_class, provider, params, input_hash, output_hash, usage, cost_cents, latency_ms, attempt, status,
       finish_reason, schema_valid, repair_attempts, error, fallback_from_model_id, artifact_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21::jsonb,$22,$23,$24::jsonb,$25,$26,$27,$28,$29,$30,$31,$32::jsonb,$33,$34::jsonb)`,
    [
      r.id,
      r.workspaceId,
      r.projectId,
      r.jobId ?? null,
      r.activityId ?? null,
      r.idempotencyKey,
      r.role,
      r.promptVersionId,
      r.promptHash,
      r.packId ?? null,
      r.packHash ?? null,
      r.productionPolicyVersion,
      r.narrativeIdentityVersionId ?? null,
      r.narrativeBlockHash ?? null,
      r.outputLanguageContractHash ?? null,
      r.traditionContractHash ?? null,
      JSON.stringify(r.outputLanguageCheck ?? null),
      r.modelId,
      r.modelClass,
      r.provider,
      JSON.stringify(r.params),
      r.inputHash,
      r.outputHash ?? null,
      JSON.stringify(r.usage),
      r.costCents,
      r.latencyMs,
      r.attempt,
      r.status,
      r.finishReason ?? null,
      r.schemaValid ?? null,
      r.repairAttempts,
      JSON.stringify(r.error ?? null),
      r.fallbackFromModelId ?? null,
      JSON.stringify(r.artifactRef ?? null),
    ],
  );
}

export async function findSucceededCall(
  pool: Pool,
  idempotencyKey: string,
): Promise<LlmCallRow | undefined> {
  const r = await pool.query<LlmCallRow>(
    `SELECT * FROM llm_calls WHERE idempotency_key = $1 AND status IN ('succeeded','fallback_succeeded') LIMIT 1`,
    [idempotencyKey],
  );
  return r.rows[0];
}

export async function projectSpendCents(pool: Pool, projectId: string): Promise<number> {
  const r = await pool.query<{ total: string }>(
    `SELECT coalesce(sum(cost_cents), 0)::text AS total FROM llm_calls WHERE project_id = $1`,
    [projectId],
  );
  return Number(r.rows[0]?.total ?? '0');
}

export async function upsertPromptVersions(
  pool: Pool,
  versions: readonly {
    id: string;
    family: string;
    version: string;
    content_hash: string;
    role: string;
    style_sensitive: boolean;
    manuscript_producing: boolean;
    identity_variant: string | null;
    model_class: string;
    output_schema: string | null;
    status: string;
    meta: unknown;
  }[],
): Promise<{ inserted: number; verified: number }> {
  let inserted = 0;
  let verified = 0;
  for (const v of versions) {
    const existing = await pool.query<{ content_hash: string }>(
      'SELECT content_hash FROM prompt_versions WHERE id = $1',
      [v.id],
    );
    const row = existing.rows[0];
    if (row) {
      if (row.content_hash !== v.content_hash)
        throw new Error(
          `PROMPT_IMMUTABLE: ${v.id} in the database has hash ${row.content_hash}, repository has ${v.content_hash}`,
        );
      verified++;
      continue;
    }
    await pool.query(
      `INSERT INTO prompt_versions (id, family, version, content_hash, role, style_sensitive, manuscript_producing, identity_variant, model_class, output_schema, status, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        v.id,
        v.family,
        v.version,
        v.content_hash,
        v.role,
        v.style_sensitive,
        v.manuscript_producing,
        v.identity_variant,
        v.model_class,
        v.output_schema,
        v.status,
        JSON.stringify(v.meta),
      ],
    );
    inserted++;
  }
  return { inserted, verified };
}

/** Minimal shape of the gateway's audit record we persist (kept structural to avoid a db → gateway dependency). */
export interface GatewayAuditLike {
  id: string;
  idempotency_key: string;
  role: string;
  prompt_version_id: string;
  prompt_hash: string;
  pack_id: string;
  pack_hash: string;
  production_policy_version: string;
  narrative_identity_version_id?: string | undefined;
  narrative_block_hash?: string | undefined;
  output_language_contract_hash?: string | undefined;
  tradition_contract_hash?: string | undefined;
  output_language_check?: unknown;
  model_id: string;
  model_class: string;
  provider: string;
  params: unknown;
  usage: { input: number; output: number; cached: number };
  cost_cents: number;
  latency_ms: number;
  attempt: number;
  status: 'succeeded' | 'failed' | 'fallback_succeeded' | 'budget_blocked';
  finish_reason: string;
  schema_valid: boolean;
  repair_attempts: number;
  fallback_from_model_id?: string | undefined;
  error?: { class: string; message: string } | undefined;
  input_hash: string;
  output_hash?: string | undefined;
  output: { text?: string | undefined; json?: unknown } | undefined;
  created_at: string;
}

/**
 * Postgres AuditStore for the gateway. Output payloads are NOT stored in llm_calls (plaintext manuscript never
 * enters operational tables); replay of an idempotent call therefore requires the artifact store, which the
 * workflow layer owns. The row records everything NFR-A needs: hashes, versions, contract hashes, cost.
 */
export class PgAuditStore {
  constructor(
    private readonly pool: Pool,
    private readonly scope: { workspaceId: string; projectId: string; jobId?: string | undefined },
    private readonly outputs: Map<
      string,
      { text?: string | undefined; json?: unknown }
    > = new Map(),
  ) {}

  async findByIdempotencyKey(key: string): Promise<GatewayAuditLike | undefined> {
    const row = await findSucceededCall(this.pool, key);
    if (!row) return undefined;
    return {
      id: row.id,
      idempotency_key: row.idempotency_key,
      role: row.role,
      prompt_version_id: row.prompt_version_id,
      prompt_hash: row.prompt_hash,
      pack_id: row.pack_id ?? '',
      pack_hash: row.pack_hash ?? '',
      production_policy_version: row.production_policy_version,
      narrative_identity_version_id: row.narrative_identity_version_id ?? undefined,
      narrative_block_hash: row.narrative_block_hash ?? undefined,
      output_language_contract_hash: row.output_language_contract_hash ?? undefined,
      tradition_contract_hash: row.tradition_contract_hash ?? undefined,
      output_language_check: row.output_language_check,
      model_id: row.model_id,
      model_class: row.model_class,
      provider: row.provider,
      params: row.params,
      usage: row.usage,
      cost_cents: Number(row.cost_cents),
      latency_ms: row.latency_ms,
      attempt: row.attempt,
      status: row.status as GatewayAuditLike['status'],
      finish_reason: row.finish_reason ?? 'stop',
      schema_valid: row.schema_valid ?? false,
      repair_attempts: row.repair_attempts,
      fallback_from_model_id: row.fallback_from_model_id ?? undefined,
      input_hash: row.input_hash,
      output_hash: row.output_hash ?? undefined,
      output: this.outputs.get(key),
      created_at: row.created_at.toISOString(),
    };
  }

  async append(record: GatewayAuditLike): Promise<void> {
    await insertLlmCall(this.pool, {
      id: record.id,
      workspaceId: this.scope.workspaceId,
      projectId: this.scope.projectId,
      jobId: this.scope.jobId,
      idempotencyKey: record.idempotency_key,
      role: record.role,
      promptVersionId: record.prompt_version_id,
      promptHash: record.prompt_hash,
      packId: record.pack_id || undefined,
      packHash: record.pack_hash || undefined,
      productionPolicyVersion: record.production_policy_version,
      narrativeIdentityVersionId: record.narrative_identity_version_id,
      narrativeBlockHash: record.narrative_block_hash,
      outputLanguageContractHash: record.output_language_contract_hash,
      traditionContractHash: record.tradition_contract_hash,
      outputLanguageCheck: record.output_language_check,
      modelId: record.model_id,
      modelClass: record.model_class,
      provider: record.provider,
      params: record.params,
      inputHash: record.input_hash,
      outputHash: record.output_hash,
      usage: record.usage,
      costCents: record.cost_cents,
      latencyMs: record.latency_ms,
      attempt: record.attempt,
      status: record.status,
      finishReason: record.finish_reason,
      schemaValid: record.schema_valid,
      repairAttempts: record.repair_attempts,
      error: record.error,
      fallbackFromModelId: record.fallback_from_model_id,
    });
    if (
      record.output &&
      (record.status === 'succeeded' || record.status === 'fallback_succeeded')
    ) {
      this.outputs.set(record.idempotency_key, record.output);
    }
  }
}
