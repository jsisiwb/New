# Prompt Architecture

## 1. Prompt Registry (ADR-0016)

`packages/prompts` holds **prompt families** (one per role). Each family has immutable **versions**:

```
prompt_versions {
  id, family, version (semver), content_hash,
  system_template, user_template (templating with strict variable allowlist),
  output_schema_ref (schemas/… or inline JSON Schema), style_sensitive bool, identity_block_role,
  manuscript_producing bool,             -- triggers the post-call output-language check
  model_routing_policy_ref, default_params { temperature, max_tokens, top_p, seed? },
  guards { max_input_tokens, requires_pack_template, forbids_untrusted_in_system: true,
           requires_output_language_contract: bool, requires_tradition_contract: bool },
  changelog, created_by, created_at, status: draft|candidate|active|deprecated,
  regression_result_ref
}
```

- Templates are stored in the repo (`packages/prompts/families/<role>/vX.Y.Z/`) and mirrored into the DB
  at deploy with hash verification; the DB is the runtime source; the repo is the review surface.
- A project pins the `active` version set at job start (`prompt_set_version`) so a long batch does not
  change prompts mid-run unless the user opts in.
- Every `llm_calls` row records `prompt_version_id` + `content_hash`.
- Promotion: `draft → candidate` (regression suite green, including the five-class contrast set for
  style-sensitive roles and the output-language check for manuscript roles) → `active` (manual) →
  `deprecated`.

## 2. Prompt anatomy (all roles)

```
[SYSTEM]
 1. Role identity & mission (English)
 2. Non-negotiables: output schema; no content outside JSON; evidence rules; "do not invent canon"
 3. <<NARRATIVE_IDENTITY v=…>> block (style-sensitive roles)  ← Guard verifies presence of the block
    AND of both contracts (Output-Language Contract: English; Narrative-Tradition Contract: Korean webnovel)
 4. Safety/content restriction summary (from spec; hard)
[USER]
 5. Context Pack sections in template order (stable → volatile), each with a heading and provenance tags
    [FACT v128 ch.12] / [PLANNED] / [SUMMARY L2] / [EVIDENCE ch.9 ¶14]
 6. Task instruction (what to produce now), including explicit constraints from the contract
 7. Output schema reminder (short) + IDENTITY_TAIL (writer/editor)
```
Rules:
- **No conversation history.** Each call is single-turn (system + user). Multi-step refinements are
  separate calls with explicit inputs.
- **Provenance tags on every context item** so the model can distinguish canon, plan, summary, evidence,
  untrusted.
- **Untrusted text** only in the user message, wrapped in `<<UNTRUSTED source=…>>` and preceded by an
  instruction to treat it as data; never in system.
