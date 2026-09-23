# Narrative Identity Architecture

**The manuscript language is per project (English or Korean); Korean webnovel is the narrative
tradition.** (ADR-0026 as amended by ADR-0054)

## 1. Problem statement

The product must write **natural English** that carries the **narrative DNA of Korean serialized web
fiction**. Two opposite failure modes must be prevented simultaneously, and a single instruction does not
survive a multi-call pipeline:

| Drift class | What it looks like in English output | Detected by |
| --- | --- | --- |
| **Western-novel drift** | Slow scene-setting opening; long descriptive paragraphs; literary interiority as essay; chapter ends on reflection without forward pull; epic-fantasy lore exposition; "chapter as unit of a book" rather than "episode as unit of a serial" | Structure Lint + Structure Judge |
| **Literary drift** | Metaphor chains, nested subordinate clauses, elevated diction, omniscient reflective narration, paragraph-long sentences | Prose Lint (rhythm, sentence length) + Prose Judge |
| **Translation-like English** | Calqued idioms ("my heart rose to my throat"), dropped/misused articles, Korean word order ("The measurement device, it cried"), honorific transliterations used as grammar ("Do-yoon-ssi", "Seo-ha-nim said"), literal set phrases ("I will go first" for a farewell), stilted formality mirroring Korean speech levels ("Have you eaten rice?") | Prose Lint (translation markers) + Prose Judge |
| **Format drift** | Screenplay/webtoon script, markdown outlines, headers in prose | Prose Lint (blocking) |
| **Register drift** | Address terms/titles/formality inconsistent with the Dialogue-Register Policy at that story time (a subordinate calling the guild master by first name; lovers still using surname + title after the intimacy milestone) | Register check + Voice Judge |
| **Voice drift** | All characters sound alike; verbal habits vanish | Voice Judge |
| **Genre drift** | Hunter fiction without rank/gate/status devices; romance fantasy without its society register; murim with generic fantasy vocabulary | Genre Judge + terminology registry |
| **Serial drift** | No episode hook, no local payoff, no cliffhanger; chapter ends mid-scene without tension | Structure Lint + Structure Judge |
| **Light-novel drift** | Japanese LN mannerisms (honorific suffixes, 「」 quotes, reaction-ellipsis clusters) unless requested | Prose Lint |
| **Output-language failure** | Non-English prose segments (including Korean prose or Korean-script tokens outside the terminology policy) | Deterministic output-language check (blocking) |

The architectural answer has four parts: **(A)** a structured, versioned **Narrative Identity** composed of
eight separable profiles; **(B)** a compiled **Narrative Identity Block** mandatory on every style-sensitive
call, enforced by a gateway **Narrative Identity Guard** that fails closed without *both* the
Output-Language Contract and the Narrative-Tradition Contract (ADR-0027); **(C)** detection on **separate
dimensions** (English prose quality; Korean-webnovel structural adherence; genre adherence; voice;
continuity) using deterministic lint, register checks, and evidence-bound judges; **(D)** **passage-level
repair** targeted at the failing dimension with regression tests. Narrative structure is also fed into
**planning** (hooks, cadence, dialogue density) so that chapter *shape*, not just wording, follows the
tradition.

## 2. The eight profiles (data)

Schema: `schemas/narrative-identity.schema.json`. Composition order (later layers override scalar
conflicts; the compiler records conflicts in the manifest):

```
NarrativeIdentity(project) = compose(
  output_language:     "lang/en@vX"  (locale en-US | en-GB),      # 1. Output language & locale
  tradition:           "tradition/kr-webnovel@vY",                 # 2. Narrative tradition
  genres:              ["genre/hunter-gate@v", "genre/regression@v"],  # 3. Genre profiles (≤3, one primary)
  setting:             project setting & cultural profile,         # 4. Setting and cultural profile
  naming:              project naming profile,                     # 5. Character naming profile
  register_policy:     project dialogue-register policy,           # 6. Social hierarchy & dialogue register
  terminology:         project terminology & romanization policy,  # 7. Terminology & romanization
  preferences:         user prose preferences                      # 8. User-specific prose preferences
)
```

