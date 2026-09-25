# Voice calibration against the operator's chapters (C4, C5, C7, C8)

Evidence for ADR-0083. Every number is measured with the lint's own code on the 656 Korean main-story chapters of
books 1 and 2 (`corpus.chapters`, voice-eligible; book 3 is a machine translation and excluded), one paragraph per
line. Commands: `corpus:calibrate`, `corpus:passages`, `corpus:likeness`, `corpus:stock-phrases`. Pipeline text
quoted here was written by the pipeline; operator text is quoted only as short evidence.

## 1. Lint calibration (C4)

`corpus:calibrate --layer=lang/ko@6`: each text-only rule's value on every chapter (all chapters, and the first-person
chapters), and the proposal warn = p90, fail = p99.5 ("tail"; for talk share, where low fails: p10 and p0.5).

| rule | current warn / fail | all p2 / p10 / p50 / p90 / p98 / tail | first-person p2 / p10 / p50 / p90 / p98 / tail | proposed warn / fail |
| --- | --- | --- | --- | --- |
| KO-TRN-RATE | 2 / 4 | 0.11 / 0.25 / 0.56 / 0.94 / 1.22 / 1.36 | 0.02 / 0.16 / 0.46 / 0.77 / 1.03 / 1.26 | 0.94 / 1.36 |
| KO-AIT-COUNT | 3 / 6 | 0 / 0 / 0 / 2 / 3 / 4 | 0 / 0 / 0 / 2 / 3 / 4 | 2 / 4 |
| KO-PRN-RATE | 3 / 6 | 0 / 0.66 / 2.12 / 3.79 / 4.9 / 5.74 | 0 / 0.16 / 1.51 / 2.57 / 3.17 / 3.78 | 3.79 / 5.74 |
| KO-SIM-RATE | 1.2 / 2.5 | 0 / 0 / 0.36 / 0.95 / 1.43 / 1.76 | 0 / 0 / 0.29 / 0.85 / 1.38 / 1.79 | 0.95 / 1.76 |
| KO-CONJ-RATE | 2.5 / 5 | 0.19 / 0.4 / 0.91 / 1.69 / 2.31 / 2.72 | 0.18 / 0.38 / 0.88 / 1.64 / 2.06 / 2.37 | 1.69 / 2.72 |
| KO-PARA-LONG | 0.08 / 0.18 | 0 / 0 / 0 / 0.006 / 0.015 / 0.024 | 0 / 0 / 0 / 0.005 / 0.012 / 0.024 | 0.006 / 0.024 |
| KO-PARA-CHARS | 180 / 260 | 72 / 81 / 100 / 172 / 231 / 278 | 71 / 81 / 96 / 166 / 213 / 278 | 172 / 278 |
| KO-END-02 | 5 / 9 | 1 / 2 / 2 / 4 / 5 / 6 | 1 / 2 / 2 / 3 / 5 / 8 | 4 / 6 |
| KO-OVR-01 | 1.2 / 2.5 | 0 / 0 / 0.26 / 0.91 / 1.47 / 1.87 | 0 / 0 / 0.25 / 0.97 / 1.64 / 2 | 0.91 / 1.87 |
| KO-OVR-02 | 1 / 2 | 0 / 0 / 0 / 0.35 / 0.63 / 0.75 | 0 / 0 / 0 / 0.37 / 0.67 / 0.91 | 0.35 / 0.75 |
| KO-OVR-03 | 0.6 / 1.2 | 0 / 0 / 0 / 0.34 / 0.61 / 0.84 | 0 / 0 / 0 / 0.36 / 0.6 / 0.84 | 0.34 / 0.84 |
| KO-OVR-04 | 0.3 / 0.8 | 0 / 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 / 0 | 0 / 0 |
| KO-COMMA-RATE | 20 / 35 | 1.62 / 2.51 / 5.25 / 9.5 / 12.27 / 13.68 | 1.62 / 2.43 / 4.73 / 9.39 / 12.32 / 13.55 | 9.5 / 13.68 |
| KO-SENT-LONG | 0.15 / 0.3 | 0.003 / 0.011 / 0.035 / 0.075 / 0.107 / 0.123 | 0 / 0.013 / 0.037 / 0.071 / 0.105 / 0.114 | 0.075 / 0.123 |
| KO-DLG-SHARE (low fails) | 0.25 / 0.15 | 0.056 / 0.113 / 0.234 / 0.39 / 0.499 / 0.023 | 0.076 / 0.126 / 0.232 / 0.388 / 0.447 / 0.059 | 0.113 / 0.023 |
| KO-PUNCT-ELL | 6 / 12 | 0.44 / 0.9 / 2.5 / 5.53 / 8.17 / 10.22 | 0.5 / 0.9 / 2.37 / 4.24 / 6.07 / 9.67 | 5.53 / 10.22 |
| KO-PUNCT-DASH | 1.5 / 4 | 0 / 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 / 0 | 0 / 0 |
| KO-IDIOM-01 | 1 / 3 | 0 / 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 / 0 | 0 / 0 |
| KO-ORDER-01 | 0.04 / 0.08 | 0 / 0 / 0.003 / 0.012 / 0.019 / 0.024 | 0 / 0 / 0 / 0.013 / 0.019 / 0.027 | 0.012 / 0.024 |

