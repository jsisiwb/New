"""v4.3.0 — output shapes generated from the answer schema (ADR-0057).

CI now validates every active prompt's output-shape example against its schema (packages/prompts
output-shapes.test.ts). Two active examples did not validate:

- canon_extractor@4.0.0 showed `"payload": {}` for every item type, so the model had to guess the payload of
  a fact, event or knowledge state; the discriminated union in canon-delta.schema.json rejects `{}`. The
  generated example shows one complete fact item and a note lists the required payload fields per type.
- story_architect@4.0.0 answers with promise proposals and character names that the workflow converts, but
  its label did not say that the workflow fills season ordinals and entity ids. The answer view of the
  blueprint schema now declares those answer-only fields and the generated label names every filled field.

Only the output-shape block changes; instructions, variables and parameters are the source version's.
Every other family's example already validates and keeps its pinned version.
"""
from .shapes import latest, replace_shape

PURPOSE = "Korean webnovel craft prompt (ADR-0056) with a schema-generated output shape (ADR-0057), {version}."
CHANGELOG = (
    "4.3.0 — output shape generated from the answer schema (ADR-0057): every required field, schema enum "
    "values only, derived shape notes; canon_extractor shows a complete item payload, story_architect's label "
    "names every workflow-filled field."
)

FAMILIES: dict[str, tuple] = {}
for _family in ("canon_extractor", "story_architect"):
    _source, _system, _user = latest(_family)
    FAMILIES[_family] = (_system, replace_shape(_user, _family), {"__source": _source})
COMPLETE = False
