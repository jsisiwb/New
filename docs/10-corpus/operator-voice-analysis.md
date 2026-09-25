# The operator's voice — an editor's analysis of the corpus (C0.3)

This is the reading the studio's operator-voice work is built on (C3 voice layer, C4 lint calibration, C5
exemplars, U2 device lexicon, U5 절단 menu, U6 dialogue beats). It describes the operator's own two Korean
webnovels; every quotation is a short excerpt of their text, given as evidence. Numbers come from
`corpus-stats.md` (measured with the lint's own code) unless a section says otherwise; counts of openings,
endings and heroine entries come from reading.

**What was read.** For each Korean book: the prologue/화 1 through 화 25 in full, about ten chapters sampled
across the middle (book 1: 화 84, 99, 121, 149, 168, 199, 237, 244, 249, 289; book 2: 화 36, 54, 68, 77, 100, 123,
160, 200, 233, 254) and the last four chapters of the main story. The third file of the corpus,
『아카데미 사기 룬을 얻었다』, is an English machine translation of the Korean serial, not the operator's Korean
text; it tells us about plot structure at most and is excluded from every voice measurement (ADR-0082).

## 1. The two books at a glance

| | 『아카데미의 사령술사가 되었다.』 (book 1) | 『아카데미 실눈캐가 되었습니다』 (book 2) |
| --- | --- | --- |
| Premise device | game-빙의: a shaman's grandson who sees ghosts wakes as a minor noble of the game 리트라이, now a disgraced necromancy professor | game-빙의: an otaku builds a narrow-eyed "실눈캐" in the game 또 다른 세계 and wakes inside him at the academy exam |
| Narrator | 1인칭, dry and emotionally "worn down" ("감정이 옅게 마모되어 있다 보니"), archaic speech | 1인칭, a meme-literate office worker who thinks in crude 반말 and speaks in flawless politeness |
| POV architecture | 1인칭 hero + 3인칭-limited cutaways after `*` / `* * *` (about one break per 화) | 1인칭 hero chapters alternating with whole 3인칭 chapters through the people who misjudge him (16 of 화 1–25) |
| Engine | horror + comedy + pathos in one 화; Korean 무속 inside a Western academy | 착각 (everyone misreads the smiling man) + 만담 with each heroine |
| Length (화 1–25, with spaces) | median 4,651자 (p10 4,070, p90 5,989) | median 5,039자 (p10 4,509, p90 6,679) |
| Status window | none at all ("상태창" 0 times in 410 files) | sparse: 7 of 화 1–25, bracket blocks with a snarky system voice |

Both are 1인칭 serials whose narration is *not* uniformly first person: the reader is regularly moved into
other characters' heads, and that move is how the books show the hero from outside (the 사이다 reaction shot,
the 착각). The pipeline's `pov: first` setting forces every scene into first person (ADR-0073); the operator
never writes that way.

## 2. Openings

- **화 1 opens on sound or on a term, never on scenery or waking up.** Book 1's prologue opens on
  "뚜벅 뚜벅." alone on its line; 화 1 on "덜컹 덜컹." twice. Book 2's 화 1 opens on a one-word term and a
  dictionary gloss: "실눈캐." / "단순하게는 실눈을 가진 캐릭터들을 일컫는다." The hook is the voice.
- **Typical 화 openings pick up the cut.** Book 1 (화 1–25): 7 direct pickups of the last cliff, 7 opening
  dialogue lines (often a new POV), 3 spirit lines, 3 sound effects, 1 keyword line ("산군."), 3 short scene
  narrations, 1 child narrator. Book 2: 13 of 24 resume at the exact moment of the previous cut (five re-quote
  its last lines), 5 open on a name or topic as its own line ("카샤 하나한."), 3 cut to a new POV.
- **Never a recap.** Neither book opens a 화 by summarizing the previous one; the first line is dialogue in 11
  of book 2's first 25 화.

## 3. How possession and the status window arrive

- **Possession is stated at once and never explained.** Book 1 names the game in the prologue (char 1,184 of
  1,630) and the narrator's real name 147 characters into 화 1; the story starts six months after the
  possession, and the cause is dismissed ("나도 잘 모른다."). Book 2's 화 1 ends on the fact itself:
  "나는 내가 만든 실눈캐에 빙의됐다." — and 화 2 explains, in about ten lines, that the chosen traits "patched"
  his behaviour.
