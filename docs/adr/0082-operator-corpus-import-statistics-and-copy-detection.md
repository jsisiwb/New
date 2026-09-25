# ADR-0082: The operator corpus — import into the permanent database, statistics, copy detection

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** engineering (autonomous run; the operator reviews through the PR chain)
- **Relates to:** ADR-0054 (NO-TRANSLATION-001), ADR-0062 (exemplar priority), ADR-0065 (`lang/ko@5` lint),
  ADR-0081 (one paragraph per line), `docs/10-corpus/operator-voice-analysis.md`, `docs/10-corpus/corpus-stats.md`.

## Context

The studio's target voice is the operator's own Korean webnovels: three EPUB files in `sigma43web/ko-corpus`
with a `Manifest.csv` of titles and hashtags. The operator allows them in the public repository for now and
will delete them later, so everything must work from the permanent database afterwards. Reading the files
showed:

1. **One of the three books is not Korean.** `아카데미 사기 룬을 얻었다.epub` is an English machine translation
   (every spine document is titled "Translated Chapter"; 0 of 364 documents are Korean-majority; 208 Hangul
   against 3.4 million Latin letters). The other two books are Korean (1.52 M and 1.45 M Hangul).
2. **`Manifest.csv` is not a CSV**: a title line, hashtag lines, blank lines between books, leading spaces.
3. **Neither Korean book is uniformly first person**: both narrate the hero in 1인칭 and move to 3인칭 for other
   characters (cutaways in book 1, whole chapters in book 2).
4. **The lint's dialogue share misses straight quotes** (defect C-1): `KO-DLG-SHARE` counts “…” and ‘…’ only,
   and 297 of book 2's 335 files write dialogue in straight quotes. A draft in the operator's own quoting would
   read as having no dialogue.
5. **A copy detector on raw characters would block generic Korean.** Measured: a 5,000자 pipeline draft that
   never saw the corpus shares four 14-character strings with it counting spaces ("눈길 한 번 주지 않았다.",
   "한 목소리가 흘러나왔다."), and the two books share 1,057 such strings with each other. Counting only Hangul
   syllables, letters and digits, the same draft shares none and the two books share two phrases.

## Decision

1. **Schema `corpus`** (migrations 0023, 0024): `books` (keyed by the SHA-256 of the source file; store id, title,
   manifest tags, language, translation flag, voice eligibility, inferred POV with its evidence),
   `chapters` (spine order, kind, 화 position, the text with one source paragraph per line and blank lines
   kept, character counts, inferred POV), and the derived tables `annotations`, `passages`, `contrast_pairs`.
   Studio-level reference data owned by the operator role; nothing is granted to the application role.
2. **`corpus:import <dir|git-url>`** reads the EPUBs in spine order with a dependency-free reader (ZIP
   central directory, OPF spine, each document's heading and paragraphs; markup and entities removed, quotes,
   brackets and ellipses kept exactly), classifies each document (notice, prologue, chapter, side story,
   epilogue, afterword; a numbered heading is always a chapter), matches the manifest by a title key (NFC;
   bracketed ids, punctuation and spaces removed; the file name as fallback) and keeps a leading `[number]` as
   the store id. One transaction per book; a file already imported is skipped (idempotent, resumable).
   `corpus:list` and `corpus:stats` read only the database.
3. **The translation is imported but carries no voice.** `text_language = 'en'`, `is_translation`,
   `voice_eligible = false`; its Korean file name is its title. Statistics, calibration, exemplars, contrast
   pairs, the gold set and every annotation read voice-eligible books only: a Korean prompt never receives it.
4. **POV is inferred per chapter and per book** from narration first-person markers (나는/내가/…) against
   third-person markers (그는/그녀가/…), dialogue and bracket lines excluded, and marked inferred.
5. **Statistics use the lint's own code** (`chapterMetrics` over `lintKoreanWebnovel`, one paragraph per line),
   reported as p2/p10/p50/p90/p98 per book, position (화 1–25 vs later) and POV. Dialogue share counts straight
   quotes (C-1); the lint itself is fixed in the next language layer (C4).
6. **Copy detection** (`CorpusCopyIndex`, rule `CORPUS-COPY-01`, kind `corpus_copy`): a span that shares at
   least 14 consecutive Hangul syllables, letters or digits with the corpus — spaces and punctuation ignored,
   as the 공백·문장부호 제외 count does — is a **blocking** finding on every evaluated version (draft, patch,
   polish) under `evaluation.corpus_copy { min_chars }`. The index is built per process from the database
   (2.95 M windows in 0.7 s; a draft is checked in about 2 ms) and every hash hit is verified against the
   corpus text.

## Alternatives considered

- **Drop the translated book.** Rejected: the database should mirror what the operator supplied, and a
  recorded exclusion is auditable; excluding it at read time costs nothing.
- **Use the translation for structure annotation.** Rejected: any pipeline annotation would place English
  text in a Korean prompt (rule 3), and translated lengths and rhythm are not the operator's.
- **Copy detection on raw 14 characters.** Rejected by the measurement above: it would block drafts for
  generic phrasing the operator happens to have used once. Raising the raw window instead (e.g. 20) would let
  a reused clause with its spaces through; the syllable count keeps the operator's "14" and discriminates.
- **Exempt phrases seen in both books.** Rejected: the operator's own repeated phrases are still their
  sentences, and the syllable rule already leaves only two shared phrases.
- **Store the corpus in tenant tables with RLS.** Rejected: it is studio-level reference data of one
  operator; a separate schema without application grants is stricter.

## Consequences

- The permanent database holds the corpus: 3 books, 1,138 chapter rows (656 Korean main-story chapters),
  8.5 M characters; re-import creates nothing. `corpus-stats.md` is generated from it.
- A5 is answered by the corpus: first-person chapters have a dialogue + 속마음 median of 23.2 % (p10 12.6 %,
  p2 7.6 %), first-person 화 1–25 a median of 25 % (p10 9.9 %) — the current floor (warn 25 %, fail 15 %) would
  flag half of the operator's own first-person openings (C4 recalibrates it in the next language layer).
- Tests: `packages/prose/src/corpus.test.ts` (manifest, title keys, classification, EPUB reading with a
  generated ZIP, translation detection, POV, copy index, endings, metrics),
  `packages/workflows/src/corpus-index.integration.test.ts` (idempotent import, voice-eligible chapters, the
  index built from the database), the migration replay suite over 0023–0024.
