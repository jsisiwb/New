# Fixture Story — *Second Awakening*

An original fixture designed to exercise every subsystem: regression (prior-loop knowledge), hidden
identity, lies and false beliefs, injuries with lasting effects, inventory hand-offs, rank progression,
**dialogue-register changes tied to relationship milestones**, a flashback, a dream, a retcon, delayed
payoffs, divergence from the "known future", and deliberate continuity traps — plus **narrative-identity
traps**: translation-like English, Western-novel pacing, over-literary prose and weak serialized
construction. The fixture manuscript is **English, composed directly in English** (the fixture lineage stays `en`;
new projects may compose in `ko` per ADR-0054), in Korean serialized-webnovel form (OUTPUT-LANG-001,
STYLE-KWN-001). Machine-readable parts live in `examples/fixture/`; the accepted text of ch.9 and its rejected draft live in
`examples/fixture/manuscripts/` so evidence offsets are real and validator-checked. All names, events and
prose are original to this repository.

## 1. Premise and spec (abridged)

- **Narrative identity:** `lang/en` (`en-US`) + `tradition/kr-webnovel` + genres `hunter-gate` (primary) +
  `regression`; setting `modern_korea` (Seoul, romanized place names); naming `korean_romanized` (Revised
  Romanization, family–given order, hyphenated given names: *Kang Do-yoon*); terminology default
  `translate` (hunter, gate, awakened, mana stone, the Association) with *sunbae* → translate as
  "Senior" + surname; light romance line (no overlay; soft preference). Rating 15+. Target 180 chapters ×
  2,500 words. Ending: happy (collapse prevented; protagonist recognized but chooses a quiet life with the
  people he saved).
- **Premise (user, hard):** F-rank porter Kang Do-yoon dies in the Seoul Collapse ten years from now and
  wakes on the morning of his awakening measurement at twenty-seven. He knows the Collapse's mastermind,
  "the Watcher", is Hunter Association Chairman Yoon Jae-kyung — and he cannot prove it. He builds power
  quietly to stop the Collapse, but the future starts to slip every time he intervenes.
- **Hard requirements:** Do-yoon tells no one about the regression before ch.58 · Park Mu-jin does not die
  in Season 1 · the Watcher's identity is not revealed before ch.120 · romance is slow-burn (no confession
  or physical intimacy before ch.87) · violence within a 15+ rating.
- **Soft:** satisfaction-forward pacing, occasional forum interludes, light comedy centered on Yu-ri.
- **Assumptions (model-inferred, confirmed in fixture):** rank scale F–S; no status windows (measurement
  device readings only); Seoul setting; mana-stone economy.

## 2. Cast and dialogue-register profiles