- **The source-work layer is spoken as a game, not a novel.** Both books are game-빙의. Book 2 uses 게임 3.4,
  특성 2.6, 퀘스트 2.1, 빙의 1.3 times per 10,000자 in 화 1–25 and "원작" once in the whole book; book 1 speaks
  of the game's 1회차, 공략글 and "망겜". A rule that makes 원작/원작 주인공/작가 required vocabulary for every 빙의
  story would contradict the operator's own writing (U2 decides by sub-device).
- **Rules are taught through incidents, not lectures.** Book 1 gives the game's rule (the first run always
  ends badly) as one monologue in 화 2 and then only through consequences. Book 2 delivers a quest mid-danger
  (화 3), rewards (화 5), hidden stats (화 8).
- **The status window is a character, when it exists.** Book 2's windows are short bracket blocks —
  `[특성 : 힘을 숨김. 진짜로.]`, `[메인 퀘스트 : …]` + a `-goal` line — with the system's own sarcasm; about one
  화 in four early on. Book 1 has none: brackets carry spirit voices (`[어디 갔어.]`), notes and rule lists.

## 4. Narration, dialogue and the inner voice

- **Dialogue + 속마음 share.** Across all 656 Korean chapters: p10 11.3 %, median 23.4 %, p90 39 %. In the
  first 25 화: p10 13.6 %, median 28.9 %. First-person chapters are *not* dialogue-poor: median 23.2 %
  (p10 12.6 %, p2 7.6 %), and first-person 화 1–25 median 25 % (p10 9.9 %).
- **Beat by beat.** Most dialogue runs are one line followed by a narration beat (book 1: 57–63 % of runs);
  runs of four or more lines are about 5 % in book 1, 18 % in book 2's banter chapters. Quote lines stand alone
  with no tag inside; the neighbouring narration line names the speaker.