`KO-DLG-SHARE` in this table is measured the way `KO-TALK-SHARE` counts (straight and curly quotes plus 속마음); in
`lang/ko@7` the first-person band is its own rule (`KO-TALK-SHARE-1P`, warn 0.126, fail 0.059), as is the first-person
pronoun band (`KO-PRN-RATE-1P`, warn 2.57, fail 3.78). Where the operator never uses a device (em dashes,
`KO-OVR-04`, calque idioms: p90 and tail 0), `lang/ko@7` keeps a small floor (dash 0.1 / 0.3 per 1,000자, `KO-OVR-04`
0.1 / 0.3, idioms 1 / 3) so one occurrence warns instead of failing.

**Operator chapters with at least one major lint finding:**

| Layer | Share | Top rules (share of chapters) |
| --- | --- | --- |
| `lang/ko@6` | 75.9 % | `KO-DLG-SHARE` 43.6 %, `SP-02` 36.3 %, `TRN-KO-02` 2.0 %, `KO-IDIOM-01` 1.7 %, `KO-PARA-CHARS` 0.8 % |
| `lang/ko@7` | 11.0 % | `TRN-KO-02` 2.0 %, `KO-END-02` 1.4 %, `KO-TRN-RATE` 0.8 %, `KO-OVR-03` / `KO-ORDER-01` / `KO-SENT-LONG` / `KO-SIM-RATE` / `KO-OVR-02` 0.6 % each |

## 2. Exemplar passages (C5)

`corpus:passages` (tagger `passages@1`) stored 1,850 rows in the permanent database: hook 6 (the openings of 화
1–3 of both books), cliffhanger 640, banter 1,183, status window 21 (book 2's bracket blocks; book 1 has none). A
policy pins one passage per function (`standard@13`: hook, banter, status window, cliffhanger), chapters in the
project's point of view first, in a stable per-project order.

## 3. Likeness (C8)

`corpus:likeness`: the share of 20 style metrics inside the operator's p10–p90 band (all chapters; the
first-person bands after the semicolon). It is reported, never gated.

| Text | Likeness | Outside the band |
| --- | --- | --- |
| Operator's own chapters | p10 65 / p50 85 / p90 95 | — |
| G1 chapter 1 (`standard@11`, Gemini), v1 | 75; 75 | longest paragraph short (77자), 속마음 share high, 번역투 markers below the operator's, conjunctions high, no connective endings |
| G3b chapter 1 (`standard@12`, Gemini), v1 | 50; 40 | paragraphs long (mean 39자, operator 25–34.6), talk share 4.5 % (11.3–39 %), 속마음 share high, no 그/그녀, similes 1.0 per 1,000자, past endings 66 % (30–58 %), fragment endings low, no connective endings |

The operator's voice mixes past, present, noun and fragment endings and dangling connectives; both Gemini
chapters end almost every sentence in the past tense and never on a connective, and both use fewer 번역투
markers than the operator does (the lint's markers are not all defects at the operator's own rate).

## 4. Stock phrases (C7)

Mined twice. The first pass (two first drafts, G1 and G3b) found `비릿한 피`, `훅 끼쳤다`, `끔찍한 고통이` and
`벌떡 몸을 일으켰다` in both drafts and none of the operator's 656 chapters.

The second pass (ADR-0089) read the 32 manuscript and quarantined versions of eight projects in the permanent
database after G6. A phrase becomes a `lang/ko` rule when drafts of **at least three different projects** use it (a
chapter's revision versions repeat one sentence, so versions are not independent), the operator's chapters never do,
and no existing rule already matches it:

| Pattern (`lang/ko@8`) | Distinct draft sentences | Projects | Operator chapters |
|---|---|---|---|
| `고쳐 (잡\|쥐)` | 7 | 5 | 0 |
| `비릿한 (피\|핏)` | 4 | 3 | 0 |
| `훅 (끼쳤\|끼쳐)` | 4 | 3 | 0 |
| `눈을 가늘게 (떴\|뜨\|뜬)` | 4 | 3 | 0 |

Not rules, and why: `끔찍한 고통`, `벌떡 몸을 일으`, `마른침을 삼키` (the operator uses each once); `정적이 내려앉`
(already `AIT-KO-05`); `입꼬리가 비릿하게 …` (already `drafts-lip-curl`); `공기가 싸늘하게 얼어붙`, `서늘한 투지`,
`굉음과 함께`, `알 수 없는 위화감` (one sentence in one project so far — candidates for the next pass).
