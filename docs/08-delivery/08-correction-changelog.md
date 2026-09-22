# Correction Changelog — English manuscript / Korean-webnovel tradition

This document records the repository-wide architecture correction made after the product requirement
was clarified: **manuscripts are English, composed directly in English, in the Korean serialized-webnovel
narrative tradition** (ADR-0026). It exists so that reviewers can see what changed and why, and so the
validator's allowlist can point to one place that legitimately mentions the old design.

## What was wrong

The first planning pass required Korean-language manuscripts: "output always Korean", `text_ko`-style
primary fields, English treated as leakage, prose models qualified on native Korean, Korean character
counts, Korean grammar/honorific/pronoun/punctuation lint applied to manuscript prose, a Korean NLP
sidecar, Korean-only fixtures and editor evaluation.

## What changed (by area)

| Area | Change |
| --- | --- |
| Governing principle | ADR-0026; five governing requirements (OUTPUT-EN-001, STYLE-KWN-001, STYLE-GUARD-001, EVAL-SEPARATION-001, NO-TRANSLATION-001) in FR-0 |
| Narrative identity | the former `02-korean-style` directory → `docs/02-narrative-identity`; eight separable profiles (output language, tradition, genre, setting/culture, naming, dialogue register, terminology/romanization, preferences); Narrative Identity Block with two contracts; fail-closed Guard requiring both (ADR-0027) |
| Quality dimensions | English Prose Lint (EP-*), Structure Lint (ST-*), register check (RG-*); Prose/Structure/Genre/Voice judges as separate calls and scorecard sections; five-class contrast set |
| Korean NLP | Sidecar removed; `packages/prose` + optional English grammar service (ADR-0028) |
| Dialogue register | Korean speech levels replaced by abstract register axes rendered in natural English; `register-profile.schema.json`; `relationship-state.register` |
| Naming & terminology | `display_name` / `native_script_name` / `romanization`; terminology policy (translate / romanize / gloss / preserve) |
| Length | Language-neutral length model; words as author-facing unit; no mechanical conversion (ADR-0034) |
| Korean manuscript language (2026-09-22) | OUTPUT-EN-001 → OUTPUT-LANG-001: manuscript language is per project (`en`\|`ko`); Korean prompts active set; length unit characters for ko (ADR-0054, amends ADR-0034) |
| Schemas | All `*_ko` fields → language-neutral; `common.manuscriptLanguage`, `localizedText`, `lengthModel`, `lengthTarget`, `dialogueRegister`, `qualityDimension`, `materiality`; `narrative-identity.schema.json` replaces `style-profile`; `register-profile` replaces `speech-profile`; `proposition.truth[]` per timeline |
| Fixture | *Second Awakening* rewritten in English with romanized names; traps T23–T29 for narrative-identity drift; contrast sets in five classes; register cases |
| Architecture fixes | Per-timeline truth (ADR-0031); code-point addressing (ADR-0030); material vs contextual dependency edges (ADR-0032); Active Constraint Set (ADR-0033); per-model embedding sets (ADR-0035); MVP vertical slice (ADR-0036); calibration-dependent thresholds (ADR-0029) |
| Model qualification | P-class benchmark = natural English under Korean-webnovel structural constraints; Korean-language ability is not a criterion |
| Human evaluation | Bilingual reviewers rating on two scales (natural English; reads as Korean webnovel) |
| Tooling | `tools/validate-planning-package.py` scans for contradictory language-output statements and stale field names |

## Superseded ADRs

ADR-0005 → 0027 · ADR-0017 → 0028 · ADR-0024 → 0030 + 0034. ADR-0001, 0004, 0010, 0011, 0025 amended in
place with notes.

## Remaining Korean in the repository (intentional)

- Glossary and genre catalog: Korean craft terms (사이다, 회귀, 상태창…) **glossed in English** as the
  vocabulary of the tradition.
- Terminology policies and examples: Korean **source terms** (헌터 → hunter) that the policy decides how to
  render in English.
- Naming registry: optional **native-script names** for reference; never in prose.
- Superseded ADRs and this changelog: historical description of the old design.
