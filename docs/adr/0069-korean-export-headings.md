# ADR-0069: Korean exports head chapters `N화`

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** product owner
- **Relates to:** ADR-0036 (accepted-only export), ADR-0054 (manuscript language per project), the Step 0
  improvement audit (§5.12)

## Context

`exportAccepted` assembled every export as `## Chapter N` (Markdown) or `Chapter N` (text), and the API's TXT
and DOCX renderers wrote `Chapter N` headings and found each chapter's body by searching for those markers. A
Korean serial is numbered in 화 — readers and platforms say `1화`, not `Chapter 1` — so every Korean export
opened each chapter with an English heading.

## Decision

1. `chapterHeading(n, lang)` is `N화` for a Korean project and `Chapter N` otherwise; `exportAccepted` takes
   the language from the project and uses it for the Markdown and text headings, and a Korean result carries
   `language: 'ko'`. English results are unchanged byte for byte (no new field, same text and hash).
2. The API's TXT and DOCX renderers head chapters with the same function. Because `N화` also occurs inside
   Korean prose, a Korean heading marker counts only on a line of its own when the renderer splits the
   assembled text into chapters; the English lookup is unchanged.

## Alternatives considered

- **`제N화`.** Rejected as the default: serial platforms and readers use `N화`; a platform-specific style
  belongs to platform export profiles.
- **Returning each chapter's text separately from `exportAccepted`.** Deferred: it changes the result shape
  every caller reads; the line-anchored marker closes the Korean case.

## Consequences

- Korean TXT, DOCX and Markdown exports read `1화`, `2화`, …
- Not changed: the export's document locale metadata still accepts only English locales (an ADR-0026-era
  rule with its own test), and the export manifest still records `words`.
