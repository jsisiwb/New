"""v4.10.0 — the writer keeps a character's voice without copying its example lines, and nobody names a stranger (ADR-0090).

The `standard@18` checkpoint (G8, docs/08-delivery/13-live-run-gemini.md §8) and G7 before it showed the writer lifting
the cast bible's example lines (`대사 예: …`, which the cast designer writes for each character) into the chapter word
for word; the voice judge raised each as a major ("the card's example line pasted in", G8-3).

In G8a a character also called another by name before any introduction in three rounds (r0, r1, r3), and G7r's thug
knew the hero's name; the continuity checker raised each as blocking. In G7r and G8r the regression hero, an unawakened
body at D-10, kicked steel doors off their hinges; the continuity checker and the genre judge raised it in five rounds.

scene_writer: the example lines show how a character talks; the writer keeps the voice and never reuses the sentence.
A character names someone they meet for the first time only after an introduction or hearing the name; the hero's
game, source-work or prior-life knowledge of a name stays in narration and 속마음. An unawakened or low-level body does
only what it can; the upper hand comes from experience, knowledge, vital points, tools and the first move.
Base text read from the explicit 4.7.0 folder.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = os.path.join(ROOT, "packages", "prompts", "families")

PURPOSE = "Korean webnovel prompt for a writer who keeps voices without copying example lines and names no stranger (ADR-0090), {version}."
CHANGELOG = (
    "4.10.0 — voices without copied example lines, no stranger named, bodies within their level (ADR-0090): the cast "
    "bible's 대사 예 show the voice and are never reused; a first meeting names nobody before an introduction; an "
    "unawakened body wins by experience and tools, not strength."
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


_w_sys, _w_user = at("scene_writer", "4.7.0")
_w_sys = edit(
    _w_sys,
    "- 대사는 짧게 주고받는다(한 번에 한두 문장). 인물마다 어미·말버릇·호칭이 다르다.",
    "- 대사는 짧게 주고받는다(한 번에 한두 문장). 인물마다 어미·말버릇·호칭이 다르다.\n"
    "- 인물 설계의 ‘대사 예’는 그 인물이 어떻게 말하는지 보여 주는 예시다. 말투만 따르고 그 문장을 원고에 그대로 옮기지 않는다.\n"
    "- 인물은 소개를 받거나 호명을 듣기 전에는 처음 만난 상대의 이름을 부르지 않는다. 주인공이 게임·원작·지난 생으로 아는 이름은 서술과 속마음에만 쓴다.\n"
    "- 각성 전이거나 레벨이 낮은 몸은 그 몸이 할 수 있는 만큼만 움직인다. 상대를 압도하는 장면이라도 우위는 경험·지식·급소·도구·선수에서 나온다.",
)
FAMILIES: dict[str, tuple] = {"scene_writer": (_w_sys, _w_user, {"__source": "4.7.0"})}