| # | Profile | Owns | Never contains |
| --- | --- | --- | --- |
| 1 | **Output-Language Profile** | language code (`en`), spelling locale, punctuation conventions (curly quotes, em dash, ellipsis), number/measurement/currency rendering, narration tense default, the **Output-Language Contract** text, translation-like-English marker lists, fluency lint thresholds | any structural/pacing rule |
| 2 | **Narrative-Tradition Profile** (`kr-webnovel`) | hook timing; scene count band; local payoff types; ending types; cadence targets (progression, 사이다 beats, max frustration streak); exposition control; dialogue-forward targets; paragraph rhythm for mobile; serial devices (status windows, system messages, community interludes, hindsight monologue, ranking boards); the **Narrative-Tradition Contract** text; structural lint thresholds; the Structure Judge rubric | any language-specific grammar rule |
| 3 | **Genre Profile(s)** | reader fantasy, devices, English vocabulary register with terminology defaults, cadence overrides, taboos, Genre Judge notes | prose grammar rules |
| 4 | **Setting & Cultural Profile** | setting type (modern Korea / secondary world / murim-style historical / other), institutions, currency & measurements, how much Korean cultural texture is preserved (food, honorific culture as *behavior*, workplace hierarchy) vs localized; cultural-reference policy | naming decisions (profile 5) |
| 5 | **Naming Profile** | name style (Korean-style romanized, Western-style, invented, mixed by faction), romanization system (Revised Romanization default), name order (given–family vs family–given), hyphenation of given names (Do-yoon vs Doyoon), per-entity `display_name` / `native_script_name` / `romanization` registry | dialogue register |
| 6 | **Dialogue-Register Policy** | axes (formality, deference, familiarity, intimacy, directness), rendering rules to English (titles, address terms, contraction usage, sentence directness, hedging, public vs private register), relationship-driven transitions, default registers by relationship class, intentional-shift reasons | Korean speech-level grammar |
| 7 | **Terminology & Romanization Policy** | per-term decision `translate` / `romanize` / `gloss_first_use` / `preserve_script`, fixed English spellings, romanization consistency rules, allowed preserved-script contexts (in-world signage, chapter epigraphs), glossary rendering for export | plot content |
| 8 | **User Prose Preferences** | numeric overrides (sentence length, dialogue ratio, monologue ratio), textual preferences with priority, forbidden expressions, exemplar policy | anything overriding contracts 1–2 (preferences cannot disable the contracts) |

Profiles are **versioned & immutable**; a project binds a composed version; changing any layer creates a
new composed version; every call records the version it used.

## 3. The two contracts (rendered text)

### 3.1 Output-Language Contract (English)
Rendered at the top of every style-sensitive block (≈120 tokens):

> Write the reader-facing manuscript in natural, idiomatic English (spelling: en-US). Compose directly in
> English — do not write in another language and translate, and do not imitate another language's grammar
> or idioms. Use standard English article usage, word order, and dialogue punctuation (“curly quotes”, em
> dashes, …). Render address terms, titles, and formality the way natural English speakers of this setting
> would speak them (see the dialogue register notes) — never as transliterated honorific suffixes attached
> to names. Use only the approved romanized or preserved terms listed in the terminology notes; everything
> else is plain English. Do not produce translation-like English.

### 3.2 Narrative-Tradition Contract (Korean serialized webnovel)
Rendered immediately after (≈160 tokens):

> Follow Korean serialized-webnovel structure and pacing: open on tension or continuation within the first
> few sentences; write dialogue-forward scenes with short reaction beats; keep paragraphs short and
> mobile-readable; deliver at least one local payoff in this episode (satisfaction, revelation, emotional
> step, growth, humor); keep exposition inside action, dialogue, or status text; maintain the progression
> cadence; end with strong forward pull (cliffhanger, reveal, decision, threat, emotional peak, or quiet
> menace). Do not drift into Western epic-fantasy, literary-fiction, or traditionally published novel
> pacing. Preserve the configured genre conventions. Do not imitate named authors or copyrighted works.

Both contracts are **data** in the profiles (versioned text), not prompt literals.

## 4. Narrative Identity Block (compiled prompt artifact)

`compileNarrativeBlock(identityVersion, role, budgetTokens, participants?, exemplarSelection) → { text, hash, manifest }`

- Deterministic (same inputs → same bytes) so it is provider-cache-friendly and hashable.
- Fixed section order: `<<NARRATIVE_IDENTITY v=hash>>` header → **Output-Language Contract** →
  **Narrative-Tradition Contract** → core principles (≤ 5 bullets) → prose rules (English) → dialogue &
  register rules → structure rules (role-dependent) → exposition rules → genre conventions → naming &
  terminology notes (registry slice for participants/locations/terms) → forbidden patterns → exemplars
  (writer/editor only) → user preferences → **participant register digests** (if participants given) →
  `<<END NARRATIVE_IDENTITY>>`.