- **Language**: prompt instructions are written in the project's manuscript language (English or Korean,
  ADR-0054). For English projects the instructions are English; for Korean projects they are Korean —
  and so is everything interpolated into them: identity block, context-pack titles and canon lines,
  Active Constraint Set, planner briefs (ADR-0055). JSON keys, schema enums, ids and provenance tags stay
  identifiers. The fully Korean families are authored by `tools/seed-prompt-families-ko-v3.py`.
  Korean craft terminology appears glossed inside the Narrative Identity Block (e.g., "satisfaction beat
  (사이다)") and inside the naming/terminology registry (native-script names, preserved terms).
  Generation composes directly in the manuscript language and never contains an in-loop translation
  step (NO-TRANSLATION-001); English is produced only by the explicit export/translation step.
- **Few-shot**: analytic roles use 1–2 compact schema examples (synthetic, English); prose roles rely on the
  identity block's exemplars only (avoid double-anchoring).

## 3. Structured output strategy

- Provider-native JSON schema mode where available; else "JSON only" instruction + robust parser.
- Validation with the registered JSON Schema; on failure: `json_repairer` (cheap model, sees the invalid
  output + schema + error) ×2 → regenerate ×1 → fail step with diagnostics.
- Prose in `text` fields (`language: "en"`) with escaping handled by the SDK; large prose outputs may use a
  two-part format (JSON header + delimited text block) if a provider's JSON mode degrades English prose
  quality — the gateway normalizes both into the same envelope (`scene-draft.schema.json`).
- **Post-call output-language check** for `manuscript_producing` roles (FR-4.10): language identification
  on prose segments (excluding registry romanizations and preserved-script contexts) must be English with
  confidence ≥ 0.99; failure discards the output, records `output_language_failed`, and regenerates once
  with the violation named; a second failure routes to the alternate P-class model.
- Truncation: `max_tokens` set from the word target × 1.6 safety factor (English tokens-per-word ratio
  calibrated per model); `finish_reason=length` → continuation protocol (see pipeline §8).

## 4. Role-specific prompt notes

| Role | Key instructions | Anti-patterns to enforce |
| --- | --- | --- |
| `scene_writer` | Write only the current scene, in natural English, composed directly; continue seamlessly from the provided previous text; render each speaker pair's register as specified (titles/address terms/contractions/directness); use the knowledge lists (knows / unaware / believes falsely / suspects); emit `speaker_annotations` and `claims` | recap of previous chapter; lore dumps; transliterated honorific suffixes; kinship vocatives for non-kin; Western-novel scene-setting openings; headings; any non-English prose |
| `chapter_assembler` | Edit only seams; return seam patches, not full text; propose an English title in genre style | rewriting scenes |
| `line_editor` (Premium/pass on request) | English polish within meaning; return paragraph patches; preserve serialized rhythm (do not "literarize") | changing facts (must ack); lengthening paragraphs |
| `prose_reviser` | Fix the named prose issues in the span only; keep claims; keep register | drifting into literary diction; altering hooks/endings |
| `structure_reviser` | Fix hook/ending/exposition/payoff issues in the named span per the contract's hook/ending type; keep facts | rewriting unrelated paragraphs |
| `dialogue_reviser` | Re-render utterances to the specified register (formality, address terms, contractions) in natural English | Korean speech-level literalism ("Have you eaten?"), honorific morphemes |
| `continuity_checker` | For each suspected issue, quote chapter span and cite the canonical item + evidence; state confidence; propose minimal repair | vague criticism; unsupported claims |
| `knowledge_leak_checker` | Enumerate participant utterances/actions that presuppose knowledge; check against the table | flagging narrator knowledge as character knowledge |
| `prose_judge` | Score English fluency/idiom, translation-like syntax, literary/Western diction drift, readability with Korean-webnovel mobile norms; evidence paragraph IDs before scores | rewarding ornate prose; penalizing short paragraphs |
| `structure_judge` | Score hook, episode payoff, pacing, exposition control, dialogue-forwardness, ending pull, cadence fit, serial devices; evidence first; flag `western_novel`/`serial` drift | judging language quality (not its dimension) |
| `genre_judge` | Reader fantasy delivered? devices correct? vocabulary register? taboo overuse? | plot criticism outside genre fit |
| `voice_judge` | Distinguishability, verbal habits, register naturalness vs digests; confirm `intentional_shift` reasons | flagging register changes that canon records |
| `extractor_a` | Entity-first sweep: for each entity present, list state/attribute/knowledge/register changes with quotes | inventing off-page events |
| `extractor_b` | Event-first sweep: chronological events, participants, frames, then derived facts/knowledge | paraphrased quotes |
| `extraction_adjudicator` | Decide between conflicting items using only the provided spans; may reject both | picking without quoting |
| `summarizer_l1` | ≤ 120 words English; plot + state changes + hook; registry names; no evaluation | including plans |
| `chapter_planner` | Produce a contract satisfying arc beats, cadence, and promise schedule; every knowledge delta needs a channel; language-aware length target (words for en, characters for ko, ADR-0054) | scheduling reveals that guards forbid |
| `change_request_interpreter` | Convert free-text change request (any language) into patch tasks with spans or contract edits | rewriting whole chapter |

## 5. Prompt regression suite

For each family: a set of **golden cases** (inputs: fixture packs; expected: structured assertions such as
"issue with kind=knowledge_leak on paragraph 14", "no format drift", "`kwn_english` variant scores above
`western_english` on structure and above `translation_like` on prose", "extractor recovers injury fact with
quote", "scene_writer output passes EP-LANG-01 on 20/20 samples"). Running the suite on every new version
produces `regression_result_ref`; promotion requires: no regression on blocking assertions; ≥ parity on
scores; cost/latency deltas reported. Suite runs against the configured models for the role and records
model versions (prompts are model-sensitive; a model change also triggers the suite).

## 6. Versioned prompt sets

`prompt_sets { id, name, mapping role→prompt_version_id, model_routing_ref }`. Projects pin a set; batches
pin at start; per-call override for experiments is recorded. Changing the set mid-project is an explicit
user action with a note in the audit log.

For chapter and story-planning jobs, the active set supplies defaults only at job creation. Resume uses
the persisted mapping, verified against the immutable registry and available prompt content; a new
active version does not rewrite an existing job's pins (ADR-0053). Missing historical versions or
changed policy/identity inputs fail closed before model calls. Retain historical prompt files during
rollout; new prompt defaults alone do not require draining otherwise compatible jobs.

Resume failures use `STEP_NONDETERMINISTIC` with a structured `data.reason`. For
`missing_historical_prompt`, restore the required version's files. For `prompt_version_mismatch`, restore
the original immutable content rather than editing its stored hash. For `input_pin_mismatch`, restore
the job's policy/identity configuration or explicitly start separate work. Mapping or malformed-pin
errors require investigating data integrity; never repair them by silently substituting active defaults.

## 7. Security in prompts

- System prompts are static templates; no user text is interpolated into system positions except the
  content-restriction summary, which is generated from enumerated spec fields (not free text).
- Free-text requirements appear in the user message under `[REQUIREMENTS hard/soft]` (English working
  paraphrase, with original text and language code available) with an instruction that they describe the
  *story*, not the assistant's behavior; a classifier (`instruction_injection_classifier`, cheap) flags
  requirement/direction texts that look like meta-instructions for human review before they enter the spec.
- A user direction cannot change the output language or disable the Narrative-Tradition Contract; such
  directions are rejected at intake with an explanation (the contracts are project configuration under
  ADR-0026, not free-text preferences).
