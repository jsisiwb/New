import { type JobRow, type Pool } from '@yeonjae/db';
import { type PromptRegistry, type PromptSet } from '@yeonjae/prompts';
import { WorkflowError } from './errors.js';
import { type WorkflowPins } from './runtime.js';

export interface WorkflowPinRequest {
  readonly workflowId: string;
  readonly step: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly identityRef: string;
  readonly identityVersionId: string;
  readonly canonVersionRead: number;
}

type PinFailureReason =
  | 'invalid_prompt_set_pin'
  | 'missing_prompt_mapping'
  | 'invalid_canon_version_pin'
  | 'canon_version_pin_mismatch'
  | 'input_pin_mismatch'
  | 'prompt_set_mapping_mismatch'
  | 'empty_prompt_set'
  | 'invalid_prompt_id'
  | 'missing_historical_prompt'
  | 'prompt_version_mismatch';

function fail(
  request: WorkflowPinRequest,
  reason: PinFailureReason,
  message: string,
  data: Record<string, unknown>,
): never {
  throw new WorkflowError('STEP_NONDETERMINISTIC', message, {
    step: request.step,
    data: { reason, ...data },
    recommendedActions: ['review_conflicts', 'edit_manually'],
  });
}

function normalized(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
  );
}

/** Resolve the immutable prompt and input pins recorded by a job; active prompts are never used here. */
export async function resolveWorkflowPins(
  pool: Pool,
  registry: PromptRegistry,
  job: JobRow,
  request: WorkflowPinRequest,
): Promise<{ pins: WorkflowPins; promptSet: PromptSet }> {
  const stored = job.pins;
  const mapping = stored.prompt_set;
  const promptSetId = stored.prompt_set_id;
  const storedCanon = stored.canon_version_read;
  if (job.prompt_set_id !== promptSetId || typeof promptSetId !== 'string')
    fail(
      request,
      'invalid_prompt_set_pin',
      `workflow ${request.workflowId} has an invalid prompt_set_id pin`,
      {
        jobPromptSetId: job.prompt_set_id,
        pinPromptSetId: promptSetId,
        stored,
      },
    );
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
    fail(
      request,
      'missing_prompt_mapping',
      `workflow ${request.workflowId} has no persisted prompt mapping`,
      { stored },
    );
  if (!Number.isInteger(storedCanon) || (storedCanon as number) < 0)
    fail(
      request,
      'invalid_canon_version_pin',
      `workflow ${request.workflowId} has an invalid canon_version_read pin`,
      {
        stored,
      },
    );
  if (storedCanon !== job.canon_version_read)
    fail(
      request,
      'canon_version_pin_mismatch',
      `workflow ${request.workflowId} has inconsistent canon read pins`,
      { jobCanonVersionRead: job.canon_version_read, pinCanonVersionRead: storedCanon },
    );
  if (
    job.production_policy_version !== stored.production_policy_version ||
    job.narrative_identity_version_id !== stored.narrative_identity_version_id ||
    stored.production_policy_version !== request.policyVersion ||
    stored.production_policy_hash !== request.policyHash ||
    stored.narrative_identity_ref !== request.identityRef ||
    stored.narrative_identity_version_id !== request.identityVersionId
  )
    fail(
      request,
      'input_pin_mismatch',
      `workflow ${request.workflowId} was started with different policy or identity pins`,
      {
        jobProductionPolicyVersion: job.production_policy_version,
        jobNarrativeIdentityVersionId: job.narrative_identity_version_id,
        stored,
        requested: request,
      },
    );

  const setRow = await pool.query<{ mapping: Record<string, string> }>(
    'SELECT mapping FROM prompt_sets WHERE id = $1',
    [promptSetId],
  );
  const dbMapping = setRow.rows[0]?.mapping;
  if (!dbMapping || normalized(dbMapping) !== normalized(mapping))
    fail(
      request,
      'prompt_set_mapping_mismatch',
      `workflow ${request.workflowId} prompt set mapping differs from its persisted job pin`,
      {
        promptSetId,
        jobMapping: mapping,
        dbMapping,
      },
    );

  const entries = Object.entries(mapping as Record<string, unknown>);
  if (entries.length === 0)
    fail(request, 'empty_prompt_set', `workflow ${request.workflowId} has an empty prompt set`, {
      promptSetId,
    });
  const ids = entries.map(([, id]) => id);
  const versions = await pool.query<{ id: string; family: string; content_hash: string }>(
    'SELECT id, family, content_hash FROM prompt_versions WHERE id = ANY($1::text[])',
    [ids],
  );
  const byId = new Map(versions.rows.map((row) => [row.id, row]));
  for (const [family, rawId] of entries) {
    if (typeof rawId !== 'string')
      fail(
        request,
        'invalid_prompt_id',
        `workflow ${request.workflowId} has an invalid prompt id`,
        { family, rawId },
      );
    let version;
    try {
      version = registry.get(rawId);
    } catch (error) {
      fail(
        request,
        'missing_historical_prompt',
        `workflow ${request.workflowId} requires missing historical prompt ${rawId}`,
        {
          family,
          promptId: rawId,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
    const dbVersion = byId.get(rawId);
    if (
      version.family !== family ||
      dbVersion?.family !== family ||
      dbVersion.content_hash !== version.content_hash
    )
      fail(
        request,
        'prompt_version_mismatch',
        `workflow ${request.workflowId} has an inconsistent prompt pin for family ${family}`,
        {
          family,
          promptId: rawId,
          registryFamily: version.family,
          dbVersion,
          registryHash: version.content_hash,
        },
      );
  }
  const pins: WorkflowPins = {
    promptSetId,
    promptSet: mapping as Record<string, string>,
    productionPolicyVersion: request.policyVersion,
    productionPolicyHash: request.policyHash,
    narrativeIdentityVersionId: request.identityVersionId,
    narrativeIdentityRef: request.identityRef,
    canonVersionRead: storedCanon as number,
  };
  return { pins, promptSet: { id: promptSetId, mapping: pins.promptSet } };
}
