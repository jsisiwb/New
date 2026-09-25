"""v4.9.0 — the cast bible says when each relationship begins (ADR-0089).

The `standard@17` checkpoint (G7, docs/08-delivery/13-live-run-gemini.md §7) showed both chapters oscillating on one
cast-bible defect: a register describes the settled relationship (a heroine calls the hero 사부님 once she has seen his
strike; a thug calls him 형님 once he has been beaten), but the bible seeds every register as canon from before 화 1.
The continuity checker then demands the settled register from the first line, the reviser complies, and the genre and
voice judges flag the heroine calling him 사부님 before she has seen anything (G7-3).

character_designer: every register carries since_chapter, the 화 in which the relationship begins (0 when the two
already knew each other before 화 1). Base text read from the explicit 4.8.0 folder.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = os.path.join(ROOT, "packages", "prompts", "families")

PURPOSE = "Korean webnovel prompt for a cast bible that dates each relationship (ADR-0089), {version}."
CHANGELOG = (
    "4.9.0 — the cast bible dates each relationship (ADR-0089): every register carries since_chapter, the 화 in "
    "which the relationship begins, 0 when the two already knew each other before 화 1."
)
COMPLETE = False


def at(family: str, version: str) -> tuple[str, str]:
    d = os.path.join(BASE, family, f"v{version}")
    return (
        open(os.path.join(d, "system.md"), encoding="utf-8").read(),
        open(os.path.join(d, "user.md"), encoding="utf-8").read(),
    )


def edit(text: str, old: str, new: str) -> str:
    assert text.count(old) == 1, f"expected exactly one occurrence of: {old[:60]}"
    return text.replace(old, new)


_c_sys, _c_user = at("character_designer", "4.8.0")
_c_sys = edit(
    _c_sys,
    "registers는 배열이다. 주요 상대마다 하나씩 적는다.",
    "registers는 배열이다. 주요 상대마다 하나씩 적는다.\n"
    "- registers에는 관계가 자리 잡은 뒤의 말높이와 호칭을 적고, since_chapter에 그 관계가 시작되는 회차를 적는다. "
    "1화 전부터 서로 아는 사이(가족, 오랜 동료, 몸의 원래 주인이 알던 사람)는 0이다. "
    "1화 이후에 처음 만나거나 관계가 생기는 사이(첫 만남, 제자가 되는 순간, 부하가 되는 순간)는 그 회차다. "
    "주인공이 지난 생이나 원작·게임에서만 아는 인물은 이번 생에서 처음 만나는 회차를 적는다.",
)
_c_user = edit(
    _c_user,
    '"address_terms": ["호칭"]}]',
    '"address_terms": ["호칭"], "since_chapter": 1}]',
)
FAMILIES: dict[str, tuple] = {"character_designer": (_c_sys, _c_user, {"__source": "4.8.0"})}