- Role variants: `writer_full` (~1,000–1,500 tokens), `editor_full` (~800–1,100), `planner_compact`
  (~300–450: contracts + structure + cadence + genre), `judge_rubric_prose` (~400–600: language contract +
  prose rubric; **no** exemplars), `judge_rubric_structure` (~400–600: tradition contract + structure
  rubric), `judge_rubric_genre`, `summarizer_min` (~120: naming/terminology registry + language line).
- Budget fitting sheds sections in reverse priority (exemplars → genre detail → exposition detail); **the two
  contracts, forbidden patterns, naming/terminology notes and participant register digests are never
  shed**; overflow is a compile error, never silent truncation.
- `IDENTITY_TAIL`: for writer/editor roles, a ≤ 70-token recency reminder appended after the task
  instruction: "English, composed directly, natural idiom · hook · short paragraphs · dialogue-forward ·
  local payoff · forward pull · no translation-like phrasing · no Western-novel pacing".
- **Language of the block (ADR-0055).** The block is rendered in the project's manuscript language. A
  Korean project's block is Korean end to end (headers, every section, rubrics, identity tail) and is
  composed from the Korean-authored global layers (`lang/ko@2`, `tradition/kr-webnovel@2`, `genre/*@2`);
  English-manuscript policies (romanization, English address terms, contractions) do not apply to it.
  Context-pack section titles and canon renderings follow the same language.

### 4.4 Korean craft sections: forbidden diction and studio exemplars (ADR-0056)

- A Korean project composes from the newest Korean version of each layer at novel start
  (`lang/ko@3`, `tradition/kr-webnovel@3`, `genre/academy@3`, `genre/regression@3`, the Korean-only
  `genre/harem@2`); the composed document is pinned, so later layers never change a running project.
- **쓰지 않는 문장 (forbidden diction).** The language layer's `translation_markers` (번역투) and
  `forbidden_patterns` of category `stale_cliche`/`translation_like` carry replacement notes. Those notes
  render into `writer_full`, `editor_full` and `judge_rubric_prose` blocks, and the same lists drive the
  deterministic Korean style lint (`04-prose-and-structure-lint-rules.md`), so what the model is told to
  avoid and what the lint measures are one source.
