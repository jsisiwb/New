"""v4.2.0 — what the regenerated live chapter taught (ADR-0056 §14).

Writer. The bridge caps one Notion AI completion at 600 s. The regenerated 1화 drafted its first two scenes
in 577 s and ~550 s (one after a timeout) and never finished scene 3: five capped attempts and a transport
fault. A controlled probe of that exact request (same brief, four variants, run together) put the cause in
one line, "분량은 목표 글자 수 … ±12% 안": the variants without it returned in 317 s and 468 s, while the
unchanged request and a variant with every plan contradiction repaired but that line kept both ran past the
cap. A reasoning model asked to land within ±12% counts its own draft; the workflow already measures length
deterministically. The writer now aims at the target, fills every beat, and does not count.

The same brief was contradictory: the plan put the forest north while the previous scenes had written it
east, and it made "사흘. 아니, 이제 이틀." land under an unchanged 72-hour display. The writer gets one order of
precedence for such conflicts instead of deliberating over them.

Planning. Both contradictions came from the plan, not the writer: the contract's must_happen quoted a
promise-ledger running gag verbatim ("사흘. 아니, 이제 이틀.") while its own risk note fixed 72시간 = 사흘.
A line in a ledger or a character's verbal habit is a template; it is now fitted to the chapter's timeline,
and must_happen and the hook may not contradict the contract's own risk notes.
"""
from .v4_1_0 import FAMILIES as V41

SOURCE_VERSION = "4.1.0"
PURPOSE = "Korean webnovel craft prompt (ADR-0056): serialized-episode planning and anti-번역투 prose, {version}."
CHANGELOG = (
    "4.2.0 — regenerated live chapter (ADR-0056 §14): the writer aims at the length target without counting "
    "its own draft (the ±12% self-check kept Notion AI past the bridge's 600 s cap) and resolves conflicting "
    "inputs by one order of precedence; planners fit ledger and verbal-habit lines to the chapter's timeline "
    "and keep must_happen and the hook consistent with the contract's own risk notes."
)


def edit(text: str, old: str, new: str) -> str:
    assert text.count(old) == 1, f"expected exactly one occurrence of: {old[:60]}"
    return text.replace(old, new)


# ---- scene_writer
_sw_sys = V41["scene_writer"][0]
_sw_sys = edit(
    _sw_sys,
    "- 분량은 목표 글자 수(공백 포함, 줄바꿈 제외)의 ±12% 안.",
    "- 분량은 목표 글자 수(공백 포함) 안팎이다. 비트마다 행동·반응·속마음·대사를 살려 목표만큼 쓰고, 짧게 끊고 끝내지 않는다. "
    "글자 수를 세거나 검산하지 않는다(분량은 시스템이 따로 잰다).",
)
_sw_sys = edit(
    _sw_sys,
    "- 정사 상태의 사실(이름, 등급, 수치, 호칭, 관계)을 바꾸지 않는다.",
    "- 자료끼리 어긋나면 오래 따지지 말고 이 순서를 따른다: 정사 상태·지식 표 > 이전 텍스트 > 회차 계약(위험·대응 포함) > 장면 계획. "
    "장면 계획의 비트가 앞선 자료와 어긋나면 그 비트를 어긋나지 않게 고쳐 쓴다.\n"
    "- 정사 상태의 사실(이름, 등급, 수치, 호칭, 관계)을 바꾸지 않는다.",
)

# ---- chapter_planner
_cp_sys = V41["chapter_planner"][0]
_cp_sys = edit(
    _cp_sys,
    "must_happen에 넣는 대사와 낱말은 그대로 원고가 되므로 표준어에 있는 말로 쓴다.",
    "must_happen에 넣는 대사와 낱말은 그대로 원고가 되므로 표준어에 있는 말로 쓴다.\n"
    "- 약속(복선) 장부나 인물의 말버릇에 적힌 대사는 틀이다. 이번 회차의 시점과 산수에 맞게 숫자와 말을 바꿔 넣는다"
    "(72시간이 그대로인 회차라면 ‘이제 이틀’이 아니라 ‘아직 사흘’). must_happen과 절단은 계약에 적은 위험·대응과 어긋나지 않아야 하고, "
    "어긋나면 must_happen 쪽을 고친다.",
)

# ---- scene_planner
_sp_sys = V41["scene_planner"][0]
_sp_sys = edit(
    _sp_sys,
    "숫자·시간·카운트다운의 산수를 맞춘다.",
    "숫자·시간·카운트다운의 산수를 맞춘다. 계약·약속 장부·말버릇에 적힌 대사도 이번 장면의 시점과 산수에 맞지 않으면 맞게 고쳐 적는다. "
    "장소·방향·소지품은 이전 장면에서 이미 정해진 대로 이어 간다.",
)

FAMILIES: dict[str, tuple] = {
    "chapter_planner": (_cp_sys, V41["chapter_planner"][1]),
    "scene_planner": (_sp_sys, V41["scene_planner"][1]),
    "scene_writer": (_sw_sys, V41["scene_writer"][1]),
}
COMPLETE = False
