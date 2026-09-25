"""v4.8.0 — the cast bible for a regressor or possessor who remembers (ADR-0088).

The `standard@15` checkpoint (G6, docs/08-delivery/13-live-run-gemini.md §6) showed two cast-bible defects the plan
inherits:

- the designer never lists the hero among the knowers of what he remembers from his prior life or the source work,
  so the hero thinking about a future he lived through reads as knowledge he cannot have (G6-1);
- the heroine brief asks for each heroine's fate "in the 원작, with the 원작 주인공", which puts the novel-possession
  vocabulary into a game-possession or regression bible, and the writer copies it (KO-DEVICE-01, G6-4).

character_designer: device-neutral wording for the fate the hero remembers, and the hero among the knowers of what he
remembers. Base text read from the explicit 4.7.0 folder.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = os.path.join(ROOT, "packages", "prompts", "families")

PURPOSE = "Korean webnovel prompt for a cast bible that knows what the hero remembers (ADR-0088), {version}."
CHANGELOG = (
    "4.8.0 — the cast bible for a hero who remembers (ADR-0088): the hero is a knower of what he remembers from a "
    "prior life or the source work; the heroine's remembered fate is written in the premise device's own words."
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


_c_sys, _c_user = at("character_designer", "4.7.0")
_c_sys = edit(
    _c_sys,
    "원작에서의 운명(원작 주인공과의 관계·배드 엔딩)",
    "주인공이 기억하는 원래 흐름에서의 운명과 배드 엔딩(작품의 장치에 맞는 말로: 회귀물이면 지난 생, 게임 빙의면 게임, 소설 빙의면 원작)",
)
_c_sys = edit(
    _c_sys,
    "- background에는 1화 이전에 이미 일어난 일만 쓴다.",
    "- 회귀자·빙의자 주인공이 지난 생이나 원작·게임에서 알게 된 다른 인물의 비밀에는 known_by에 주인공의 이름을 넣는다. "
    "주인공이 기억하는 미래를 주인공이 모르는 것으로 두지 않는다.\n"
    "- background에는 1화 이전에 이미 일어난 일만 쓴다.",
)
FAMILIES: dict[str, tuple] = {"character_designer": (_c_sys, _c_user, {"__source": "4.7.0"})}
