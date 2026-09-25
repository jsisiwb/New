# ADR-0077: Multi-patch revision rounds (`standard.v10`)

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** engineering, product owner
- **Relates to:** ADR-0014 (patch-first revision and regression), ADR-0060 (targeted re-evaluation),
  ADR-0064 (discard and continue), ADR-0076 (`standard.v9`), `docs/08-delivery/12-live-run-ws1-7.md` §8.

## Context

A revision round targets one dimension and sends the reviser the **union** of every targeted issue's span.
On a live Korean chapter the targeted issues sit all over the text, so the union is most of a scene or the
whole chapter, and the reviser rewrites it (live `standard.v8`, chapter 1: `scope: "scene"`, the opening
rewritten). The rewrite fixes the targeted findings and brings new ones, and the patch regression check
(ADR-0014) quarantines it. The live evidence:

- Phase A (`standard.v6`): three rounds, every patched version quarantined.
- `standard.v8` chapter 1 (5,349자, target 5,300): r0 overall 77 with 7 majors and prose 66.1/78; the patched
  rounds scored prose 93.1, 85.6 and 81.2, and every one was quarantined. The chapter stopped
  `APPROVAL_BLOCKED` on r0 with 0 blocking and 7 majors.

`max_patches_per_round` (starting value 6) has been in the policy since `standard.v1`, but nothing used it.

## Decision

1. **`revision.multi_patch { max_patches, merge_gap_chars }`.** The round clusters the targeted issues by
   span: sorted by start, an issue within `merge_gap_chars` of the cluster before it joins that cluster. Each
   of at most `min(max_patches, max_patches_per_round)` clusters gets its own reviser call and sees only its
   own window and its own issues. An issue without a span joins no cluster. When no issue has a span, the
   whole text is one cluster, as before.
2. **Validation per sub-patch.** A sub-patch must anchor **inside its own window**, and it must validate,
   match its quote, acknowledge its must-preserve facts, pass the language check and change something.
   A sub-patch that fails any of these is recorded and dropped; the round fails (`PATCH_UNANCHORED`) only when
   none is usable. The single-patch path is unchanged: there, one invalid patch still fails the round.
3. **One revision.** The usable sub-patches are merged into ONE new version. It is recorded as one
   schema-valid envelope patch: from the first sub-patch's start to the last one's end in the parent, with the
   widest sub-patch scope, and the union of claims, acknowledgements and issues. A `patch_set` artifact keeps
   each sub-patch and each dropped call. The regression check, targeted re-evaluation and discard-and-continue
   then treat the round exactly as before. The K1 polish round goes through the same path.
4. **`standard.v10`** = `standard.v9` + `revision.multi_patch { max_patches: 4, merge_gap_chars: 120 }`
   (starting values). Policies v1–v9 replay byte-identically.

## Alternatives considered

- **One version per sub-patch, each with its own regression check.** Rejected for now: it multiplies
  evaluator calls by the number of patches, and one bad sub-patch would still hold up the others.
- **A narrower union window.** It does not help when two findings sit far apart, which is the common case.
- **A looser regression check.** Rejected: it would let scene rewrites that bring new majors through the gate.

## Consequences

- A round costs up to `max_patches` reviser calls instead of one. Each call is small (one window of about a
  sentence to a paragraph, ±600 code points of context).
- Scene rewrites happen only when a finding really spans a scene. The widest scope still decides whether the
  claim checkers re-run.
- Evidence: `multi-patch.test.ts` (clustering, merging, overlap refusal, widest scope), `policy.test.ts`
  (v10 = v9 + the block), and two Korean `standard.v10` simulated runs in `novel-ko.integration.test.ts`:
  one where two findings far apart get two patches applied as one revision whose envelope patch reproduces
  it, and one where an unanchored sub-patch is dropped and the other applies. Live evidence on
  `standard.v10` is in `docs/08-delivery/12-live-run-ws1-7.md` §8.
