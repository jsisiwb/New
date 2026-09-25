"""v4.6.0 — judges that grade their own model, and the scene writer on Gemini (ADR-0081).

From this run on every role is served by one model, so the judges grade prose written by their own model
(same-model judging). Two defences go into the judge prompts; the scene writer gets the two Gemini-specific
fixes the first live chapter showed:

- prose_judge, structure_judge, voice_judge, genre_judge: an adversarial order — quote the weakest passages
  of the dimension first (`weakest_passages`), then score — and an anchored 1–5 rubric per sub-score with
  concrete Korean failure descriptions, with caps tied to the weakest passages and to the deterministic
  reports the judge already receives.
- scene_writer: 속마음 in 반말 monologue only (Gemini put 존댓말 into the inner voice, three majors live),
  and one paragraph per line with a blank line between (Gemini broke lines inside blocks, which the lint
  reads as 400–700자 paragraphs).

Base texts are read from explicit version folders, never from "the latest version", so this module can be
re-run. Input variables are unchanged; the answer schema gains the optional `weakest_passages`.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = os.path.join(ROOT, "packages", "prompts", "families")

PURPOSE = "Korean webnovel prompt for same-model judging and Gemini drafting (ADR-0081), {version}."
CHANGELOG = (
    "4.6.0 — same-model judging (ADR-0081): judges quote the weakest passages first and score against "
    "anchored Korean rubrics with caps; the scene writer keeps 속마음 in 반말 and writes one paragraph per line."
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


ADVERSARIAL = """판정 순서(같은 계열 모델의 원고를 채점할 때의 편향 방지):
- 이 원고는 당신과 같은 계열의 모델이 썼을 수 있다. 읽기 편하고 익숙한 문장일수록 의심한다. 칭찬할 근거를 찾지 말고 결함부터 찾는다.
- 먼저 이 차원에서 가장 약한 대목 세 곳을 골라 weakest_passages에 원문 그대로 인용하고(quote), 왜 약한지 한 줄로 적는다(why). 약한 대목을 다 적은 뒤에 점수를 매긴다.
- 점수는 아래 기준표로 매긴다. 원고가 두 칸에 걸치면 낮은 칸을 고른다. weakest_passages의 대목이 어떤 항목의 결함이면 그 항목은 4점을 넘을 수 없다.
- 결정적 검사 보고(린트·길이·말높이·용어 보고)가 지적한 결함이 남아 있으면, 그 결함에 해당하는 항목에 기준표보다 높은 점수를 주지 않는다."""

PROSE_RUBRIC = """점수 기준표(1~5):
- idiomatic_korean — 5: 처음부터 한국어로 쓴 웹소설 문장, 어색한 직역·서구식 수식이 없다. 4: 어색한 문장 1~2곳. 3: 3~5곳, 또는 번역 소설처럼 읽히는 문단이 하나 있다. 2: 6곳 이상. 1: 전체가 번역문처럼 읽힌다.
- readability — 5: 모든 문단이 1~3문장이고 대사는 독립된 문단이다. 4: 150자를 넘는 문단이 1~2개. 3: 3~5개이거나, 대사 없는 서술 문단이 다섯 개 넘게 이어진다. 2: 벽처럼 쌓인 문단이 여럿이다. 1: 대부분이 벽 문단이다.
- register_fidelity — 5: 서술·속마음·대사의 어조가 인물과 관계에 맞고 흔들리지 않는다. 4: 흔들림 1곳. 3: 2~3곳(속마음에 존댓말, 이유 없는 반말·존대 전환 등). 2: 4곳 이상. 1: 누가 말하는지 구분되지 않는다.
- translation_markers — 5: 번역투·AI 상투구가 없다. 4: 1~2곳. 3: 3~5곳. 2: 6~9곳. 1: 10곳 이상. 린트 보고의 번역투·상투구 건수보다 적게 세지 않는다."""

STRUCTURE_RUBRIC = """점수 기준표(1~5):
- hook_timing — 5: 첫 세 문장 안에 주인공의 처지와 걸린 것이 나온다. 4: 첫 다섯 문단 안. 3: 첫 열 문단 안. 2: 그 뒤. 1: 훅이 없다.
- dialogue_forwardness — 5: 대사와 속마음이 원고의 30% 이상이고 사건을 밀어낸다. 4: 25~30%. 3: 15~25%이거나 대사가 설명만 한다. 2: 10~15%. 1: 10% 미만.
- local_payoff — 5: 이번 화 안에서 사이다·폭로·성장 확인이 지면에서 터지고 주변 반응으로 커진다. 4: 보상은 터지지만 반응이 약하다. 3: 보상이 예고에 그친다. 2: 보상이 흐릿하다. 1: 보상이 없다.
- ending_pull — 5: 마지막 두 줄이 판을 바꾼다(새 위협·폭로·반전·결단·등장). 4: 판은 바뀌지만 여운이 약하다. 3: 질문은 남지만 판은 그대로다. 2: 다짐·생각에 잠기기로 끝난다. 1: 요약·교훈·하루 마무리로 끝난다.
- exposition_control — 5: 설명이 행동·대사·상태창 안에만 있다. 4: 설명 문단 1개. 3: 2~3개. 2: 4개 이상. 1: 설명 덩어리가 장면을 멈춘다.
- 결정적 검사 보고에 분량 미달이 있으면 local_payoff와 exposition_control 외의 항목을 5점으로 주지 않는다."""

VOICE_RUBRIC = """점수 기준표(1~5):
- distinguishability — 5: 이름표를 가려도 모든 발화의 화자를 맞힐 수 있다. 4: 헷갈리는 발화 1~2곳. 3: 3~5곳. 2: 주연 둘 외에는 헷갈린다. 1: 화자를 가릴 수 없다.
- verbal_habits — 5: 대사만 보고도 누가 말하는지 알 수 있고 인물마다 어미·말버릇이 다르다. 4: 비슷한 말투의 인물이 한 쌍. 3: 두세 쌍. 2: 주연 외에는 구분되지 않는다. 1: 모두 같은 말투다.
- register_naturalness — 5: 말높이와 호칭이 관계·서열·장면에 맞는다. 4: 어색한 곳 1곳. 3: 2~3곳(과잉 존대, 번역 소설식 대사 등). 2: 4곳 이상. 1: 관계가 드러나지 않는다.
- register_consistency — 5: 말높이가 이유 없이 흔들리지 않고, 1인칭 주인공의 속마음은 반말 독백이다. 4: 흔들림 1곳. 3: 2~3곳, 또는 속마음에 존댓말이 섞인다. 2: 4곳 이상. 1: 매 장면 흔들린다.
- 말높이 검사 보고가 짚은 혼용 발화가 연출이 아니라면 register_consistency는 3점을 넘을 수 없다."""

GENRE_RUBRIC = """점수 기준표(1~5):
- reader_fantasy — 5: 장르 프로필의 독자 판타지(서열 역전, 원작·회귀 지식의 선수, 히로인의 매력 등)가 이번 화 지면에서 실제로 터진다. 4: 터지지만 작다. 3: 예고에 그친다. 2: 흐릿하다. 1: 없다.
- device_correctness — 5: 장르 장치(상태창·순위표·착각 연출·반응 컷·카운트다운 등)가 필요한 곳에 정확한 형식으로 나온다. 4: 형식이나 시점이 어긋난 곳 1곳. 3: 2~3곳이거나 장치가 과하다. 2: 장치가 엉뚱하게 쓰인다. 1: 장르 장치가 없다.
- vocabulary_register — 5: 장르 용어와 표기가 표기 정책 그대로이고 다른 장르의 용어가 섞이지 않는다. 4: 어긋난 표기 1곳. 3: 2~3곳이거나 다른 장르 장치의 용어가 한 번 섞인다. 2: 4곳 이상. 1: 장르가 흐려진다.
- taboo_restraint — 5: 장르 금기를 어기지 않는다. 3: 금기에 가까운 전개가 한 번 있다. 1: 금기를 어긴다.
- 용어·장르 장치 검사 보고의 이형 표기가 남아 있으면 vocabulary_register는 3점을 넘을 수 없다."""

WEAKEST_KEY = '{"weakest_passages": [{"quote": "원문 그대로의 가장 약한 대목", "why": "왜 약한지 한 줄"}], '
WEAKEST_NOTE = "- weakest_passages는 가장 약한 대목 세 곳이다. quote는 원문 그대로, why는 한국어 한 줄이다. 이 필드를 먼저 채운 뒤 점수를 매긴다."


def judge(family: str, version: str, rubric: str) -> tuple[str, str, dict]:
    system, user = at(family, version)
    system = edit(system, "평가 기준:", f"{ADVERSARIAL}\n{rubric}\n평가 기준:")
    # The example answer opens with weakest_passages, so the model writes them before any score.
    lines = user.split("\n")
    idx = [i for i, l in enumerate(lines) if l.startswith('{"judge_score"')]
    assert len(idx) == 1, f"{family}: expected one example answer line"
    lines[idx[0]] = WEAKEST_KEY + lines[idx[0]][1:]
    user = "\n".join(lines)
    if version == "4.1.0":
        # Hand-written 4.1.0 shapes become schema-generated ones (ADR-0057), as every 4.3.0+ shape is.
        from .shapes import replace_shape
        user = replace_shape(user, family)
    lines = user.split("\n")
    idx = [i for i, l in enumerate(lines) if l.startswith('{"weakest_passages"')]
    assert len(idx) == 1, f"{family}: expected one example answer line after rendering"
    lines.insert(idx[0] + 1, WEAKEST_NOTE)
    return system, "\n".join(lines), {"__source": version}


FAMILIES: dict[str, tuple] = {
    "prose_judge": judge("prose_judge", "4.1.0", PROSE_RUBRIC),
    "structure_judge": judge("structure_judge", "4.1.0", STRUCTURE_RUBRIC),
    "voice_judge": judge("voice_judge", "4.4.0", VOICE_RUBRIC),
    "genre_judge": judge("genre_judge", "4.4.0", GENRE_RUBRIC),
}

_w_sys, _w_user = at("scene_writer", "4.2.0")
_w_sys = edit(
    _w_sys,
    "강조할 문장, 반전, 충격은 한 줄 문단으로 떼어 놓는다. 문단 사이는 빈 줄 하나.",
    "강조할 문장, 반전, 충격은 한 줄 문단으로 떼어 놓는다. 문단 사이는 빈 줄 하나. 줄을 바꿀 때마다 빈 줄을 넣는다(한 줄이 곧 한 문단이다).",
)
_w_sys = edit(
    _w_sys,
    "- 1인칭 주인공 시점이면 서술과 속마음에 주인공의 입말(자조, 짧은 감탄, 속으로 삼키는 욕)이 살짝 묻어난다. 대사는 이 세계 사람의 말투다.",
    "- 1인칭 주인공 시점이면 서술과 속마음에 주인공의 입말(자조, 짧은 감탄, 속으로 삼키는 욕)이 살짝 묻어난다. 대사는 이 세계 사람의 말투다.\n"
    "- 속마음(‘ ’)은 반말 독백으로만 쓴다. 대사에서 존댓말을 쓰는 인물이라도 속마음에는 ‘~습니다’·‘~요’를 쓰지 않는다.",
)
FAMILIES["scene_writer"] = (_w_sys, _w_user, {"__source": "4.2.0"})
