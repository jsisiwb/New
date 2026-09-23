"""v4.0.1 — live-run fixes to the v4.0.0 surface (ADR-0056).

arc_planner: the output-shape note showed `repetition_check` as a string while arc-plan.schema.json requires
an object; the first live arc plan copied the note and failed validation.

targeted_reviser: the note showed `changed_claims` as {before, after} pairs, `regression` as a boolean and
`preserved_facts_ack` as prose (the schema wants strings, an object and fact ids), and asked for code-point
offsets the reviser cannot count. 4.0.1 asks for the exact quote instead; the workflow anchors it.
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

_rev_system, _rev_user = V4["targeted_reviser"][0], V4["targeted_reviser"][1]
_REV_OLD_TAIL = _rev_user[_rev_user.index("분량 예산:"):]
_REV_NEW_TAIL = """[수정할 구간] 분량: 약 {{length_budget_words}}어절. 고친 글은 고치는 부분의 원래 길이와 비슷하게 쓴다.

{{identity_tail}}

[출력 스키마 — 이 JSON 필드를 반환한다. id, from_version_id, issue_ids, reviser_call_id, dimension, span의 start·end, regression은 워크플로가 채운다]
{"scope": "sentence|paragraph|dialogue|scene|seam", "span": {"original_quote": "[수정할 구간]에서 고칠 부분을 한 글자도 바꾸지 않고 그대로 옮긴 원문"}, "new_text": "original_quote 자리에 들어갈 고친 원고", "changed_claims": [], "preserved_facts_ack": [], "speaker_annotations": []}
- span.original_quote는 [수정할 구간] 안의 연속된 원문을 띄어쓰기·문장부호까지 그대로 옮긴다. 위치 숫자(start·end)는 세지 않는다. 워크플로가 이 인용으로 위치를 찾는다.
- 고칠 곳이 여러 군데로 흩어져 있으면 그곳들을 모두 포함하는 가장 짧은 연속 구간 하나를 original_quote로 잡는다.
- [수정할 구간] 전체를 고쳐 써야 하면 span을 빼고, new_text에 구간 전체를 고친 글을 쓴다. 빼먹은 문단이 없어야 한다.
- changed_claims는 이야기 속 사실(누가·무엇을·어디서·얼마나)이 바뀐 경우만 한 줄 문자열로 적는다. 문장만 다듬었으면 빈 배열이다.
- preserved_facts_ack에는 [반드시 지킬 사실]에 적힌 id를 하나도 빠짐없이 글자 그대로 적는다. 적힌 id가 없으면 빈 배열이다."""
_fixed_rev_user = _rev_user.replace(_REV_OLD_TAIL, _REV_NEW_TAIL)
assert _fixed_rev_user != _rev_user and "\"regression\"" not in _fixed_rev_user, "reviser note not replaced"

FAMILIES: dict[str, tuple] = {
    "arc_planner": (_arc_system, _fixed_user),
    "targeted_reviser": (
        _rev_system,
        _fixed_rev_user,
        {
            "changelog": (
                "4.0.1 — live-run fixes (ADR-0056 §11): the output-shape note asks for the exact "
                "original_quote instead of code-point offsets (the workflow anchors it; no span rewrites the "
                "whole window), shows changed_claims as strings and preserved_facts_ack as the supplied fact "
                "ids, drops the workflow-owned regression and dimension fields, and states the length budget "
                "in 어절."
            )
        },
    ),
}
COMPLETE = False
