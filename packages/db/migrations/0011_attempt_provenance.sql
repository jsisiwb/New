-- 0011_attempt_provenance.sql — per-attempt provider provenance on the gateway audit (B-4-2)
--
-- WHY. `llm_calls` records one row per gateway CALL. When a call fell back from route 1 to route 2, the row
-- named the winning model and `fallback_from_model_id`, but nothing recorded WHY route 1 was abandoned or
-- what each individual attempt cost. That is the difference between "a fallback happened" and "a fallback
-- was authorized": an operator auditing spend or a post-incident review of a provider outage needs the
-- per-attempt verdict, and B-4-2's fallback invariants require each actual attempt to be attributable.
--
-- WHY A COLUMN AND NOT A TABLE. Attempts have no identity of their own, are never queried independently of
-- their call, and are written exactly once in the same statement as the call. A child table would add a
-- second append-only surface, a second RLS policy and a second grant for data that is always read with its
-- parent. The bounded jsonb array keeps the audit atomic — one row, one insert, one append-only trigger.
--
-- The summed `cost_cents` on the row remains the authoritative total; `attempt_records[].cost_cents`
-- attributes that total across attempts and must not be added to it. Prompt text, manuscript prose and
-- credentials never appear here: attempts carry model/provider identifiers, a failure classification,
-- token usage and latency only.

ALTER TABLE llm_calls
  ADD COLUMN attempt_records jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Fail closed on shape. A CHECK constraint cannot contain a subquery, so the per-element validation lives
-- in a trigger function — the same placement the rest of this schema uses for row-level invariants, and it
-- runs for every writer including raw SQL. A malformed attempt record is a gateway defect, not something
-- to store now and render to an operator later.
CREATE OR REPLACE FUNCTION canon.assert_attempt_records() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  a jsonb;
BEGIN
  IF jsonb_typeof(NEW.attempt_records) <> 'array' THEN
    PERFORM canon.raise_code('ATTEMPT_RECORDS_INVALID', 'attempt_records must be a JSON array');
  END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(NEW.attempt_records) LOOP
    IF jsonb_typeof(a) <> 'object'
       OR a->>'attempt' IS NULL
       OR a->>'model_id' IS NULL
       OR a->>'provider' IS NULL
       OR coalesce(a->>'outcome', '') NOT IN ('succeeded', 'failed') THEN
      PERFORM canon.raise_code(
        'ATTEMPT_RECORDS_INVALID',
        'each attempt record needs attempt, model_id, provider and outcome in (succeeded, failed)');
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER llm_calls_attempt_records
  BEFORE INSERT ON llm_calls
  FOR EACH ROW EXECUTE FUNCTION canon.assert_attempt_records();

GRANT EXECUTE ON FUNCTION canon.assert_attempt_records() TO yeonjae_app;

COMMENT ON COLUMN llm_calls.attempt_records IS
  'One entry per ACTUAL provider attempt for this call (B-4-2): attempt, model_id, provider, outcome, '
  'failure_class, error_class, cost_cents, usage, latency_ms. cost_cents on the parent row stays the '
  'authoritative total; these attribute it. Never contains prompts, prose or credentials.';
