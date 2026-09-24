# ADR-0066: Concept angle seeds and the world-rules term in the manuscript language

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** product owner
- **Relates to:** ADR-0051 (autopilot bible assembly), ADR-0054 (manuscript language per project), ADR-0055
  (fully Korean prompt surface), the Step 0 improvement audit (§6.1)

## Context

`suggestConcepts` gives each concept candidate an angle seed (the most faithful reading, a sharper hook, a
character-forward angle, a subversive angle). The seeds were English strings. The Korean `concept_generator`
template (v2.0.0 and later) introduces the seed in Korean (`이 후보의 앵글 시드:`), so every Korean concept
prompt carried one English instruction line. Bible assembly (ADR-0051) attaches the locked world and
progression rules to a term entity it creates itself, named `World rules` with an English description, so a
Korean project's entity registry, and every Korean pack that lists it, held an English name.

The Korean end-to-end test scans every prompt for Latin-script words (ADR-0059) and did not catch the
seeds: the simulated model echoes its seed back as the concept's `angle`, and words the model wrote are
exempt from the scan.

## Decision

1. Angle seeds come in the manuscript language: four Korean seeds with the same four intents, and a Korean
   fallback (`대안 앵글 N`) past the fourth. The English seeds keep their bytes, so English concept calls
   replay unchanged.
2. The assembled world-rules term is named in the manuscript language: `세계 규칙` with a Korean description
   for Korean projects, `World rules` as before for English ones. Existing bibles keep the entity they have;
   only bibles assembled after this change get the Korean name.
3. The Korean end-to-end test checks the seeds and the term directly: every concept request carries one of
   the Korean seeds, with no Latin letters, and the bible's term entities include `세계 규칙` and not
   `World rules`.

## Alternatives considered

- **A new `concept_generator` version with the seeds inside the template.** Rejected: the seeds are
  workflow data chosen per candidate; moving them into the prompt would need one template per seed.
- **Keeping the English term and adding a Korean alias.** Rejected: the display name is what packs render,
  and an alias would still put the English name in front of the writer.

## Consequences

- A Korean project's concept prompts and entity registry carry no English from the workflow.
- The operator-facing error messages of bible assembly stay English; they are not prompt text.