| Character | Role | Default register (English rendering) | Toward key counterparts | Voice notes |
| --- | --- | --- | --- | --- |
| **Kang Do-yoon** (27, F→S) | protagonist, regressor | measured, polite-neutral; blunt with juniors; fully formal with chairmen | → Mu-jin: "Mister Park" / "old man" (ch.1–13) → "Senior Park" (ch.14–) · → Seo-ha: "Miss Lee" + no contractions (→ "Seo-ha", contractions free, from ch.87) · → Yu-ri: "kid"/"Yu-ri", casual · → Hyun-seok: "Vice-Guildmaster Choi", cold and formal | short sentences; hindsight monologue in italics (*Last time…*) ≤ 20%; never explains the regression aloud before ch.58 |
| **Lee Seo-ha** (24, B→A healer) | deuteragonist; secret P2 owner | polite, precise, clinical vocabulary; avoids family talk | → Do-yoon: "Mr. Kang" (→ "Do-yoon" from ch.87; "Hunter Kang" in public) · → Mu-jin: "Senior Park" · → Hyun-seok: "Vice-Guildmaster" | measured, clinical; when angry her formality *increases* |
| **Park Mu-jin** (45, C-rank veteran) | mentor | gruff, informal downward; proverbs | → Do-yoon: "kid" / "Do-yoon" (and "son" when serious) · → Seo-ha: "Miss Lee" | walks with a limp (left leg) after ch.9/14 |
| **Choi Hyun-seok** (31, A-rank, Vice-Guildmaster of White Night) | antagonist; knows P2 from ch.17; liar (P3) | smooth, condescending informal toward Do-yoon (ch.1–59) → forced public formality from ch.60 (`public_formality`); polished with Seo-ha | → Do-yoon: "Kang" / "F-rank" → "Hunter Kang" (ch.60+) | never raises his voice |
| **Han Yu-ri** (19, D-rank rookie) | comic relief; misunderstanding engine | polite-eager to seniors with excited slips into casual (`emotional_outburst`); casual with peers | → Do-yoon: "Do-yoon-oppa" is **forbidden** (honorific morpheme) → renders as "Do-yoon!" / "boss" · → Seo-ha: "Seo-ha" with deference ("Seo-ha, ma'am" when teasing) · → Mu-jin: **must stay deferential** ("Mister Park", "sir") — trap T9 | onomatopoeia-heavy; believes Do-yoon and Seo-ha are siblings ch.12–44 |
| **Lee Tae-san** (63, Chairman of Baekyeon Group) | Seo-ha's father | formal in public; curt imperative in private toward Hyun-seok | — | appears ch.17, 45, 72 |
| **Yoon Jae-kyung** (58, Association Chairman = the Watcher) | hidden antagonist (P4) | public warmth, formal | — | never on-page as the Watcher before ch.120 |
| Jung Min-jae (measurement officer) | minor | neutral-polite | — | ch.1, 8, 20, 35, 58 |

The abstract register axes for each pair (formality/deference/familiarity/intimacy/directness, address
terms, titles, contractions, public variant) live in `examples/fixture/register-profile.seoha.json` and the
relationship ledger; the English renderings above are what the writer produces from them.

## 3. Propositions and knowledge (core)

