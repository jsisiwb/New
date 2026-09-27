# Run 6 reading packet — read this first

Generated on 2026-09-26 from the permanent database by `pnpm cli packet:reading` and `pnpm cli corpus:blind-packet`
(read-only reports; no model was called). The run-4 and run-5 packets were never produced; this one covers every chapter
accepted so far. It is refreshed at the end of run 6.

## Reading order

1. **`blind/packet.md` — before anything else.** Twelve chapters in a seeded random order: six accepted pipeline chapters
   and six of your own chapters, each matched to a pipeline chapter by position (화 1–3) and point of view. Mark for each
   item whether you think you wrote it, and why. Do not open the answer key or the index first.
2. **The answer key.** `pnpm cli corpus:reveal --dir=ops/live-runs/run6/blind` decodes `blind/answer-key.b64.txt` and
   checks it against `blind/manifest.json` (the key is a separate file, base64-encoded so a glance does not give it away).
3. **`index.md`.** Every accepted chapter with its metrics: length with and without spaces, rounds (and whether an
   operator grant of extra rounds, ADR-0098, was needed), the approving scorecard's sub-scores against their gates,
   `corpus:likeness` (all chapters / first-person chapters), lint, and the chapter's model calls, tokens and model time.
4. **`accepted/<project>/chNN.md`.** The accepted texts, unedited, with the same metrics on top.
   - G23r (`standard@33`, regression, 1–3), G24a (`standard@35`, academy, 1–2), G17a (`standard@28`, academy, 1).
   - G25r / G25a (`standard@37`, the exit-condition projects of run 6) are still being produced; they are added when
     their chapters are accepted.
5. **`near-misses/`.** The two best versions that were approved and then not accepted (G22a v10 under `standard@32`,
   G21r v8 under `standard@31`), each labelled with what stopped it.

## What to look for

- Chapter titles do not exist yet: the title writer is STEP 5.5 of the run.
- Rounds marked "after an operator grant" were accepted only after run 5 granted the chapter five more rounds
  (G23r 2 and 3, G24a 1); within the policy's own five rounds they were not accepted.
- Every accepted chapter passed the policy's gates and the corpus copy check; nothing was overridden.

## Also here

- `g25r-intake.json`, `g25a-intake.json`: the intakes of the run-6 projects, identical to G24r's and G24a's
  (`ops/live-runs/phase-a-v7-intake.json`, `ops/live-runs/phase-c-academy-intake.json`).

**Note:** this repository is public, and `blind/packet.md` holds six complete chapters of your corpus (as the run-6
instructions asked). If they should not be public, remove the `blind/` folder from the branch before merging and keep
the packet elsewhere.
