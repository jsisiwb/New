-- 0002_gateway_audit.sql — llm_calls audit (NFR-A.1), prompt registry mirror, jobs with checkpoints (ADR-0044)
-- Prompt/output text never lives here in plaintext: only hashes, sizes and (optionally) an encrypted object ref.

CREATE TABLE prompt_versions (
  id text PRIMARY KEY,                         -- family@version
  family text NOT NULL,
  version text NOT NULL,
  content_hash text NOT NULL,
  role text NOT NULL,
  style_sensitive boolean NOT NULL,
  manuscript_producing boolean NOT NULL,
  identity_variant text,
  model_class text NOT NULL CHECK (model_class IN ('R','P','M','C','E')),
  output_schema text,
  status text NOT NULL CHECK (status IN ('draft','candidate','active','deprecated')),
  meta jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family, version)
);
-- Immutable: a published version's hash may never change.
CREATE OR REPLACE FUNCTION canon.prompt_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.content_hash <> OLD.content_hash OR NEW.meta <> OLD.meta THEN
    PERFORM canon.raise_code('PROMPT_IMMUTABLE', format('prompt version %s cannot be edited; publish a new version', OLD.id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prompt_version_immutable BEFORE UPDATE ON prompt_versions FOR EACH ROW EXECUTE FUNCTION canon.prompt_version_immutable();

CREATE TABLE prompt_sets (
  id text PRIMARY KEY,
  mapping jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting_review','paused','paused_budget','waiting_provider','needs_attention','cancelling','cancelled','completed','failed')),
  target_kind text,
  target_id uuid,
  canon_version_read integer,
  production_policy_version text NOT NULL,
  prompt_set_id text REFERENCES prompt_sets(id),
  narrative_identity_version_id uuid,
  spend_cents numeric NOT NULL DEFAULT 0,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_project_idx ON jobs(project_id, status);

-- Postgres-checkpointed idempotent steps (ADR-0044): each step's result is persisted once by idempotency key.
CREATE TABLE job_steps (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  step text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('running','completed','failed')),
  result jsonb,
  error jsonb,
  attempt integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX job_steps_job_idx ON job_steps(job_id, step);

CREATE TABLE llm_calls (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  job_id uuid,
  activity_id text,
  idempotency_key text NOT NULL,
  role text NOT NULL,
  prompt_version_id text NOT NULL,
  prompt_hash text NOT NULL,
  prompt_set_id text,
  pack_id uuid,
  pack_hash text,
  canon_version_read integer,
  production_policy_version text NOT NULL,
  narrative_identity_version_id uuid,
  narrative_block_hash text,
  output_language_contract_hash text,
  tradition_contract_hash text,
  output_language_check jsonb,
  model_id text NOT NULL,
  model_class text NOT NULL CHECK (model_class IN ('R','P','M','C','E')),
  provider text NOT NULL,
  provider_request_id text,
  params jsonb NOT NULL,
  input_hash text NOT NULL,
  output_hash text,
  input_ref text,                              -- encrypted object storage key (never plaintext here)
  output_ref text,
  usage jsonb NOT NULL,
  cost_cents numeric NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  attempt integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('pending','succeeded','failed','fallback_succeeded','cancelled','budget_blocked')),
  finish_reason text,
  schema_valid boolean,
  repair_attempts integer NOT NULL DEFAULT 0,
  error jsonb,
  fallback_from_model_id text,
  duplicate_risk boolean NOT NULL DEFAULT false,
  trace_id text,
  artifact_ref jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- STYLE-GUARD-001 at the storage layer: a style-sensitive call must carry both contract hashes
  CONSTRAINT llm_calls_guard_hashes CHECK (
    narrative_block_hash IS NULL OR (output_language_contract_hash IS NOT NULL AND tradition_contract_hash IS NOT NULL))
);
CREATE UNIQUE INDEX llm_calls_idempotency_succeeded ON llm_calls(idempotency_key) WHERE status IN ('succeeded','fallback_succeeded');
CREATE INDEX llm_calls_project_idx ON llm_calls(project_id, created_at);
CREATE INDEX llm_calls_job_idx ON llm_calls(job_id);
-- Append-only audit (NFR-A.4)
CREATE OR REPLACE FUNCTION canon.audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM canon.raise_code('AUDIT_APPEND_ONLY', format('%s is append-only', TG_TABLE_NAME));
  RETURN NULL;
END $$;
CREATE TRIGGER llm_calls_append_only BEFORE UPDATE OR DELETE ON llm_calls FOR EACH ROW EXECUTE FUNCTION canon.audit_append_only();
