# Genre Catalog and Overlays

Each overlay records **abstract conventions** of a Korean webnovel genre — reader fantasy, structural
devices, English vocabulary register, terminology defaults, cadence, typical hooks/endings, register
norms, taboos — never the plot, characters, or phrasing of any specific work. All manuscripts are English;
Korean terms below are the *source concepts*, each with its default English rendering under the
terminology policy. Overlays are data conforming to `schemas/narrative-identity.schema.json`
(`kind: "genre"`).

Legend for cadence: **P** = progression event every N chapters; **S** = satisfaction (사이다) beat every N
chapters; **H** = dominant hook/ending types.

## MVP overlays (4)

### 1. `genre/hunter-gate` — Hunter / Gate fiction (헌터·게이트)
- **Reader fantasy:** rising from the bottom of a ranked society; hidden power revealed; being needed.
- **Vocabulary (English):** gate, dungeon, awakening / awakened, hunter, rank (F–S / SS), monster / beast,
  mana stone, guild, the Association, raid, gate break, porter, measurement device. Terminology defaults:
  `translate` for all of the above; `romanize` none by default.
- **Devices:** rank-reveal scene (device reading → bystander reactions → protagonist's indifference/shock,
  reactions differentiated by character); guild/Association politics; measurement scenes (numbers become
  facts); mana-stone economy; forum/community interludes formatted as quoted threads (≤ 8 lines, casual
  register, no real-platform names).
- **Register notes:** guild hierarchy (Guildmaster, Vice-Guildmaster, team leader); junior hunters address
  veterans with "Senior" + surname or "sir"; porters are addressed curtly by rank in hostile contexts
  ("F-rank").
- **Cadence:** P=3, S=3. **H:** in_medias_res, status_update, arrival_of_threat.
- **Taboos to ration:** "the device must be broken" cliché more than once; identical rank-shock reactions;
  awakening straight to S-rank.
- **Judge notes:** action clarity (who/where/what strikes in one sentence); pace over description.

### 2. `genre/regression` — Regression (회귀)
- **Reader fantasy:** foreknowledge used decisively; regret repaired; enemies pre-empted.
- **Devices:** hindsight monologue in italics (*Last time, I died right here.*), "before"/"this time"
  signposting; countdown to known events; divergence tracking — **knowledge architecture matters most**:
  prior-loop facts are frame `prior_loop`, known only by the regressor; every deviation from the known
  future is a canonical event on `main`.
- **Vocabulary:** regression / regressor ("I went back"), the loop, the first life — `translate`.
- **Cadence:** P=3, S=2 (early satisfaction-heavy). **H:** continue_cliffhanger, in_medias_res.
- **Taboos:** monologue dumps of the whole previous life; "I remember everything" every chapter.
- **Judge notes:** hindsight monologue ≤ 20% of a chapter; every foreknowledge claim must exist in
  `prior_loop` canon.

### 3. `genre/academy` — Academy (아카데미)
- **Reader fantasy:** hidden talent among elites; rivalry → respect; exam/tournament set pieces.
- **Vocabulary:** enrollment, year (first-year/second-year), practical/theory exams, professor/instructor,
  dormitory, student council, sparring/duel, leaderboard — `translate`; *sunbae/hoobae* → default
  `translate` ("upperclassman"/"senior", "underclassman") with `romanize` selectable per project.
- **Register notes:** strict seniority — first-years use titles/surnames with upperclassmen; professors
  addressed as "Professor" + surname; peers in the same year use given names.
- **Devices:** leaderboards formatted like status blocks; exam arcs (3–6 chapters); ensemble casts
  (participant sets of 8–10 → T1 degradation ladder).
- **Cadence:** P=3, S=3. **H:** status_update, sharp_dialogue.

### 4. `genre/romance-fantasy` — Romance fantasy (로판)
- **Reader fantasy:** being chosen/seen; agency inside a rigid society; slow-burn tension and payoff.
- **Vocabulary:** imperial court, duchy/duke, marquis, young lady / Lady + name, young master, Your Grace,
  Your Majesty, Your Highness, high society, debut, the Tower (mages), the Temple — `translate` into
  Western-style titles (this genre conventionally uses Western-style names and titles; Naming Profile
  default `western`).
- **Register notes:** formal society register with strict titles in public; intimacy milestones move pairs
  to first names in private (tracked as relationship facts with validity!); anger renders as icy
  formality rather than bluntness.
- **Devices:** ball/tea scenes; letter exchanges (formatted); misunderstanding beats with dual-POV
  knowledge (reader knows / heroine does not — knowledge ledger); heavier inner monologue (band 0.15–0.35).
- **Cadence:** relationship milestone every 4; S=4. **H:** emotional_peak, reveal, sharp_dialogue.
- **Judge notes:** interiority natural, not essayistic; avoid Regency-romance pastiche ("the ton") — this is
  a Korean 로판 society rendered in English, not a Western historical romance; avoid Western-novel pacing
  even when the setting is Western-styled.

## Beta overlays (6)

