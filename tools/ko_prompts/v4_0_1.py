"""v4.0.1 — live-run fixes to the v4.0.0 surface (ADR-0056).

arc_planner: the output-shape note showed `repetition_check` as a string while arc-plan.schema.json requires
an object; the first live arc plan copied the note and failed validation.
"""
from .v4_0_0 import FAMILIES as V4

SOURCE_VERSION = "4.0.0"
PURPOSE = "Korean webnovel craft prompt (ADR-0056): serialized-episode planning and anti-번역투 prose, {version}."
CHANGELOG = (
    "4.0.1 — live-run fixes (ADR-0056): arc_planner's output-shape note gives repetition_check as the schema's "
    "object {compared_arc_ids, similarity_score, notes} instead of a string."
)

_arc_system, _arc_user = V4["arc_planner"][0], V4["arc_planner"][1]
_fixed_user = _arc_user.replace(
    '"repetition_check": "..."',
    '"repetition_check": {"compared_arc_ids": [], "similarity_score": 0.1, "notes": "이전 아크와 겹치지 않는 이유 한두 문장"}',
)
assert _fixed_user != _arc_user, "arc_planner shape note not found"

FAMILIES: dict[str, tuple] = {"arc_planner": (_arc_system, _fixed_user)}
COMPLETE = False
