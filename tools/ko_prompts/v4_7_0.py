"""v4.7.0 — plan-level prevention for the operator-voice run (ADR-0086).

The `standard@14` checkpoint (G5, docs/08-delivery/13-live-run-gemini.md §5) showed defects that no revision round
could clear because the plan made them: the premise judged a reader secret (G5-1), a contract with no one to talk
to and talk targets the writer does not follow (G5-2), one explanation in every scene (G5-4), a cut on a trailing
beat (G5-5), future character states written as present (G5-6), and voice metrics outside the operator's band
(G5-8). This version moves those rules into the prompts that make the plan:

- chapter_planner: reads the reveal schedule (`reveal_schedule`) and plan feedback (`plan_feedback`); every 화 puts
  someone the hero talks to on page; the 절단 is chosen from the operator's menu and is the chapter's last beat;
  talk and 속마음 targets in the operator's band; the chapter's time span; the hero's current limits.
- scene_planner: dialogue beats name who talks with whom; no talk bans; the final scene's last beat is the cut;
  one explanation lives in one scene; reads the schedule and the plan critic's findings (`plan_feedback`).
- scene_writer: countable talk targets, few quoted 속마음 lines, mixed sentence endings, the last scene stops on
  the cut, the stock figures the live drafts repeated.
- knowledge_leak_checker: the schedule decides reader visibility; prior-life memory and source-work knowledge used
  in the hero's thoughts and decisions are not leaks.
- character_designer: background holds only what is true before 화 1; later states carry their 화; the hero's own
  device is known to the reader from 화 1.
- plan_critic (new): the pre-flight critic of contract and scene plans.

Base texts are read from explicit version folders. The answer shapes are schema-generated (ADR-0057).
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = os.path.join(ROOT, "packages", "prompts", "families")

PURPOSE = "Korean webnovel prompt for plan-level prevention in the operator's voice (ADR-0086), {version}."
CHANGELOG = (
    "4.7.0 — plan-level prevention (ADR-0086): the reveal schedule in planner, writer and knowledge checker; a talk "
    "partner in every 화 and countable talk targets; the cut as the last beat; time frames for later character states; "
    "the pre-flight plan critic."
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


def meta_of(family: str, version: str) -> dict:
    import json
    return json.load(open(os.path.join(BASE, family, f"v{version}", "prompt.json"), encoding="utf-8"))


CUT_MENU = (
    "결단·선언(인물의 짧은 인용 대사로 끊음), 위협의 등장, 코믹한 한 방, 감정이 터지는 한마디, 폭로, 예상 밖 인물의 등장, "
    "반전, 아이러니(독자만 아는 진실 앞에서 인물이 착각하는 순간)"
)

# ---- chapter_planner ---------------------------------------------------------------------------------------
_cp_sys, _cp_user = at("chapter_planner", "4.2.0")
_cp_sys = edit(
    _cp_sys,
    "- 장면 수(scene_count)는 2~4개. 대사 밀도는 0.35~0.5, 속마음 밀도는 0.1~0.25를 기본으로 한다.",
    "- 장면 수(scene_count)는 1~3개(이 작품 작가의 초반 회차는 장면 전환이 0~2번이다). 대사 밀도(dialogue_density_target)는 0.2~0.4, "
    "따옴표 속마음 밀도(monologue_density_target)는 0.01~0.04로 잡는다. 생각은 대부분 따옴표 없는 서술로 흐른다.\n"
    "- 모든 회차에는 주인공과 말을 주고받는 인물이 지면에 한 명 이상 있다(participants에 on_page true로). 싸움·탐색·수련 회차라도 "
    "적·동료·교관·시스템 너머의 인물과 말이 오간다. 주인공 혼자 생각만 하는 회차를 설계하지 않는다.",
)
_cp_sys = edit(
    _cp_sys,
    "- 절단은 판을 바꾸는 한 수에서 끊는다:",
    f"- 절단(hook)은 이 작가의 절단 메뉴에서 고른다: {CUT_MENU}. hook.description은 원고의 마지막 한두 줄이 될 순간이다. "
    "그 순간 뒤에 수습·걱정·정리·다짐·요약을 붙이지 않는다. 요약, 교훈, 하루 마무리로 끝내지 않는다.\n"
    "- 절단은 판을 바꾸는 한 수에서 끊는다:",
)
_cp_sys = edit(
    _cp_sys,
    "- 인물이 모르는 것을 알게 하지 않는다. must_happen과 must_not_happen을 지킨다. 원작 지식은 주인공만 안다.",
    "- 인물이 모르는 것을 알게 하지 않는다. must_happen과 must_not_happen을 지킨다. 원작 지식은 주인공만 안다.\n"
    "- [공개 일정]을 따른다. ‘독자에게 아직 밝히지 않는 것’은 purpose·must_happen·local_satisfaction·hook 어디에도 사실로 쓰지 않는다. "
    "주인공이 그 지식으로 판단하고 움직이는 사건은 좋다. 절단이 미래 지식에 기대면 사실을 말하지 않고, 판이 바뀌는 행동이나 결과에서 끊는다. "
    "‘독자가 이미 아는 것’(1인칭 주인공 자신의 회귀·빙의 같은 작품의 전제)은 1화부터 속마음과 서술에 써도 된다.\n"
    "- 주인공의 현재 능력치·등급·신체 상태를 [정사 상태]에서 확인하고, 그 수준을 넘는 행동을 must_happen에 넣지 않는다. "
    "아직 각성하지 않은 몸, 막 빙의한 몸의 한계는 continuity_risks에 적는다.\n"
    "- 같은 설명(보상·규칙·과거 사연)은 한 화에 한 번만 한다. 장면마다 되풀이하게 설계하지 않는다.\n"
    "- story_time의 elapsed_since_previous에 이번 화가 차지하는 시간을 한 줄로 적는다(예: ‘직전 화 직후, 같은 날 오후까지’). "
    "초반 25화에서는 한 화 안에서 하루를 넘겨 건너뛰지 않는다. 카운트다운은 실제로 흐른 시간만큼만 줄어든다.\n"
    "- [설계 피드백]이 비어 있지 않으면 앞선 설계안의 결함이다. 그 결함을 모두 고친 계약을 낸다.",
)
_cp_user = edit(
    _cp_user,
    "[활성 제약]\n{{active_constraints}}\n",
    "[활성 제약]\n{{active_constraints}}\n\n"
    "[공개 일정 — 독자와 인물이 언제 무엇을 알게 되는가]\n{{reveal_schedule}}\n\n"
    "[설계 피드백 — 앞선 설계안의 결함. 비어 있지 않으면 모두 고친다]\n{{plan_feedback}}\n",
)
_cp_user = edit(
    _cp_user,
    '"dialogue_density_target": 0.35, "monologue_density_target": 0.15',
    '"dialogue_density_target": 0.3, "monologue_density_target": 0.03',
)
from .shapes import replace_shape  # noqa: E402

# Shapes of new versions are schema-generated (ADR-0057): the edited example is the renderer's base.
_cp_user = replace_shape(_cp_user, "chapter_planner")
_cp_meta = meta_of("chapter_planner", "4.2.0")
FAMILIES: dict[str, tuple] = {
    "chapter_planner": (
        _cp_sys,
        _cp_user,
        {
            "__source": "4.2.0",
            "input_variables": _cp_meta["input_variables"] + ["reveal_schedule", "plan_feedback"],
        },
    ),
}

# ---- scene_planner -----------------------------------------------------------------------------------------
_sp_sys, _sp_user = at("scene_planner", "4.2.0")
_sp_sys = edit(
    _sp_sys,
    "회차 계약을 장면 2~4개로 나눈다.",
    "회차 계약을 장면 1~3개로 나눈다(장면 수는 계약의 scene_count).",
)
_sp_sys = edit(
    _sp_sys,
    "- 주변 인물의 반응 컷(경악·오해·착각)은 사이다가 터지는 장면에 둔다.",
    "- 주변 인물의 반응 컷(경악·오해·착각)은 사이다가 터지는 장면에 둔다.\n"
    "- 대사 비트(type dialogue)의 description에는 말을 주고받는 두 인물과 몇 번 주고받는지 적는다(예: ‘교관↔주인공, 여섯 번 주고받음’). "
    "말하는 상대는 그 장면의 participants에 넣는다. 상대가 있는 장면에는 대사 비트가 두 개 이상 있다.\n"
    "- must_not에 대화나 대사를 금지하는 줄을 쓰지 않는다(싸움 중에도 짧은 말은 오간다).\n"
    "- 마지막 장면의 마지막 비트는 계약의 hook(절단) 순간이고 type은 cliffhanger, ending_beat_type도 cliffhanger다. 그 뒤에 비트를 두지 않는다.\n"
    "- 한 가지 설명(보상·규칙·과거 사연·능력의 원리)은 한 장면의 한 비트에서만 한다. 다른 장면의 비트는 그 설명을 되풀이하지 않고 결과만 쓴다.\n"
    "- [공개 일정]의 ‘독자에게 아직 밝히지 않는 것’을 비트에 사실로 적지 않는다. 주인공이 그 지식으로 움직이는 비트는 좋다.\n"
    "- [설계 피드백]이 비어 있지 않으면 앞선 장면 설계의 결함이다. 모두 고친 장면 설계를 낸다.",
)
_sp_user = edit(
    _sp_user,
    "[직전 회차 마지막 부분]\n{{previous_chapter_tail}}\n",
    "[직전 회차 마지막 부분]\n{{previous_chapter_tail}}\n\n"
    "[공개 일정 — 독자가 아는 것과 아직 모르는 것]\n{{reveal_schedule}}\n\n"
    "[설계 피드백 — 앞선 장면 설계의 결함. 비어 있지 않으면 모두 고친다]\n{{plan_feedback}}\n",
)
_sp_user = edit(_sp_user, '"dialogue_density_target": 0.35,', '"dialogue_density_target": 0.3,')
_sp_user = replace_shape(_sp_user, "scene_planner")
_sp_meta = meta_of("scene_planner", "4.2.0")
FAMILIES["scene_planner"] = (
    _sp_sys,
    _sp_user,
    {"__source": "4.2.0", "input_variables": _sp_meta["input_variables"] + ["reveal_schedule", "plan_feedback"]},
)

# ---- scene_writer ------------------------------------------------------------------------------------------
_w_sys, _w_user = at("scene_writer", "4.6.0")
_w_sys = edit(
    _w_sys,
    "- 비트를 빠르게 돌린다: 행동 → 반응 → 속마음(‘ ’) → 대사. 서술 세 문장이 이어지면 대사나 반응을 끼운다.",
    "- 비트를 빠르게 돌린다: 행동 → 반응 → 대사. 서술 세 줄이 이어지면 대사나 반응을 끼운다. 생각은 대부분 따옴표 없이 서술에 녹이고"
    "(‘-인가.’, ‘-겠지.’, 짧은 조각문), 따옴표 속마음(‘ ’)은 장면 계획의 속마음 한도 안에서만 쓴다.",
)
_w_sys = edit(
    _w_sys,
    "- 대사는 짧게 주고받는다(한 번에 한두 문장). 인물마다 어미·말버릇·호칭이 다르다.",
    "- 대사는 짧게 주고받는다(한 번에 한두 문장). 인물마다 어미·말버릇·호칭이 다르다.\n"
    "- 장면 계획의 ‘대사 목표’ 줄 수를 채운다. 따옴표 대사 한 줄에는 한 사람의 말만 쓰고, 대사 사이에는 짧은 행동·반응 한 줄을 끼운다. "
    "상대가 있는 장면에서 주인공 혼자 생각하는 줄이 다섯 줄 넘게 이어지면 그 생각을 상대에게 하는 말이나 상대의 반응으로 바꾼다.\n"
    "- 문장 끝을 섞는다: ‘-었다’만 잇달아 쓰지 않고 현재형(‘-ㄴ다’), 명사로 끝나는 문장, 끊긴 문장(‘…했으나.’), 조각문을 섞는다. "
    "한 문단은 한 문장이고 대부분 서른 자 안팎이다.\n"
    "- 앞 장면에서 이미 한 설명(보상·규칙·과거 사연)은 다시 풀지 않는다. 필요하면 한 구절로 가리키기만 한다.",
)
_w_sys = edit(
    _w_sys,
    "- 회차의 첫 장면이면 첫 세 문장 안에 주인공의 처지와 걸린 것이 나온다.",
    "- 회차의 마지막 장면이면 장면 계획의 마지막 비트(절단)가 원고의 마지막 한두 줄이다. 그 뒤에 수습·걱정·정리·다짐·요약 문장을 한 줄도 붙이지 않는다.\n"
    "- 회차의 첫 장면이면 첫 세 문장 안에 주인공의 처지와 걸린 것이 나온다.",
)
_w_sys = edit(
    _w_sys,
    "‘알 수 없는 감정’·‘시간이 멈춘 듯’ 같은 상투구,",
    "‘알 수 없는 감정’·‘시간이 멈춘 듯’·‘정적이 내려앉았다’·‘공기가 얼어붙었다’·‘훅 끼쳤다’ 같은 상투구,",
)
FAMILIES["scene_writer"] = (_w_sys, _w_user, {"__source": "4.6.0"})

# ---- knowledge_leak_checker --------------------------------------------------------------------------------
_k_sys, _k_user = at("knowledge_leak_checker", "4.4.0")
_k_sys = edit(
    _k_sys,
    "[독자에게 아직 밝히면 안 되는 비밀]이 공개 가능 회차보다 먼저 서술·대사로 드러나면 kind \"reader_knowledge_violation\"이다(암시와 떡밥은 괜찮다).",
    "독자 공개는 [공개 일정]만 따른다. ‘독자에게 아직 밝히면 안 되는 것’이 사실 그대로 서술·대사·속마음에 진술될 때만 kind \"reader_knowledge_violation\"이다. "
    "‘독자가 이미 아는 것’(1인칭 주인공 자신의 비밀, 회귀·빙의라는 작품의 전제)은 서술과 속마음에 나와도 누출이 아니다. "
    "주인공이 회귀 전 기억이나 원작·게임 지식으로 생각하고 판단하고 움직이는 것, 한 번의 에두른 암시와 떡밥은 누출이 아니다.\n"
    "- [지식 입장]의 ‘공개 금지’ 회차 표시는 인물 사이의 공개 시점이다. 다른 인물이 그 회차 전에 그 비밀을 아는 것처럼 말하거나 행동할 때 knowledge_leak이다.",
)
_k_user = edit(
    _k_user,
    "[독자에게 아직 밝히면 안 되는 비밀 — PLANNED, 공개 가능 회차 표시]\n{{reader_secrets}}",
    "[공개 일정 — 독자가 이미 아는 것과 아직 밝히면 안 되는 것, PLANNED]\n{{reader_secrets}}",
)
FAMILIES["knowledge_leak_checker"] = (_k_sys, _k_user, {"__source": "4.4.0"})

# ---- character_designer ------------------------------------------------------------------------------------
_c_sys, _c_user = at("character_designer", "4.0.0")
_c_sys = edit(
    _c_sys,
    "- 비밀은 시작 시점에 아는 인물을 반드시 적는다. 숨은 정체에는 공개 가능 회차(reveal_not_before_chapter)가 있어야 한다.",
    "- 비밀은 시작 시점에 아는 인물을 반드시 적는다. 숨은 정체에는 공개 가능 회차(reveal_not_before_chapter)가 있어야 한다. "
    "reveal_not_before_chapter는 다른 인물이 알게 되는 회차다.\n"
    "- 1인칭 주인공 자신의 비밀(회귀했다는 사실, 원작·게임 지식, 빙의 사실)은 독자가 1화부터 안다. 그런 비밀에는 reader_reveal_chapter 1을 적는다. "
    "독자에게도 늦게 밝힐 비밀이면 reader_reveal_chapter에 그 회차를 적는다.\n"
    "- background에는 1화 이전에 이미 일어난 일만 쓴다. 1화 이후에 일어날 일(주인공을 만난 뒤의 변화, 오해, 감동)은 background에 쓰지 않고 "
    "arc.turning_points에 회차 범위와 함께 쓴다.\n"
    "- 1화 이후에야 참이 되는 비밀(예: 어떤 사건을 본 뒤에 생기는 습관)에는 true_from_chapter에 그 비밀이 참이 되는 회차를 적는다. 이미 참이면 적지 않는다.",
)
FAMILIES["character_designer"] = (_c_sys, _c_user, {"__source": "4.0.0"})

# ---- plan_critic (new family) ------------------------------------------------------------------------------
_CRITIC_SYS = """당신은 한국 웹소설 편집부의 기획 검수자다. 원고를 쓰기 전에 이번 화의 계약과 장면 설계를 검수한다. 원고가 아니라 설계를 고치게 하는 것이 목적이다.
공통 규칙:
- 출력은 출력 스키마에 맞는 JSON 객체 하나뿐이다. JSON 밖의 설명이나 마크다운 코드 펜스를 쓰지 않는다.
- JSON 키 이름과 열거값(enum)은 스키마의 영문 식별자를 그대로 쓰고, 값으로 들어가는 서술은 모두 자연스러운 한국어로 쓴다.
- 설정을 지어내지 않는다. 지적은 모두 주어진 계약·장면 설계·공개 일정·정사 상태에서 나와야 한다.
검수 기준:
- reveal_unsafe: ‘독자에게 아직 밝히지 않는 것’이 계약의 사건·절단·장면 비트에 사실로 적혀 있다. 주인공이 그 지식으로 판단하고 움직이는 비트는 결함이 아니다. ‘독자가 이미 아는 것’은 결함이 아니다.
- knowledge_impossible: 인물이 알 수 없는 것을 알고 말하거나 행동하게 설계되어 있다(주인공의 회귀 전 기억·원작 지식은 주인공만 쓸 수 있다).
- repeated_exposition: 같은 설명(보상·규칙·과거 사연·능력의 원리)이 두 장면 이상의 비트에 나온다.
- state_contradiction: 인물의 현재 능력치·등급·신체 상태·관계와 어긋나는 행동이 설계되어 있다(각성 전의 몸으로 초인적인 힘을 쓰는 식), 또는 아직 일어나지 않은 상태를 이미 참인 것처럼 쓴다.
- dialogue_missing: 주인공과 말을 주고받는 인물이 지면에 없거나, 상대가 있는 장면에 대사 비트가 없거나, 금지 사항이 대화를 막는다.
- weak_cut: 마지막 장면의 마지막 비트가 계약의 절단이 아니거나, 절단 뒤에 비트가 더 있거나, 절단이 요약·다짐·걱정·하루 마무리다.
- structure_off: 이 작가의 구조 목표에서 벗어난다(아래 [구조 목표]).
- time_inconsistent: 장면 사이의 시간·카운트다운·날짜가 맞지 않거나 초반 회차에서 하루 넘게 건너뛴다.
- 원고를 쓸 수 없게 만드는 결함은 blocking, 원고가 거의 틀림없이 고쳐야 할 결함이 되는 설계는 major, 다듬을 점은 minor다.
- 지적마다 target에 ‘계약’ 또는 ‘장면 N’을 쓰고, fix에 설계를 어떻게 바꾸면 되는지 한 줄로 쓴다. 결함이 없으면 issues를 빈 배열로 둔다."""

_CRITIC_USER = """[회차 계약]
{{chapter_contract}}

