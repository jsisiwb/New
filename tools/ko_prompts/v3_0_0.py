"""v3.0.0 — fully Korean prompt surface (ADR-0055)."""
from .v3_0_0_planning import P as _PLANNING
from .v3_0_0_prose import P as _PROSE

CHANGELOG = (
    "3.0.0 — fully Korean prompt surface (ADR-0055): Korean instructions, section labels and output-shape "
    "notes; JSON keys/enums stay schema identifiers; fixes the v2.x literal `{length_target_words}` "
    "placeholder (chapter_planner, scene_writer) and the contract_checker shape (criteria[].criterion_id)."
)

FAMILIES: dict[str, tuple] = {**_PLANNING, **_PROSE}
