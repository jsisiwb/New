# Schemas

JSON Schema 2020-12 contracts for the core objects. `$id`s live under `https://yeonjae.studio/schemas/`;
cross-references use relative names (`common.schema.json#/$defs/...`). Validate with
`python tools/validate-planning-package.py` (requires `jsonschema>=4.18`).

Text fields are **language-neutral** (`text`, `summary`, `statement`, `description`). Where the language of
user-authored text may vary, a `language` code (and optional `text_en` working paraphrase) accompanies it.
**Manuscript text follows the project manuscript language** — `en` or `ko` (`common.manuscriptLanguage`, OUTPUT-LANG-001, ADR-0054). Korean appears only as
terminology source terms and optional native-script names.

| Schema | Object | Primary docs |
| --- | --- | --- |
| `common.schema.json` | shared defs: uuid, languageCode, manuscriptLanguage (`en`), spellingLocale, text, localizedText, lengthModel, lengthTarget, storyClock (narrative + world order, calendars; ADR-0040), realityFrame, timelineKind, manuscriptStatus / manuscriptOrigin (ADR-0037), evidenceRef (code points), knowerRef, stance, dialogueRegister, registerShiftReason, qualityDimension, materiality, versionRef | glossary |
| `story-intake.schema.json` | user intake form (any input language; words per chapter; naming/terminology preferences) | FR-1.1 |
| `story-spec.schema.json` | normalized requirements (hard/soft/assumption) with language metadata | FR-1.2–1.5 |
| `concept.schema.json` | concept candidate | FR-2.1 |
| `narrative-identity.schema.json` | output-language / tradition / genre / setting / naming / register-policy / terminology / preferences profiles and composed identity | 02-narrative-identity/02 |
| `register-profile.schema.json` | per-character dialogue-register & voice baseline | FR-2.6 |
| `entity.schema.json` | bible entity identity (display / native-script / romanized names) + descriptive version | 04-memory-canon/02 §1.2 |
| `fact.schema.json` | bitemporal fact with evidence; `frame` ∈ fact-bearing frames per timeline kind | ADR-0006, ADR-0038, ADR-0039 |
| `event.schema.json` | canonical event with frame, `clock_start` (happened) and `narrated_at` (told) | ADR-0007, ADR-0040 |
| `proposition.schema.json` | knowable statement with **per-timeline truth**, secrets | ADR-0008, ADR-0031 |
| `knowledge-state.schema.json` | knower × proposition × stance | ADR-0008 |
| `relationship-state.schema.json` | directed pair state with abstract register | FR-7.9 |
| `promise.schema.json` | promise ledger entry | FR-3.4 |
| `series-blueprint.schema.json` | top-level plan | FR-3.2 |
| `arc-plan.schema.json` | arc plan (plan frame) | 03-story-planning/01 §4 |
| `chapter-contract.schema.json` | chapter acceptance unit (length target (words for en, characters for ko, ADR-0054); active constraints ref; status `draft/validated/locked/…`) | ADR-0013, ADR-0033, ADR-0037 |
| `scene-plan.schema.json` | drafting unit with pre-resolved English register per speaker pair | 03-story-planning/01 §8 |
| `scene-draft.schema.json` | writer output envelope (English; length model; register annotations) | 05-generation/01 §8 |
| `issue.schema.json` | evaluation finding with dimension, evidence and `override_class` | 05-generation/02 §1, ADR-0042 |
| `scorecard.schema.json` | merged evaluation with separate prose / structure / genre / voice sections and per-dimension `acceptance.dimension_results`; `overall.score` is informational only | 05-generation/02, ADR-0041 |
| `patch.schema.json` | span replacement with dimension | ADR-0014 |
| `lint-report.schema.json` | output-language check + prose/structure/register lint | 02-narrative-identity/04 |
| `comparison-verdict.schema.json` | pairwise judgment | ADR-0015 |
| `canon-delta.schema.json` | extracted/reconciled/verified change **proposals**; items are a discriminated union on `type` (payload validated per type); ops `assert / close / supersede / retract / open / advance / pay / create` with the change-class rules of ADR-0038 | FR-7.2–7.3 |
| `canon-delta-payloads.schema.json` | proposal shapes mirroring the stored schemas field-for-field (validator enforces the mirror) | FR-7.2 |
| `production-policy.schema.json` | versioned limits, per-dimension gates, candidate/extraction/context thresholds and the issue-override matrix — the single source for these numbers | ADR-0041, ADR-0042 |
| `canon-commit.schema.json` | atomic version bump record | FR-7.4 |
| `context-pack-manifest.schema.json` | pack contents, materiality, both contract hashes, validation | ADR-0010, ADR-0027, ADR-0032 |
| `llm-call-record.schema.json` | audit record per call (identity + contract hashes, output-language check) | NFR-A.1 |
| `job.schema.json` | workflow run record | FR-9.4 |
| `budget.schema.json` | spend limits | ADR-0018 |
| `export-request.schema.json` | export job input (spelling locale, romanized glossary) | FR-10.1 |

## Rules for implementers

1. Generate TypeScript types from these files (e.g., `json-schema-to-typescript`) or maintain Zod schemas
   with an equivalence test; never hand-fork.
2. Adding a field: add here first, bump the schema's documentation, update examples, then code.
3. Enums are closed lists on purpose (frames, stances, severities, quality dimensions, register shift
   reasons). Extending one is an ADR.
4. Do not reintroduce language-suffixed primary fields; use `language` metadata instead.
5. Offsets are Unicode code points into NFC text (ADR-0030); fixture evidence is checked against
   `examples/fixture/manuscripts/` by the validator.
6. Canon-delta payloads are proposals: `canon-delta-payloads.schema.json` mirrors each stored schema minus
   the ids/version fields the commit assigns. Add a field to the stored schema first, then to the proposal.