### 5. `genre/system-progression` — System / progression (시스템·성장)
- Reader fantasy: legible growth, clever rule mastery, numbers going up. Devices: status window blocks
  with fixed English grammar (`[Status Window]`, `[Quest updated.]`), system messages in brackets, present
  tense inside system text; any number in a status block is a fact with validity. Cadence P=2, S=3. Taboo:
  status-window walls (> 12 lines) more than once per chapter.

### 6. `genre/modern-fantasy` — Modern fantasy (현판)
- Reader fantasy: competence rewarded in contemporary society; social mobility. Vocabulary: contemporary
  Korean institutions rendered in English (conglomerate, chairman, team leader, department head); currency
  in won; media/forum interludes. Register notes: workplace hierarchy shown through titles ("Team Leader
  Kim") and deference behavior, not through invented English honorific grammar. Cadence P=4, S=3.

### 7. `genre/murim` — Murim (무협·무림)
- Reader fantasy: mastery through discipline; honor and rivalry in the martial world; hidden master
  revealed. Terminology defaults: `romanize` + `gloss_first_use` for *murim*, *gwangho* (the martial
  world), *naegong* (internal energy) — or `translate` ("inner energy") per project; technique names
  translated with optional romanized form in parentheses on first use; sect/clan names translated.
  Register notes: formal archaic-leaning English among peers ("Young Master", "Elder", "Sect Leader",
  "senior brother/sister" as address terms). Cadence P=4, S=3. Taboos: modern slang; generic fantasy
  vocabulary (mana, skills).

### 8. `genre/villainess` — Villainess (악녀)
- Reader fantasy: rewriting a doomed role; wit and competence. Devices: possession/regression into the
  villainess; "original story" knowledge backed by a `source_story` timeline (ADR-0039); divergence tracking; social duels in
  dialogue. Cadence S=3 (verbal satisfaction), relationship P=4. Judge notes: dialogue wit and register
  precision; heroine's inner voice (blunt, modern) contrasting with her formal public speech.

### 9. `genre/possession` — Possession (빙의)
- Knowledge ledger models the possessor's outside knowledge (`source.kind = source_story`, backed by facts
  on the `source_story` timeline — ADR-0039) vs the body's original memories (`forgot`/`unaware`);
  identity-slip risk scenes; address-term confusion beats.

### 10. `genre/reincarnation` — Reincarnation (환생)
- Previous-life expertise lives on a `prior_loop` timeline diverging at rebirth (protagonist-only
  `prior_loop_memory` knowledge; ADR-0039); adult mind in a child's body → register tension is a feature
  (`intentional_shift` flags frequent).

### 11. `genre/harem` — Harem (하렘), Korean manuscripts only (ADR-0056)
- Korean-authored layer (`genre/harem@2`; no English lineage). Engine: heroines with distinct 말투, 사연 and
  first-meeting friction warm to the protagonist one shared incident at a time; jealousy comedy and
  devotion beats are shown through action, never narrated. Devices: `heroine_entrance`,
  `jealousy_comedy`, `devotion_beat`, `misread_affection`. Taboos readers punish: NTR or a heroine's romance
  with another man, an indecisive protagonist, six or more main heroines, heroines without their own arc,
  love at first sight without cause, losing a heroine to the original protagonist.

## Production overlays (6)

11. `genre/dungeon` — floor/level structure; resource and party tracking; boss cadence P=2.
12. `genre/apocalypse-survival` — resource ledger as inventory facts; injury realism with healing
    timelines; grim register but serial pacing; S=3 via competence payoffs.
13. `genre/management` — numbers as facts; negotiation set pieces; corporate titles; P=4 (business
    milestone).
14. `genre/idol-entertainment` — stage/broadcast scenes; fan-reaction interludes (sanitized if imported);
    chart facts; group dynamics with age-based deference rendered through nicknames and teasing.
15. `genre/game-world` — game rules as locked world facts; UI text conventions; NPC/player speech
    distinction.
16. `genre/comedy` (secondary) — misunderstanding engine on the knowledge ledger; punchline placement
    (paragraph end; 1–2 per scene); no explaining the joke; running gags as promises.

## Later refinements
- `mode/character-drama` (interiority band up, cadence relaxed, still serial hooks).
- `mode/slow-burn-romance` (relationship milestone cadence 6–8; tension beats every 2 chapters; strict
  "no accidental early confession" forbidden-development template).

## Combination guide

| Combination | Primary | Notes |
| --- | --- | --- |
| regression + hunter-gate | hunter-gate | regression devices on hunter cadence; prior-loop knowledge heavy (the fixture) |
| possession + villainess + romance fantasy | romance-fantasy | villainess devices; `source_story` frame; Western-style naming |
| academy + system-progression | academy | leaderboards and status windows share formatting grammar (compiler warns on collision) |
| murim + regression | murim | hindsight monologue in murim register |
| modern fantasy + management | modern-fantasy | numbers-as-facts rules |

Unknown combinations compile with a manifest warning and require explicit approval at the bible gate.
