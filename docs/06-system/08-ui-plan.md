# UI Plan

English UI (Korean UI localization in Beta). Manuscript views default to a **mobile-width column**
(≈ 380 px, 16–17 px serif or humanist sans, generous line height) because serialized fiction is read on
phones; the preview renders the project's spelling locale conventions (curly quotes, em dashes).

## 1. Navigation

```
Workspace ▸ Projects
  Project
   ├ Overview        (status, canon version, spend, next actions, attention items)
   ├ Requirements    (spec: hard/soft/assumptions; directions timeline)
   ├ Concept         (candidates, comparison)
   ├ Bible           (characters | register & voice profiles | world | power system | factions | locations | naming registry | terminology policy | narrative identity)
   ├ Plan            (blueprint | seasons | arcs | chapter contracts board)
   ├ Chapters        (list, batch controls, review queue)
   │   └ Chapter     (manuscript | scorecard | issues | candidates | trace | canon delta)
   ├ Canon           (timeline | entities/state | knowledge matrix | relationships | promises | commits/stale)
   ├ Jobs            (running, paused, attention; SSE progress)
   ├ Costs           (dashboards, budgets, predictions)
   └ Export
Workspace settings (members, providers/privacy, budgets, audit log)
```

## 2. Key screens

### Requirements & Assumption Review
Two-column: left = grouped requirement cards with kind badge (hard / soft / assumption) and provenance; right = detail
with edit, confirm/reject for assumptions, conflict banners. Bulk actions. Direction composer with scope
picker and re-plan preview (which contracts become stale).

### Concept Compare
Side-by-side cards; judge verdicts in both orders shown transparently ("A>B in order 1, A>B in order 2");
merge mode with per-field picker.

### Bible
Entity list + editor. Register profile editor: matrix of counterpart → formality/deference/familiarity/
intimacy/directness, English address terms and titles, contraction usage, with validity (e.g., "from ch.87:
first names in private, titles in public"). Naming registry editor (display name, native-script name,
romanization, short forms). Terminology policy editor (per term: translate / romanize / gloss / preserve,
fixed spelling, gloss text). Narrative Identity page: output language & locale (English; locale selector),
tradition profile version, genre overlays (chips), setting/cultural profile, user preferences (numeric with
sane ranges), forbidden expressions, **compiled Narrative Identity Block preview** per role showing the two
contracts first, exemplar bank manager (provenance labels), threshold calibration status.
Lock toggles with lock icon; locked facts listed in a "Locked canon" panel.

### Plan
Blueprint page (promise, conflict, arcs, ending, endgame requirements with satisfaction status). Season
board (columns) → arc cards → chapter contract chips (status colors: draft/validated/locked/stale/
realized). Contract editor with validation panel (canon/plan/narrative checks) and cadence strip (last 10
chapters' ending/payoff types).

### Chapter Review (the most-used screen)
Left: manuscript (mobile column) with paragraph IDs, inline issue highlights (color by severity, icon by
dimension), patch diff toggle, version selector, word/character count vs target (per manuscript language). Right tabs: **Scorecard** (separate
gauges for English prose, serialized structure, genre, voice, continuity; tier thresholds per dimension;
drift flags), **Issues** (grouped by dimension and severity;
each with claim, span jump, conflicting canon item, canon evidence quote + deep link to earlier chapter,
repair suggestion, actions: patch / override / dismiss), **Candidates** (side-by-side + verdicts),
**Canon delta preview** (facts/events/knowledge/relationships/promises to be committed, with evidence,
single-source flags, adjudications), **Trace** (packs, calls, costs). Footer actions: Approve · Request
changes (text box) · Reject · Regenerate. Keyboard shortcuts for queue review.

### Canon Inspectors
- **Timeline**: horizontal story clock; lanes per timeline; frame filters; click → event detail w/ evidence.
- **Entity state**: attribute table with validity ranges and evidence; "as of chapter k" slider; history.
- **Knowledge matrix**: rows propositions (search/filter secrets), columns knowers (characters + narrator +
  reader); cells stance icons (✓ knows, ? suspects, ✗ believes false + tooltip value, 🎭 pretends, — unaware);
  slider "as of chapter k".
- **Relationships**: graph with directed edges; pair drawer (axes, register summary, address terms/titles,
  public variant, history).
- **Promises**: board by status; due windows; overdue badges; link to setup/payoff evidence.
- **Commits & stale**: commit list with delta viewer; stale artifacts (material dependencies) and
  review-suggested artifacts (contextual) with reasons and actions (revalidate/regenerate/dismiss/promote
  edge).

### Jobs & Attention
Job cards with step progress, spend vs budget, ETA; attention queue with failure class and recommended
actions; trace view for retries.

### Costs
Charts by role/model/chapter; cost per accepted chapter & per 1,000 words; predictions; budget editor with
hard/soft limits.

### Export
Scope/format/options (incl. glossary of romanized terms, spelling locale); history with signed links;
disclosure text editor.

## 3. Interaction principles

- Every warning shows **evidence** and a **jump link**; no bare "inconsistent" messages.
- Approvals are explicit; auto-approvals are labeled and reversible via rollback (latest) or regeneration.
- Destructive actions (reject, retcon, rollback, delete) require confirmation with impact summary.
- Progress is live (SSE) with per-step costs.
- Manuscript typography: locale-correct quotation marks and dashes, no widows for dialogue lines in preview.

## 4. Accessibility & i18n
Keyboard-first review; ARIA on issue lists; i18n via message catalogs (en default; ko in Beta); dates in
user locale; manuscript text never auto-translated by the UI.