- **Silence is a line.** `“…….”` / `“…”` lines: about 3 per 화 in book 2 (6 later), 2–4 in book 1.
- **The inner voice is mostly unmarked.** Book 1 carries thought in free indirect narration — rhetorical
  "-(는)가." / "-겠지.", fragments, "미안하다." as its own sentence — with only 2–4 short ‘ ’ spans per 화 (about
  1 % of characters). Book 2 uses more ‘…’ lines (about 6–7 per 화) and they are blunt 반말 ("‘염병, 나 진짜 길
  잃은 거냐?’") against his polished speech: the gap *is* the comedy. In neither book does the inner voice
  use 존댓말.

## 5. 호칭, 말높이 (dialogue register) and character voices

- **Book 1's hero speaks an archaic 해라체** ("-마", "-구나", "-느냐", "-거라"; "기회를 주마.") with 하십시오체
  only upward or in public; the book comments on it ("200년 전 사람인 나보다 말투가 늙었는지"). Against him:
  핀덴아이's 반말 and "주인놈(아)", 데이아's outrage and swearing, 페르's stutter ("저, 저기!"), 아리아's sweet
  해요체 with menace. Students say "교수님"; servants and ghosts say 주인님/도련님.
- **Book 2's hero is always polite** (합쇼 and 해요 mixed: "-습니다만", "-지요", "-군요", "이야~", "하하") and
  addresses heroines as "드린 경" → later "드린 양"; each heroine has one register and one tic — 드린's
  하십시오체 and "솔직히,", 카샤's haughty 반말 and "흥.", 에이드린's "야. 바보.", 미즈's deadpan "-함/-음"
  fragments ("부끄."), 시니아's bubbly "우리 348번".
- **A 호칭 change is a plot beat.** 경 → 양 (book 2, 화 19–36) and 교수님 → name slips (book 1) mark a
  relationship step and are commented on in the text.

## 6. Sentence and paragraph rhythm

- **One paragraph per line, one sentence per paragraph.** Median paragraph 30자 (p90 of a chapter's
  paragraphs 56자, the longest typically 100자); about 184 paragraphs per 화 (화 1–25: 157). Long paragraphs are
  practically absent (`long_paragraph_ratio` p90 0.6 %). Book 2: 97.7 % of narration paragraphs are one
  sentence; 18 % of lines are ≤ 10 characters.
- **Sentences.** Narration sentence median 27자 (p10 21, p90 34); sentences over 60자 are 3.5 % (p90 7.5 %).
- **Endings mix tenses.** Past -었다 41 % (p10 30 %, p90 58 %), present -ㄴ다 10 % (up to 23 %), noun or fragment
  endings 26 % ("…이빨을 깨무는 에리카.", "잠깐의 고민 끝에 나온 결론."), dangling connectives 6 %
  ("…했으나."). Book 1 leans present and fragment; book 2 leans past.
- **Beat lines.** Sound effects before the action on their own line ("까득.", book 2's "-챙!"), connectives
  as paragraphs ("그런데.", "하지만."), step sequences ("한 걸음. / 두 걸음."), question → clipped answer.
- **Punctuation.** Ellipsis 2.5 per 1,000자 (book 1 "……", book 2 "…" and "..."); **no em dash in either book**
  (`dash_per_1k` 0 at p98); book 2 marks cut-offs with an ASCII hyphen ("무슨 일이십니-"); "~" only in playful
  speech; commas 5.3 per 1,000자.
- **Pronouns and figures.** 그/그녀 2.1 per 1,000자 (p90 3.8) — used freely in 3인칭 narration (book 2 about 3 per
  1,000 narration characters), avoided in 1인칭 narration. Similes are rare: 0.36 per 1,000자 (p90 0.95).
- **번역투 markers** sit at 0.56 per 1,000자 weighted (p90 0.94): "에 대해" and "갖고 있" appear, chains of
  them do not.

## 7. Humour, 만담 and 착각

- **만담 is a straight man against a crude partner.** Book 1: the deadpan, archaic hero against 핀덴아이's
  swearing; punchline endings ("……그건 고용조건에 없었는데요, 주인놈아."). Book 2: the hero is the teaser and
  always polite; his moves are feigned cowardice, adopting her catchphrase, saying her unspoken thought aloud,
  wilful misreading, overdone flattery, and the retreat "하하하! 장난, 장난입니다." The reaction is a one-word
  line (빠직. / 씰룩.), then her 3인칭 fluster or his savouring ("달다.").
- **착각 runs on dramatic irony the reader holds.** The reader knows the hero's power (1인칭 narration and
  status windows); the 3인칭 characters narrate wrong theories at length: geniuses sense the truth and explain
  it away ("기분 탓"), right guess and wrong conclusion ("암살자의 자질" read as talent), crowd contempt
  ("얼빠진"). Book 1 adds institutional 착각 (the academy brands him a devil-worshipper while he holds the
  ghosts back) and hidden-motive 착각 (a betrayal that was protection). Chapters often end on the irony
  itself ("…어떤 표정을 짓고 있는지도 모르고.").
- **Horror is undercut, not abandoned.** A ghost eyeball is eaten ("……맛있네요."), then the 화 turns to grief.

## 8. Heroines and character introductions

- **Each heroine enters through a crisis, often hostile or misjudged, and soon gets her own POV.** Book 1:
  Erika in the prologue as the betrayer, 페르 (화 1) as a victim, 데이아 (화 3) hostile, 핀덴아이 reported in 화
  5, fought in 화 6, captured in 화 10, a maid by 화 11; then one major woman every 20–60 화. Book 2: a new
  heroine every 3–10 화 early on (드린 3/4, 카샤 11/12, 에이드린 14/17–18, 미즈 23/25), each followed within one
  or two 화 by a chapter in her own POV, titled with her name.
- **The introduction formula (book 2):** one to three appearance fragments (hair, eyes, aura), her name as a
  line of its own, family and rank, the hero's game knowledge of her (often a doomed fate), then a quest or a
  flaw he can tease.
- **The hero never pursues.** Heroines confess and initiate; 집착 runs heroine → hero (book 1's 아리아, a
  regressor yandere; 핀덴아이's possessiveness). The hero's replies are minimal ("즐겁군.").

## 9. 사이다, 고구마 and 절단

- **사이다 every one to two 화, through a doubter's eyes.** Competence seen by someone who expected failure
  (a countdown the hero beats with minutes to spare), status reversal, instant comeuppance of a rival who
  called him 3류, curt commands ("꺾어."). Book 2 partly retracts public recognition after a big reveal, to keep
  the 착각 alive.
- **고구마 is short.** Book 1 never keeps the hero in 고구마 for two 화 in a row; book 2 at most two, and the
  suffering is often a heroine's, cushioned by irony.
- **절단 menu, 화 1–25 (reading).** Book 1: decision or declaration 8 (often a quoted "…주마" / "…해라"), threat
  4, comic punchline 4, emotional 3, reveal 2, arrival 2, reversal 1, quiet 1; 11 of 25 end on a quoted line.
  Book 2: about 40 % comic or irony, 40 % hard hook (reveal, reversal, arrival, new threat), 20 % soft
  (emotional, setup); endings are usually a narration line.
- **What the operator never ends on:** a summary, a lesson, a "그렇게 하루가 저물었다" day's end.

## 10. Pacing and titles

- **One core event per 화, one to three segments.** Book 1: median one scene break, a third of the first 25
  화 are single scenes; the 1인칭 A-plot is cross-cut with a 3인칭 academy or heroine B-plot. Book 2 (tagged
  느린전개): one scene and one beat per early 화, no time skips in 화 1–25.
- **First arc shape.** Book 1: first heroine captured by 화 10, first tragedy 화 18, arc climax 화 24–25. Book 2:
  the entrance exam spans 화 4–16, the first 사이다 payoff lands at 화 13 (a hidden first place).
- **Titles.** Short noun phrases (book 1 median five non-space characters: "포식자", "산군", "주인놈"); book 2
  median nine characters, 48 % multi-part "(1)/(2)", playful ("뜨끔", "뜨끔!").

## 11. Recurring strengths and tics

- **Strengths:** tonal range inside one 화; a Korean 무속 layer inside a Western academy (book 1); long-fuse
  callbacks (a five-minute bargain paid off as a 58-minute return); 규칙괴담 set pieces; a hero whose restraint
  is the joke (book 2) or the dignity (book 1).
- **Tics:** book 1 — 이미, 결국, 천천히, 꽤나, 다시금, 실로, 허나, "빌어먹을", -하니 adverbs (멍하니, 덤덤하니);
  book 2 — "…말이다." postposed, 의미심장, 기분 탓, 아니나 다를까, 좌우지간. These are the operator's own
  fingerprints: the studio may recognise them but must not copy the operator's sentences (C0.4).

## 12. What the pipeline's live drafts do differently

Evidence: the live chapter 1 of `standard@11` on the previous model (§8.4 of `12-live-run-ws1-7.md`) and on
Gemini (G1, `13-live-run-gemini.md` §1).

| | Operator | Pipeline chapter 1 |
| --- | --- | --- |
| First line | a sound, a term, a voice ("뚜벅 뚜벅.", "실눈캐.") | a sensory death flashback ("살점이 뜯겨 나가는 감각이 생생했다.") |
| Dialogue + 속마음 | median 25 % in first-person 화 1–25 | 14 % in both live runs; the scene planner planned 10 % for the opening scene |
| Paragraphs | one line each, median 30자 | Gemini: blocks of 14–24 lines between blank lines (read as 436–702자 paragraphs) |
| Inner voice | free indirect narration; ‘…’ short and blunt 반말 | ‘…’ monologue in 존댓말 (three majors in G1) |
| Figures | 0.36 similes per 1,000자 | stock figures ("뱀 같은 눈" twice, "입꼬리가 비릿하게 말려 올라갔다") |
| Device words | game vocabulary for 빙의; none of it in 회귀 | possession terms (원작, 원작 주인공) in a regression serial (§8.4) |
| Ending | decision/declaration, comic punchline, reveal, arrival | a day's-end wrap (§8.4), a reaction beat (G1) |
| POV | 1인칭 hero with 3인칭 chapters or cutaways | every scene forced to first person |
| Pronouns | 그/그녀 2.1 per 1,000자, freely in 3인칭 narration | the writer prompt forbids 그/그녀 outright |
| Status window | none (book 1) or sparse with a snarky system voice (book 2) | used where the plan asks |
| Recaps | never | the chapter planner is told to connect to the previous 화 |

## 13. What this analysis drives

- **C3 voice layer (Korean, measured):** the openings menu of §2, the dialogue band and beat rhythm of §4, the
  line rhythm and punctuation of §6, the 만담 and 착각 moves of §7, the heroine formula of §8, the 절단 menu of
  §9, one core event per 화 (§10).
- **C4 thresholds:** percentiles in `corpus-stats.md`; the dialogue floor for first-person openings from the
  first-person 화 1–25 distribution (A5).
- **C5 exemplars by scene type:** 오프닝 (§2), 대화/만담 (§7), 착각 (§7), 상태창 (§3, book 2 only), 절단 (§9), 전투,
  일상.
- **U2 device lexicon:** 빙의 into a game uses game vocabulary; 빙의 into a novel uses 원작 vocabulary; 회귀 uses
  neither (§3).
- **U5 절단 by design:** the contract's cut beat is drawn from the menu of §9 and never a summary or a day's end.
- **U6 dialogue beats:** the scene plan carries enough dialogue beats to reach the band of §4.