| ID | Statement (truth per timeline) | Secret owner | Knowledge timeline |
| --- | --- | --- | --- |
| **P1** | Kang Do-yoon is a regressor (true on `main`) | Do-yoon | Do-yoon knows (prior_loop_memory) from ch.1; Seo-ha unaware → suspects ch.31 (he predicts a gate pattern) → knows ch.58 (told); Mu-jin suspects ch.52 → knows ch.66; Yu-ri unaware through S1; Hyun-seok unaware (S1); reader knows ch.1 |
| **P2** | Lee Seo-ha is Chairman Lee Tae-san's illegitimate daughter (true) | Seo-ha | Seo-ha knows; Tae-san knows; Hyun-seok knows ch.17 (told by Tae-san); reader knows ch.17; Do-yoon unaware → knows ch.72 (told by Seo-ha); Yu-ri unaware |
| **P3** | Kang Do-yoon sells raid intel to brokers (false; lie by Hyun-seok) | — | Hyun-seok knows it is false (liar) ch.23; Seo-ha believes_false ch.23 → doubts ch.40 (sees him refuse a broker) → knows it is false ch.58; Yu-ri unaware; reader knows it is false (Hyun-seok POV ch.23) |
| **P4** | Chairman Yoon Jae-kyung is the Watcher (true) | Yoon | Do-yoon knows (prior_loop_memory; cannot prove); everyone else unaware until ch.120; reader knows ch.5 (flashback) |
| **P5** | The Gangnam gate break happens on March 14 with 200 casualties (**true on `prior_loop_1`, false on `main`**) | — | Do-yoon knows (prior_loop); main-timeline event: March 12, 12 casualties (ch.19) → Do-yoon `doubts` applicability; `diverged=true` |
| **P6** | Kang Do-yoon and Lee Seo-ha are siblings (false; Yu-ri's misunderstanding) | — | Yu-ri believes_false ch.12 → knows it is false ch.44; Do-yoon/Seo-ha unaware of her belief until ch.30 (comic beat) |
| **P7** | The old compass points to hidden gates (true) | — | nobody knows until ch.61 (Do-yoon learns by witnessing); reader suspects from ch.3 hints |
| **P8** | Lee Seo-ha died in the Collapse (true on `prior_loop_1`; unknown on `main`) | — | Do-yoon knows (prior_loop); dream ch.27 replays it (frame `dream`) — must not become a main-timeline fact (trap T7) |

## 4. State facts with validity (selection)

| Entity | Attribute | Value | valid_from | valid_to | Evidence chapter |
| --- | --- | --- | --- | --- | --- |
| Do-yoon | power.rank | F | ch.1 | ch.8 | ch.1 measurement |
| Do-yoon | power.rank | E | ch.8 | ch.20 | ch.8 re-measurement |
| Do-yoon | power.rank | D | ch.20 | ch.35 | ch.20 |
| Do-yoon | power.rank | C | ch.35 | ch.58 | ch.35 |
| Do-yoon | power.rank | B | ch.58 | (planned A ch.95) | ch.58 |
| Do-yoon | inventory.item | old compass ×1 | ch.3 | ch.30 (given to Seo-ha) | ch.3, ch.30 |
| Seo-ha | inventory.item | old compass ×1 | ch.30 | ch.61 (returned) | ch.30 |
| Do-yoon | resource.money | 120 million won | ch.15 | ch.16 | ch.15 mana-stone sale |
| Do-yoon | resource.money | 20 million won | ch.16 | … | ch.16 (dagger: 100 million) |
| Do-yoon | inventory.item | reinforced dagger | ch.16 | ch.35 (broken) | |
| Do-yoon | inventory.item | black-iron longsword | ch.36 | … | |
| Do-yoon | status.injury | right shoulder puncture | ch.20 | ch.21 (healed by Seo-ha) | |
| Do-yoon | status.injury | fractured ribs (3-week recovery) | ch.35 | ch.38 (advanced heal) | trap T1 at ch.36 |
| Mu-jin | status.injury | left leg, beast venom | ch.9 | ch.14 (venom cleared) | **retcon R1**: originally written as right leg |
| Mu-jin | status.condition | left-leg scarring, permanent limp | ch.14 | null | trap T6 at ch.22 |
| Seo-ha | power.rank | B | ch.1 | ch.50 | |
| Seo-ha | power.rank | A | ch.50 | null | |
| Do-yoon↔Seo-ha | relationship.register | formality 3, "Mr. Kang"/"Miss Lee", contractions avoided | ch.10 | ch.87 | trap T13 at ch.42 |
| Do-yoon↔Seo-ha | relationship.register | formality 1, first names, contractions free; public variant "Hunter Kang"/"Healer Lee" | ch.87 | null | milestone |
| Do-yoon→Mu-jin | address_terms | "Mister Park", "old man" | ch.1 | ch.14 | |
| Do-yoon→Mu-jin | address_terms | "Senior Park" | ch.14 | null | |
| Hyun-seok→Do-yoon | register | condescending informal ("Kang", "F-rank") | ch.1 | ch.60 | |
| Hyun-seok→Do-yoon | register | forced public formality ("Hunter Kang", no contractions) | ch.60 | null | `public_formality` |

## 5. Timeline & frames

- Main timeline `main`, prior loop `prior_loop_1` (divergence: ch.1 measurement morning).
- ch.5: **flashback** to the prior loop (frame `prior_loop` + `flashback`): Mu-jin dies shielding Do-yoon;
  Hyun-seok abandons the team; Do-yoon sees Yoon Jae-kyung at the epicenter. Facts land on `prior_loop_1`;
  knowledge for Do-yoon.
- ch.18–19: **divergence**: Do-yoon anonymously tips the Association → the break comes early (March 12)
  with 12 casualties. `P5.truth[main]=false`.
- ch.27: **dream** (frame `dream`): Seo-ha dies as in the prior loop. Knowledge for Do-yoon only (as dream).
- ch.23: **lie** (frame `lie`): Hyun-seok to Seo-ha about P3.
- ch.61: compass payoff (promise opened ch.3, importance core, due window ch.55–70).
- ch.11: Mu-jin mentions a daughter he has not seen in years (promise `character_goal`, due ≤ ch.100;
  planned payoff ch.98).

## 6. Continuity and narrative-identity traps (seeded into test drafts; expected detections)

| ID | Chapter | Trap | Expected detection (dimension/kind, severity) | Expected repair scope |
| --- | --- | --- | --- | --- |
| T1 | 36 | Do-yoon fights at full power the day after the rib fracture (ch.35) | continuity/injury_forgotten, major | scene |
| T2 | 40 | Do-yoon called "D-rank" (C since ch.35) | continuity/rank_incorrect, major (registry/rank check first) | sentence |
| T3 | 47 | Do-yoon uses the compass (held by Seo-ha since ch.30) | continuity/inventory_impossible, major | paragraph |
| T4 | 29 | Seo-ha fully trusts Do-yoon while `believes_false(P3)` | knowledge/relationship_inconsistency, major | dialogue/scene |
| T5 | 31 | Seo-ha: "I know you're a regressor." (only `suspects`) | knowledge/knowledge_leak, blocking (secret P1) | dialogue |
| T6 | 22 | Mu-jin runs upstairs without a limp | continuity/injury_forgotten (permanent condition), major | sentence |
| T7 | 28 | Narration treats the dream (ch.27) death as real | continuity/frame_error, blocking | paragraph |
| T8 | 20 | Do-yoon recalls "200 casualties last month" (prior-loop value) as a main event | continuity/timeline_error (divergence), major | sentence |
| T9 | 13 | Yu-ri addresses Mu-jin as "old man, gimme that" (casual, no shift tag) | voice/register_error RG-01, major | dialogue |
| T10 | 16 | Dagger costs 200 million while Do-yoon has 120 million | continuity/resource_impossible, major | sentence |
| T11 | 45 | Yu-ri references P2 | knowledge/knowledge_leak, blocking | dialogue |
| T12 | 50 | Paragraph duplicated from the ch.35 boss entrance | repetition/repeated_paragraph EP-REP-02, major | paragraph |
| T13 | 42 | Do-yoon and Seo-ha use first names and easy contractions before ch.87 | voice/register_error RG-03 + hard requirement (slow-burn), major | dialogue |
| T14 | 61 | Compass payoff after ch.3 was regenerated without the compass | promise/payoff_without_setup, major | plan |
| T15 | 19 | Break dated March 14 with 200 casualties | continuity/timeline_error vs contract must_happen (12 casualties), blocking | paragraph |
| T16 | 9 (rejected draft) | "Do-yoon's left arm was severed." | must never appear in canon/summaries/packs/exemplars | isolation test |
| T17 | 55 | Screenplay format (`INT. GATE — NIGHT`) | prose/format_drift EP-FMT-01, blocking | chapter regenerate |
| T18 | 33 | **Translation-like English** ≥ 30% of paragraphs ("Do-yoon-ssi, did you eat rice?", "The device, it cried", article omission) | prose/translation_like_english, major → scene repair (prose mode); post-repair prose metrics improve, structure unchanged | scene |
| T19 | 18 | Measurement reading lower than ch.17 without explanation | continuity/numeric_inconsistency, major | sentence |
| T20 | 58 (extraction) | Extractor A: Seo-ha `knows` P1; B: `suspects` | reconciliation conflict → adjudicator picks `knows` with quote "So you really did come back." | — |
| T21 | 60 | Hyun-seok keeps the condescending informal register in public after the ch.60 milestone | voice/register_error (expected public formality), major | dialogue |
| T22 | 44 | Yu-ri's misunderstanding resolved but extraction omits the knowledge change | extraction recall test (B must catch; reconcile single-source ≥ 0.8) | — |
| **T23** | 24 | **Western-novel pacing**: 600-word weather/landscape opening, first tension beat at sentence 19, reflective fade-out ending; fluent English | structure/western_novel_drift + ST-HOOK-01 + ST-END-01, major → structure scene repair; **prose passes** (EVAL-SEPARATION-001) | scene |
| **T24** | 37 | **Over-literary drift**: 60-word sentences, metaphor chains, essayistic interiority | prose/literary_drift + EP-LEN-01/03, major; structure partially affected | paragraph/scene |
| **T25** | 41 | **Weak serialized construction**: no local payoff, mid-scene fade ending, hook at sentence 12 | structure/serial_drift + ST-PAY-01 + ST-END-01, major | opening/ending patch |
| **T26** | 26 | Korean-script token in prose ("그는 웃었다.") | output_language/non_english_output EP-LANG-01 / EP-TERM-03, blocking; regenerate | segment |
| **T27** | 30 | Unregistered romanized term ("He absorbed the *maseok*.") while policy says translate → "mana stone" | prose/unapproved_untranslated_term EP-TERM-01, major | token |
| **T28** | 48 | Honorific suffix as morpheme ("Seo-ha-nim smiled.") | prose/translation_like_english EP-HON-01, major | token |
| **T29** | 52 | Spelling-locale mix ("colour" in an `en-US` project) | prose/spelling_locale_inconsistency EP-LOC-01, minor | token |

### Change-class cases (ADR-0038): transition, retcon, correction, rollback, retraction
- **TR1 (transition):** ch.14 is accepted with "venom cleared". Expected: the ch.9 fact
  `Mu-jin.status.injury[left_leg_venom]` gets `valid_to = ch.14` and `superseded_by → status.condition
  (left-leg scarring, permanent limp)`; it is **not** retracted — "state of Mu-jin as of ch.11" still returns
  the venom; "as of ch.15" returns the limp; "as of canon version at ch.8" returns neither.
- **R1 (retcon):** after ch.30 is accepted, the user retcons ch.9: injured leg right → left. Expected: new
  version; fact `Mu-jin.status.injury` re-extracted with new evidence; **material** dependents stale:
  ch.14, 22 (limp descriptions), contracts 31–36 referencing the injury; chapters that merely retrieved the
  fact into T2 without relying on it are "review suggested", not stale (ADR-0032). MVP lists them; Beta
  proposes patches.
- **C1 (correction):** user corrects Yu-ri's age 19 → 20 via the canon inspector; impact report lists ch.12
  (intro) and the register profile note; commit `source=user_correction` with justification.
- **RB1 (rollback):** rollback of ch.44's commit reopens `Yu-ri believes_false(P6)` (its `valid_to` is
  restored to null from the commit's `inverse`), retracts the rows ch.44 inserted, bumps the canon version once
  (`source=rollback`); ch.44 and its version return to `approved`; contracts 45–50 stale.
- **SR1 (system-time retraction):** two extracted entities "the clerk" and "Association clerk Han" are
  merged; the duplicate's rows get `retracted_at_version` in a `merge_entities` commit; no story-time
  validity changes and no chapter becomes stale unless a material edge pointed at the retired entity.

## 7. Prose samples (original; for exemplars and contrast sets)

### 7.1 Target — natural English, Korean-webnovel form (ch.1 opening excerpt)
```
The measurement device screamed.

[F]

Red letters. The same red letters as ten years ago.

“F-rank. Porter registration is the window on your left.”

The officer was already calling the next name. Do-yoon looked down at his palm. It wasn’t shaking. There
was no reason for it to shake. In this whole room, he was the only one who knew how far this hand could go.

*March twelfth.*

Gangnam. Three things to finish before then.
```

### 7.2 Contrast — natural English, Western novel structure (same content; must fail structure, pass prose)
```
The Hunter Association’s measurement hall occupied the third floor of a glass tower in Mapo, and on
weekday mornings the light came through the east windows in long pale bars that lay across the linoleum
like the rungs of a ladder no one had climbed. Kang Do-yoon had arrived early. He had always been the sort
of man who arrived early, a habit inherited from a father who distrusted buses, and he stood now near the
back of the line with his hands in the pockets of a jacket that had seen better winters, watching the
other candidates shift their weight and check their phones. He thought about the city outside, about how
little any of them understood of what was coming, and he found, to his mild surprise, that he was not
afraid. When at last his turn came and the device pronounced its verdict, he accepted the small red letter
with something like tenderness, the way one accepts an old friend’s familiar flaw.
```

### 7.3 Contrast — translation-like English (must fail prose; structure intact)
```
Measurement device cried.

[F]

Red letter appeared. It was exactly same letter with ten years ago.

“You are F-rank. Porter registration window is located at left side.” The officer said quietly.

Do-yoon looked down his palm. It was not shaking. There was no reason to shake. Because he was the only
person in this room who knows how far this hand can go.

*March 12.*

Gangnam. Before that, there were three things that must be finished by him.
```
Expected lint: TRN-01 (articles) ×4, TRN-02, TRN-14, EP-DLG-02, EP-OPEN-02. Prose Judge gap ≥ 40 points; Structure Judge gap ≤ 10.

### 7.4 Register sample — Yu-ri → Mu-jin (correct) vs trap T9
```
(correct) “Mister Park, can I carry this one? Whoa—it’s heavy!”
(trap)    “Old man, gimme that. Whoa, heavy.”     ← RG-01/RG-02 (casual toward a senior, no shift tag)
```

### 7.5 Milestone sample — Do-yoon → Seo-ha (ch.86 vs ch.88)
```
ch.86  “Miss Lee, please don’t push yourself.”
ch.88  “Seo-ha. Don’t push it.”
```
The register check must accept both given `relationship.register` validity (ch.87 boundary); in a public
scene after ch.87, "Healer Lee" is expected (public variant).

## 8. Chapter map (season 1, abridged)

| Arc | Chapters | Objective | Key commits |
| --- | --- | --- | --- |
| 1 The F-rank in the Measurement Hall | 1–8 | hide, re-enter as porter, meet Mu-jin, compass, flashback, hidden feat, E-rank | P1 knowledge; compass promise; prior_loop facts (ch.5) |
| 2 Poison Fog Dungeon | 9–20 | Mu-jin poisoned/healed; Seo-ha & Yu-ri join; P6 misunderstanding; mana stones → dagger; Hyun-seok learns P2; Gangnam divergence; D-rank | injuries, inventory, money, P2 knowledge (Hyun-seok/reader), divergence event |
| 3 White Night Guild | 21–35 | shoulder wound/heal; Hyun-seok's lie; dream; compass to Seo-ha; boss fight (ribs, dagger broken, C-rank) | lie/believes_false; dream frame; inventory transfer; injuries; rank |
| 4 Fracture | 36–48 | longsword; recovery; Seo-ha's doubt; P6 resolved; Hyun-seok leverages P2 | doubts; knows-false(P6) |
| 5 The Price of Truth | 49–60 | Seo-ha A-rank; truth exposed (P3 false; P1 told to Seo-ha); Do-yoon B-rank; Hyun-seok's public formality | knows(P1) Seo-ha; knows-false(P3); rank; register milestone |
| S2 opener | 61 | compass payoff | promise paid |

Detailed contract example: `examples/fixture/chapter-contract.ch12.json`. Canon delta example (ch.9):
`examples/fixture/canon-delta.ch09.json`. Knowledge ledger excerpt: `examples/fixture/knowledge-ledger.json`.
Contrast sets: `examples/fixture/contrast-sets.seed.json`.
