# ADR-0057: Output shapes come from schemas; providers may enforce them natively

- **Status:** Accepted
- **Date:** 2026-09-23
- **Deciders:** product owner
- **Relates to:** ADR-0016 (prompt registry), ADR-0051 §6 and ADR-0056 §11–12 (live-output normalizers),
  ADR-0053 (pinned resume), the Step 0 improvement audit (§1, PR #1)

## Context

Most live-run fixes of ADR-0056 §11–12 were prompts teaching shapes that disagreed with their schemas: a
string `repetition_check`, 0–100 dimension scores, invented issue kinds, a string repair, offsets the model
cannot count, `changed_claims` pairs. Each was found in a live run and patched twice — once in a normalizer,
once in a new prompt version. Nothing in CI compared a prompt's output-shape example with its schema, and
eleven JSON roles (judges, checkers, the scene planner, the summarizer) had no answer schema at all. The
audit (§1) also found a bare `new RegExp` on model-written contract text, and that no normalizer reports
when it fires, so nobody can tell which of them live runs still need.

## Decision

1. **Every JSON role's answer has a schema.** `schemas/model-output.schema.json` describes the answers of
   the roles whose documents the workflow assembles (four judges, three checkers, the scene planner, the L1
   summarizer, the assumption explainer). `@yeonjae/prompts` `OUTPUT_SHAPES` maps each JSON family to its
   schema and lists the fields the workflow fills; `modelAnswerSchema(family)` returns the self-contained
   answer view (all `$ref`s inlined by `bundledSchema`, workflow-filled fields dropped from `required`,
   answer-only fields such as the architect's promise proposals declared). Five design roles without a
   schema are listed explicitly (`UNSCHEMATIZED_FAMILIES`); the list may only shrink.
2. **CI validates every active prompt's shape.** For each active JSON version, the one-line example under
   `[출력 스키마 …]` must validate against the answer view (formats unchecked — placeholders stand where the
   workflow supplies UUIDs), every `a|b` alternative and every enum value named in a note line must be a
   schema enum value at that location, and the prompt must name every workflow-filled field.
3. **Shapes are generated.** `renderShape` walks the answer schema with the current example: all required
   fields, schema enum values only (a role may narrow them), numbers in range, the example's Korean
   placeholder text kept, shape notes (ranges, long enums, per-type payload fields) derived from the
   schema. `tools/ko_prompts/shapes.py` splices the block into new versions; a generated example is a
   fixed point of the renderer and CI checks that. Two active examples failed the new check and get
   v4.3.0: `canon_extractor` taught `"payload": {}` for every item type (the discriminated union rejects
   it; the generated example shows a complete fact item and lists each type's required payload fields) and
   `story_architect` never said that the workflow fills season ordinals and entity ids. Every other family
   already validates and keeps its pinned version; new versions use the generator.
4. **Native structured output is a route capability.** `RouteEntry.nativeStructuredOutput: 'json_schema'`
   makes the gateway send the request's answer schema as the provider's response format; the OpenAI
   adapter maps it to `response_format: {type: 'json_schema', strict: false}`. Only live OpenAI-compatible
   routes can declare it, and only when `YEONJAE_LIVE_STRUCTURED_OUTPUT=json_schema` (default `json_object`,
   the previous behaviour). Notion, replay, synthetic and genspark routes never declare it, so their
   requests are byte-identical; the gateway's own validation and bounded regeneration remain the fallback
   everywhere.
5. **Normalizers are counted and classified.** Each ADR-0056 §11–12 normalizer records
   `yeonjae_output_normalizations_total{kind}` only when it changes an answer (process-wide registry,
   rendered on `/metrics`). Designed paths stay (quote anchoring for evidence, patches and judge issues,
   quotation-mark folding, JSON draft rebuilding). Shape repairs (`contract_output`, `scene_plans`,
   `patch_fields`, `judge_drift_flags`, `judge_dimension_scores`, `judge_repair`) are kept until their counter
   reads zero across live runs with generated shapes; a test pins that each leaves conforming answers
   unchanged and uncounted. Measured on the deterministic suites: the English replay suites fire none;
   the simulated-model runs fire only `scene_draft` and `evidence_anchor`.
6. **Model-written patterns compile safely.** A contract's `must_not_happen.lexical_patterns` entry that is
   not a usable regex (syntax error, or longer than 256 characters) is matched literally and recorded as a
   minor `CONTRACT-PATTERN-INVALID` finding; the deterministic checks never throw on it.

## Alternatives considered

- Regenerate every family's shape now — rejected: examples that already validate would change prompt bytes
  (and live behaviour) for no shape benefit; the CI check guarantees them, and WS9 moves every family onto
  the module generator.
- Strict JSON-schema mode — rejected for now: strict mode forbids `allOf`/`unevaluatedProperties` and needs
  every property required, which would fork the schemas.
- Delete the shape-repair normalizers — rejected: live runs showed them firing and no live run has used the
  generated shapes yet; the counter decides.

## Consequences

- New schema `model-output.schema.json` (generated types regenerated); `@yeonjae/prompts` depends on
  `@yeonjae/domain`. Registry: 297 versions; `canon_extractor` and `story_architect` active at v4.3.0.
- `GatewayRequest.responseSchema`, `ProviderRequest.responseFormat`, `RouteEntry.nativeStructuredOutput`,
  `YEONJAE_LIVE_STRUCTURED_OUTPUT` / `YEONJAE_LIVE_FALLBACK_STRUCTURED_OUTPUT` (names in `.env.example`).
- Follow-ups: answer schemas for the five design roles; judge versions generated from `model-output`
  (Workstream 3 changes the judge answer when gate scores become deterministic).
