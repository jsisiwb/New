# ADR-0076: Hierarchical story memory — arc summaries (L2), `standard.v9`

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** engineering, product owner
- **Relates to:** ADR-0061 (long-story memory), ADR-0063 (state ledgers), ADR-0058 (Korean retrieval),
  ADR-0075 (`standard.v8`), `docs/04-memory-canon/04-context-pack-assembly.md` §4.1.

## Context

The story-so-far section (ADR-0061) carries the L1 summary of every accepted chapter before the previous one,
in blocks of ten, and the budget sheds the oldest blocks first. A Korean L1 summary is about 400자, so the
digest grows by about 4,000 estimator tokens every ten chapters: at 100화 it is ~40,000 tokens and at 200화
~80,000 — more than twice the whole `standard.v8` writer budget. Past roughly chapter 40 the writer, the chapter
planner and the continuity checker would see only the latest blocks; everything older reaches them only through
retrieval hits and the ledgers. The design (`pack.summarizer`, `summarizer_l1/l2/l3/l4`; `pack.arc_planner`
"prior arc L2s") always meant arc-level summaries; none was built.

## Decision

1. **`arc_summarizer` (prompt family 4.5.0, Korean, class C, JSON `{summary_l2}`)** writes one arc summary
   from the accepted L1 summaries of an arc's chapters, in order, and the last chapter's ending hook. It may not
   add anything the summaries do not say; it names the arc's events, the state, relationship and knowledge
   changes, the promises paid and still open, and where the arc stopped, in at most `l2_max_chars`.
2. **When.** Under `context.story_memory.arc_summaries`, before a chapter's arc is planned, every earlier
   scheduled arc whose chapters are all accepted gets its summary if it has none (`ensureArcSummary`, a
   checkpointed step). The first stored summary of a chapter range wins (`insertArcSummaryOnce`), so the other
   chapter jobs of the arc read it and spend nothing. The previous arc's summary joins the next arc planner's
   brief next to its planned exit and its accepted ending.
3. **What is read.** A summary is stored as an L2 row (`summaries`, scope `arc`) and read only while every
   chapter it covers is accepted. The story-so-far section keeps the L1 lines of the last `recent_chapters`
   accepted chapters in blocks of ten and gives each older summarized arc one item; an arc that reaches into the
   window or overlaps another is not used. Arc items rank above chapter blocks of the same age, so a tight
   budget sheds old chapter detail before whole arcs. Without the block the section is ADR-0061's, byte for byte.
4. **`standard.v9`** = `standard.v8` + `context.story_memory { arc_summaries: true, recent_chapters: 20,
   l2_max_chars: 500 }` (starting values).
5. **Retrieval fixture.** The Korean retrieval fixture grows from 26 to 60 queries: 21 for paragraphs no query
   targeted and 13 alias and paraphrase queries (특대생, 하르트, 세라, 흑막). Recall@5 stays saturated (1.00
   Korean, 0.85 English FTS), so the suite also asserts rank quality: recall@1 ≥ 0.80 and MRR ≥ 0.85 for the
   Korean path (measured 0.82 / 0.88; English FTS 0.67 / 0.74).
6. **Live defect L-1 (patch scope).** The live `standard.v8` run failed chapter 1 in its second revision round:
   the reviser returned a patch without `scope`, the patch failed its schema and the run stopped
   (`PATCH_UNANCHORED`). The patch-field normalizer now infers a missing or invalid scope from the replacement
   text — several paragraphs are a scene rewrite (which re-runs the claim checkers), one line with several
   sentences a paragraph, else a sentence — and counts it under `patch_fields`. A patch that carried a valid
   scope is unchanged, so every run that passed before replays unchanged.

## Alternatives considered

- **A deterministic arc digest** (first sentences or ending hooks of the L1 lines). Rejected: it compresses by
  a constant factor, so the digest still grows with every chapter (≈ 12k tokens at 200화) and ending hooks are
  cliffhangers, not events.
- **Season summaries (L3) now.** Deferred: with ten-chapter arcs the 200-화 digest is ~20k estimator tokens
  (below); an L3 over each season's arc summaries is the next step if serials run far past 200화.
- **Voice cards for the writer.** Not built here: the writer already receives each participant's planned
  `voice_notes` in the registry slice; cards of how a character actually spoke need speaker-annotated
  utterances of accepted versions, which are not persisted (speaker annotations live only on scene drafts).

## Consequences

- One class-C call per arc (≈ one per ten chapters), made once.
- 200-화 simulation (`packages/context/src/story-memory.test.ts`, synthetic 400자 L1 and 500자 L2 lines, Korean
  estimator): the flat digest is 19,611 / 39,641 / 59,782 / 79,922 tokens at 50/100/150/200화; the
  hierarchical one 12,634 / 15,179 / 17,798 / 20,363, every chapter represented exactly once, growth past the
  window one arc (~500 tokens) per ten chapters.
- Evidence: `story-memory.test.ts` (5), `policy.test.ts` (v9 = v8 + the block), the prompt registry and
  output-shape suites (the new family), the Korean `standard.v9` simulated run in `novel-ko.integration.test.ts`
  (an arc boundary: one summarizer call, the L2 row, the next arc planner's brief, no Latin-script leaks),
  `revision.test.ts` (scope inference), `korean-retrieval.integration.test.ts` (60 queries).