- **문체 견본 (studio exemplars).** Genre and tradition layers may carry up to three `style_exemplars`:
  short original passages authored by the studio (ADR-0025 studio-synthetic provenance) that show
  paragraph length, dialogue/reaction spacing, a one-line 속마음, one-line emphasis paragraphs and the
  절단. The compiler renders at most three (genre layers first, then the tradition's) into writer and editor
  blocks only, framed as rhythm references whose names, events and sentences are never reused; they shed
  first after preferences. Planner and judge blocks never contain them, and the style lint flags any
  verbatim exemplar line in a manuscript.

## 5. Narrative Identity Guard (enforcement, ADR-0027)

Gateway middleware:

```
if role.style_sensitive:
  ref = request.narrative_identity_ref
  if not ref:                                   reject(NARRATIVE_IDENTITY_MISSING)
  if not ref.output_language_contract_hash:     reject(OUTPUT_LANGUAGE_CONTRACT_MISSING)
  if not ref.tradition_contract_hash:           reject(TRADITION_CONTRACT_MISSING)
  if ref.block_hash != compile(ref.identity_version, role, budget, participants).hash:
                                                reject(NARRATIVE_IDENTITY_STALE)
  if "<<NARRATIVE_IDENTITY v="+ref.block_hash not in prompt: reject(NARRATIVE_IDENTITY_NOT_EMBEDDED)
  if ref.output_language != "en":               reject(OUTPUT_LANGUAGE_UNSUPPORTED)   # MVP/Beta/Prod
record(call.narrative_identity_version, call.block_hash, call.output_language_profile_version,
       call.tradition_profile_version)
```

Style-sensitive roles (must carry a block): scene planner, chapter planner (compact), arc planner (compact),
scene writer, chapter assembler, line editor, prose reviser, dialogue reviser, continuity reviser (rewrites
prose), scene rewriter, retcon patcher, prose judge, structure judge, genre judge, voice judge, pacing/hook
judge, chapter summary writer (min variant), title generator, candidate comparator for prose.
Non-style-sensitive: requirement interpreter, extraction roles, adjudicator, evidence verifier,
classification roles, cost estimator.

**Post-call output-language check** (manuscript-producing roles only): deterministic language
identification over prose segments (excluding approved preserved-script terms and romanized registry
entries) must return English with confidence ≥ 0.99; failure is blocking and the output is discarded and
regenerated once with the violation named (FR-4.10). This closes NO-TRANSLATION-001 at the output side.

## 6. Detection: separate dimensions (EVAL-SEPARATION-001)

| Dimension | Deterministic | Model-based | Score |
| --- | --- | --- | --- |
| **A. English prose quality** | English Prose Lint (`04-…` §2): fluency signals, repetitive sentence openings, sentence-length rhythm, paragraph length, dialogue-tag overuse, adverb tags, filter words, translation-like syntax markers, locale spelling consistency, unapproved untranslated terms, romanization consistency, LN/format markers; optional grammar service (ADR-0028) | **Prose Judge** (`judge_rubric_prose`): fluency & idiom, clarity, translation-like syntax absence, literary/Western-diction drift, mobile readability — evidence paragraph IDs before scores | `prose_score` 0–100 |
| **B. Korean-webnovel structural adherence** | Structure Lint (`04-…` §3): hook position, scene count, payoff markers, ending type classifier, exposition runs, dialogue ratio band, monologue band, cadence over last N chapters, status-window grammar | **Structure Judge** (`judge_rubric_structure`): hook strength, episode payoff, pacing & scene rhythm, exposition control, dialogue-forwardness, ending pull, serial devices — with drift flags `western_novel`, `literary`, `serial` | `structure_score` 0–100 |
| **C. Genre-profile adherence** | terminology registry compliance, device presence markers | **Genre Judge**: reader fantasy delivered, devices used correctly, vocabulary register, taboo overuse | `genre_score` |
| **D. Character voice & register** | Register check (`04-…` §4): expected vs rendered formality/address terms/contractions per utterance | **Voice Judge**: distinguishability, verbal habits, register naturalness in English | `voice_score` |
| **E. Continuity & canon** | glossary/registry, numeric consistency, required-scene markers | continuity, knowledge-leak, promise, contract-compliance evaluators (unchanged) | continuity sections |

Judges never see exemplars; Prose and Structure judges are separate calls with separate rubrics (a chapter
may be fluent English with Western pacing, or perfectly serialized but translation-like — the scorecard must
show which). Gate thresholds per tier are configuration (ADR-0029), with starting values in
`05-drift-detection-and-repair.md` §2.

## 7. Repair: dimension-targeted, passage-level

Issues are clustered by span **and by dimension**. Prose issues go to `prose_reviser` (language contract,
prose rubric, span ± 1 paragraph, must-preserve facts); structure issues go to `structure_reviser` (scene
plan, tradition contract, the scene or the opening/ending paragraphs); register/voice issues go to
`dialogue_reviser` (register digest of the speaker pair at story time); continuity issues go to
`continuity_reviser`. Regression re-runs only the affected dimension's checks plus continuity when
`changed_claims` is non-empty. Escalation ladder and limits are in `05-…` §3–5.

## 8. Narrative structure in planning

The `planner_compact` block feeds arc planning (payoff cadence, progression cadence), chapter contract
writing (hook type from the tradition's allowed set, local payoff type, ending type, dialogue density
target, scene count band, language-aware length target), and scene planning (beat tags, opening/ending beat
types, speaker pairs with pre-resolved English register). Contract shape fields are validated
deterministically against the tradition profile before drafting.

## 9. Learning without imitation (ADR-0025)

Project exemplar bank of accepted English passages (score ≥ threshold, unpatched) tagged by function;
user-owned/licensed exemplars with provenance; studio-authored synthetic exemplars for the tradition and
genre profiles reviewed by bilingual editors; reviewer edits feed threshold and preference proposals.
Forbidden: scraping commercial works (Korean or English), "in the style of <author>" instructions,
commercial text as exemplars.

## 10. Metrics that prove it works

- `prose.score` and `structure.score` distributions per project (targets: medians ≥ 80 each after
  calibration; **both** must pass — an average is never used for gating).
- `prose.translation_marker_rate` (per 1,000 words; starting warn 1.5 / fail 3.0, calibrated).
- `structure.hook_sentence_index` p90 ≤ 5; `structure.local_payoff_present` ≥ 98% of accepted chapters.
- `register.violation_rate` (per 100 utterances; starting target ≤ 1).
- `output_language.failures` (must trend to zero; any occurrence is investigated).
- Bilingual reviewer panel: monthly blind ratings on two scales — "natural English" and "reads as a Korean
  webnovel of this genre" — with target Spearman ≥ 0.8 against the respective judge.
