"""v4.0.0 — Korean webnovel craft engine (ADR-0056)."""
from .v4_0_0_planning import P as _PLANNING
from .v4_0_0_prose import P as _PROSE

SOURCE_VERSION = "3.0.0"
PURPOSE = "Korean webnovel craft prompt (ADR-0056): serialized-episode planning and anti-번역투 prose, {version}."
CHANGELOG = (
    "4.0.0 — Korean webnovel craft engine (ADR-0056): instructions rebuilt around the daily 5,000-자 mobile "
    "episode (초반 25화 funnel, one core event per 화, 사이다 cadence, 절단), 캐빨 cast and heroine-route design, "
    "and the language layer's 번역투/AI 상투구 lists; variable surfaces and output shapes unchanged from 3.0.0."
)
FAMILIES: dict[str, tuple] = {**_PLANNING, **_PROSE}
COMPLETE = True
