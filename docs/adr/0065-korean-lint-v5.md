# ADR-0065: Korean webnovel lint v5 — 번역체 construction rates, rhythm, reflective endings, near copies, jamo-level names

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** product owner
- **Relates to:** ADR-0025 (exemplars are references), ADR-0056 (Korean style lint), ADR-0062 (lang/ko@4 rules), the
  Step 0 improvement audit (§5.5, §7.6)

## Context

The Korean lint (ADR-0056, ADR-0062) catches marker phrases, pronoun and simile rates, long paragraphs, low
dialogue share, one reflective-ending pattern, verbatim exemplar lines and names one syllable off. The audit
(§5.5) lists what it still misses: the rate of the constructions that make prose read translated (`~것이다`,
`~ㄹ 수 있었다`, `~기 시작했다`, `~것이 느껴졌다`), comma-chained narration, the sentence-length distribution,
속마음 (‘…’) counted apart from dialogue, the many ways a chapter ends on a summary instead of a 절단, near
copies of an exemplar, misspelled names beyond one syllable, and crowded status windows. No test proved that
prose written the translated way fails the lint (§7.6).

## Decision

1. **`lang/ko@5`** is `lang/ko@4` plus thresholds (starting values, uncalibrated) for eleven rules that run only
   when the layer carries them, so projects pinned to an earlier layer lint byte-for-byte as before; new
   projects compose the latest layer (ADR-0056):
   - `KO-OVR-01..04`: per-1,000자 rates of `~것이다/것이었다`, `~ㄹ 수 있었다`, `~기 시작했다`, `~것이 느껴졌다`;
   - `KO-COMMA-RATE`: commas per 1,000자 in narration (quotes excluded);
   - `KO-SENT-LONG`: share of narration sentences over 60자, with the mean and 90th-percentile sentence length
     reported;
   - `KO-DLG-SHARE`: dialogue plus 속마음 share, replacing `KO-DLG-LOW` in this layer;
   - `KO-END-03`: a list of reflective and summary endings ("그렇게 … 하루가 저물었다", "아직 아무도 몰랐다",
     "앞으로 어떤 운명이 … 기다리", "운명의 수레바퀴", "그것이 시작이었다"…), replacing the single `KO-END-01`
     pattern in this layer;
   - `EXEMPLAR-NEAR`: the share of a paragraph's 8-character shingles found in the studio exemplars (near copies
     that the verbatim `EXEMPLAR-COPY` misses);
   - `KO-NAME-02`: a word within one or two compatibility jamo of a registered name (two for names of three or
     more syllables; initial and final consonants share letters, so 서지누 is one letter from 서진우), never a
     registered name, short form or alias, replacing `KO-NAME-01` in this layer;
   - `KO-WIN-LINE`: a status window with more than one field on a line.
2. The digest the judges and the reviser read gains one line of v5 measurements only when they exist.
3. A synthetic translated-prose passage (studio test strings) must fail the v5 rules, and the same passage must
   trigger none of them under `lang/ko@4`.

## Alternatives considered

- **Adding the constructions as weighted translation markers.** Rejected: a marker adds to one weighted rate,
  while each construction's own rate is what a reviser can act on and what calibration can tune.
- **A morphological analyser for sentence and ending detection.** Deferred to the spelling/spacing decision
  (audit §5.6): the patterns here are surface forms that regular expressions match exactly.
- **Genre-aware Latin allowances.** Not in this layer: status-window Latin (STR, HP) is at most three letters and
  already outside the Latin rule; longer terms stay allowlist entries until a live run shows a need.

## Consequences

- Translated-prose habits become rate findings with paragraph anchors that feed the prose judge, the gates and
  the targeted reviser. The thresholds are starting values until live chapters and human ratings calibrate
  them (Workstream 8).
- Not built: genre-aware Latin allowances, an offline spelling and spacing checker (§5.6), naming fit for new
  names (§5.8), POV as a project choice (§5.13) and per-role sampling in the policy (§5.15).