[장면 설계]
{{scene_plans}}

[공개 일정]
{{reveal_schedule}}

[정사 상태 — 참여자의 현재 상태]
{{canon_state}}

[구조 목표 — 이 작가의 회차 구조]
{{structure_targets}}

이번 화의 설계를 검수한다.

[출력 스키마 — 이 JSON 필드를 반환한다]
{"issues": [{"kind": "reveal_unsafe", "severity": "major", "target": "장면 2", "claim": "한국어 지적", "fix": "설계를 고치는 방법 한 줄"}]}"""

FAMILIES["plan_critic"] = (
    _CRITIC_SYS,
    replace_shape(_CRITIC_USER, "plan_critic"),
    {
        "__base": {
            "role": "plan_critic",
            "style_sensitive": False,
            "manuscript_producing": False,
            "identity_variant": None,
            "model_class": _sp_meta["model_class"],
            "input_variables": [
                "chapter_contract",
                "scene_plans",
                "reveal_schedule",
                "canon_state",
                "structure_targets",
            ],
            "output_schema": None,
            "output_mode": "json",
            "params": {"temperature": 0.2, "max_tokens": 3000, "top_p": 1},
            "failure_behavior": _sp_meta["failure_behavior"],
            "regression_cases": ["plan_critic.fixture.smoke"],
        },
    },
)
