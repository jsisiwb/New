"""v4.1.0 — what the first live chapter taught (ADR-0056 §13).

Planning. chapter_planner@4.0.0 counted a possession opening ("낯선 침대에서 눈을 떠") as in medias res
while structure_judge@4.0.0 banned the same opening as a wake-up routine; the live 1화 opened on "눈을
떴다." and reached its death flag at paragraph 54. One rule now holds in planner, scene planner, writer and
judge: a possession/regression opening is fine only if the first three sentences carry the premise and
the stake, and exploration is short. The live 절단 was a roommate asking "왜 그렇게 창백해?"; a 절단 must now
change the situation. "초반 회차는 느리게 간다" read as slow pacing; it now says one event, fast breath.
The plan also carried logic slips readers call 개연성 errors (a first-meeting character greeting by name,
"사흘. 아니, 이제 이틀." a minute after a 72-hour display, an invented word); planners and checkers now
name them.

Judges. The v3/v4 shape notes taught "prose_issue"-style kinds (not in the issue enum, so every live issue
became `other` and the regression check could not tell issues apart), one 0–100 dimension score, free
drift flags and a string repair. The notes now show the enum kinds, 1–5 sub-scores, the scorecard's drift
flag values and the repair object. The prose judge also checks spelling (the live draft had "낮설었다").
"""
from .v4_0_0 import FAMILIES as V4

SOURCE_VERSION = "4.0.0"
PURPOSE = "Korean webnovel craft prompt (ADR-0056): serialized-episode planning and anti-번역투 prose, {version}."
CHANGELOG = (
    "4.1.0 — first live chapter (ADR-0056 §13): one opening rule across planner, scene planner, writer and "
    "structure judge (a possession opening carries premise and stake in its first three sentences); a 절단 "
    "changes the situation; 개연성 rules (first-meeting names, countdown arithmetic, invented words); judge "
    "shape notes show enum issue kinds, 1–5 sub-scores, the scorecard drift-flag values and the repair "
    "object."
)


def edit(text: str, old: str, new: str) -> str:
    assert text.count(old) == 1, f"expected exactly one occurrence of: {old[:60]}"
    return text.replace(old, new)


QUOTE_NOTE = "- quote는 원고의 한 문장이나 한 구절을 문단 표시([p3]) 없이 글자 그대로 옮긴다."
SCORE_NOTE = "- judge_score는 0~100점, dimension_scores는 항목마다 1~5점이다(높을수록 좋다)."
KIND_NOTE = "- kind는 위에 적힌 값 가운데 하나를 쓰고, 맞는 값이 없을 때만 \"other\"를 쓴다."


def judge_user(family: str, old_shape: str, new_shape: str, notes: list[str]) -> str:
    return edit(V4[family][1], old_shape, "\n".join([new_shape, *notes]))


# ---- chapter_planner
_cp_sys = V4["chapter_planner"][0]
_cp_sys = edit(
    _cp_sys,
    "- hook(절단)은 구체적인 장면으로 적는다: 누가 무엇을 하거나 말하는 순간 끊기는지, 독자에게 남는 질문(question_raised)이 무엇인지. ‘긴장감이 감돈다’ 같은 분위기 서술은 절단이 아니다.",
    "- hook(절단)은 구체적인 장면으로 적는다: 누가 무엇을 하거나 말하는 순간 끊기는지, 독자에게 남는 질문(question_raised)이 무엇인지. ‘긴장감이 감돈다’ 같은 분위기 서술은 절단이 아니다.\n"
    "- 절단은 판을 바꾸는 한 수에서 끊는다: 새 위협, 폭로, 상태창의 새 알림, 예상 밖 인물의 등장, 결정적 한마디, 반전. 안부나 일상 질문(‘괜찮아?’, ‘왜 그렇게 창백해?’), 다짐, 생각에 잠기기, 잠들기로 끝나는 장면은 절단이 아니다.",
)
_cp_sys = edit(
    _cp_sys,
    "- opening(도입)도 구체적인 첫 장면으로 적는다. 날씨·풍경·세계관 설명·잠에서 깨는 일상 루틴으로 시작하지 않는다(빙의 직후의 충격은 사건 한복판으로 친다).",
    "- opening(도입)도 구체적인 첫 장면으로 적는다. 날씨·풍경·세계관 설명·잠에서 깨는 일상 루틴으로 시작하지 않는다. 빙의·회귀·환생 직후 장면이라도 ‘눈을 떴다’·‘낯선 천장’으로 열지 않는다. 첫 세 문장 안에 주인공의 처지와 걸린 것(목숨·기한·목표)이 나오게 하고, 몸과 방을 살피는 탐색은 몇 문단 안에서 끝낸다.",
)
_cp_sys = edit(
    _cp_sys,
    "- 초반 회차(1~10화)는 느리게 간다. 사건 하나, 긴장 하나, 절단 하나.",
    "- 초반 회차(1~10화)는 한 화에 사건 하나만 다루되 호흡은 빠르다: 사건 하나, 긴장 하나, 절단 하나.\n"
    "- 1화는 작품의 약속을 판다. 회차 앞 10% 안에 주인공의 처지와 가장 큰 위기(사망 플래그·기한·목표)가 박히고, 절단은 작품 전체를 끌고 갈 질문을 건다.",
)
_cp_sys = edit(
    _cp_sys,
    "- 인물이 모르는 것을 알게 하지 않는다. must_happen과 must_not_happen을 지킨다. 원작 지식은 주인공만 안다.",
    "- 인물이 모르는 것을 알게 하지 않는다. must_happen과 must_not_happen을 지킨다. 원작 지식은 주인공만 안다.\n"
    "- 개연성을 지킨다. 상태창 수치·카운트다운·날짜·나이의 산수가 회차 안에서 맞아야 한다(숫자가 줄어드는 대사는 실제로 시간이 흐른 뒤에만 둔다). 처음 만나는 인물은 소개 전에 상대 이름을 부르지 않는다(알고 있다면 그 이유를 계약에 적는다). 방 배정·서열·규칙은 정사 상태와 맞춘다. must_happen에 넣는 대사와 낱말은 그대로 원고가 되므로 표준어에 있는 말로 쓴다.",
)

# ---- scene_planner
_sp_sys = V4["scene_planner"][0]
_sp_sys = edit(
    _sp_sys,
    "- 1번 장면은 계약의 도입(opening)으로 시작하고 첫 세 문장 안에 훅이 걸린다. 마지막 장면은 계약의 보상과 절단(hook)으로 끝난다. 중간 장면은 갈등을 한 칸씩 키운다.",
    "- 1번 장면은 계약의 도입(opening)으로 시작하고 첫 세 문장 안에 훅이 걸린다. 이번 화의 핵심 훅(위기·기한·상태창·폭로)은 1번 장면의 첫 비트나 둘째 비트에 둔다. 깨어나기·주변 살피기·회상 비트는 합쳐 두 개까지다. 마지막 장면은 계약의 보상과 절단(hook)으로 끝나고, 마지막 비트는 계약의 절단 장면(cliffhanger)이다. 중간 장면은 갈등을 한 칸씩 키운다.\n"
    "- 비트에 적는 대사와 낱말은 그대로 원고가 된다. 처음 만나는 인물은 소개 전에 상대 이름을 부르지 않는다. 방금 나간 인물을 곧바로 다시 들이지 않는다(시간이나 이유를 준다). 숫자·시간·카운트다운의 산수를 맞춘다. 표준어에 없는 낱말을 지어내지 않는다.",
)

# ---- scene_writer
_sw_sys = V4["scene_writer"][0]
_sw_sys = edit(
    _sw_sys,
    "- 상태창·시스템 알림은 대괄호([ ]) 한 줄씩, 보여 줄 이유가 있을 때만.",
    "- 상태창·시스템 알림은 대괄호([ ]) 한 줄씩, 보여 줄 이유가 있을 때만. 안내문·편지 같은 문서는 「 」·『 』로 감싸지 않고 한 줄씩 옮기거나 서술에 녹인다. 작품·책 제목만 《 》.\n"
    "- 회차의 첫 장면이면 첫 세 문장 안에 주인공의 처지와 걸린 것이 나온다. 몸과 방을 살피는 탐색은 몇 문단 안에서 끝낸다.",
)
_sw_sys = edit(
    _sw_sys,
    "- 금지: 날씨·풍경으로 여는 도입, 잠에서 깨는 일상 루틴,",
    "- 금지: 날씨·풍경으로 여는 도입, 잠에서 깨는 일상 루틴, ‘눈을 떴다’·‘낯선 천장이었다’로 여는 첫 문장,",
)

# ---- structure_judge
_st_sys = V4["structure_judge"][0]
_st_sys = edit(
    _st_sys,
    "- 도입 훅: 첫 세 문장 안에 긴장·질문·전 회차 연결이 걸리는가. 날씨·풍경·설명·일상 루틴으로 여는가.",
    "- 도입 훅: 첫 세 문장 안에 긴장·질문·전 회차 연결이 걸리는가. 날씨·풍경·설명·일상 루틴으로 여는가. 빙의·회귀 직후 장면은 첫 세 문장에 주인공의 처지와 걸린 것이 나오면 훅이고, ‘눈을 떴다’·‘낯선 천장’으로 열거나 몸·방 탐색이 길게 이어지면 늦은 훅이다. 1화는 회차 앞 10% 안에 가장 큰 위기가 나와야 한다.",
)
_st_sys = edit(
    _st_sys,
    "- 절단: 마지막 한두 줄이 다음 화를 누를 이유를 만드는가. 요약·교훈·회상·‘그렇게 하루가 저물었다’ 식 마무리, 스스로 정리되는 중간 장면은 감점.",
    "- 절단: 마지막 한두 줄이 다음 화를 누를 이유를 만드는가. 요약·교훈·회상·‘그렇게 하루가 저물었다’ 식 마무리, 스스로 정리되는 중간 장면은 감점. 판을 바꾸지 않는 안부·일상 질문, 다짐, 생각에 잠기기로 끝나면 약한 절단이다.",
)
_st_user = judge_user(
    "structure_judge",
    '{"judge_score": 72, "dimension_scores": {"structure": 72}, "drift_flags": ["..."], "issues": [{"kind": "structure_issue", "claim": "한국어 지적", "severity": "minor|major|blocking", "quote": "원문 인용"}], "hook_sentence_index": 0, "local_payoff_present": true, "ending_type_detected": "cliffhanger|revelation|decision|threat|question"}',
    '{"judge_score": 72, "dimension_scores": {"hook_timing": 4, "dialogue_forwardness": 4, "local_payoff": 4, "ending_pull": 4, "exposition_control": 4}, "drift_flags": ["western_novel|serial|exposition|cadence"], "issues": [{"kind": "late_hook|weak_ending|weak_pacing|excessive_exposition|western_novel_drift|serial_drift|payoff_without_setup|repeated_scene|other", "claim": "한국어 지적", "severity": "minor|major|blocking", "confidence": 0.8, "quote": "원문 그대로의 짧은 인용"}], "hook_sentence_index": 0, "local_payoff_present": true, "ending_type_detected": "cliffhanger|revelation|decision|threat|question"}',
    [
        SCORE_NOTE,
        "- drift_flags에는 해당하는 값만 적는다: western_novel(서구 소설식 구조), serial(훅·보상·절단의 연재 장치 실패), exposition(설명 과다), cadence(호흡 처짐). 없으면 빈 배열이다.",
        KIND_NOTE,
        QUOTE_NOTE,
    ],
)

# ---- prose_judge
_pj_sys = V4["prose_judge"][0]
_pj_sys = edit(
    _pj_sys,
    "- 말높이·호칭의 자연스러움과 인물별 말투 차이.",
    "- 말높이·호칭의 자연스러움과 인물별 말투 차이.\n"
    "- 맞춤법·띄어쓰기 오류와 표준어에 없는 낱말을 찾아 인용한다(‘낮설었다’→‘낯설었다’처럼 고칠 말을 claim에 적는다). 독자는 오탈자를 바로 댓글로 단다.",
)
_pj_user = judge_user(
    "prose_judge",
    '{"judge_score": 72, "dimension_scores": {"prose": 72}, "drift_flags": ["..."], "issues": [{"kind": "prose_issue", "claim": "한국어 지적", "severity": "minor|major|blocking", "quote": "원문 인용"}]}',
    '{"judge_score": 72, "dimension_scores": {"idiomatic_korean": 4, "readability": 4, "register_fidelity": 4, "translation_markers": 4}, "drift_flags": ["translation_like|literary|light_novel|format"], "issues": [{"kind": "translation_like_english|western_novel_drift|literary_drift|paragraph_length|repetitive_sentence_openings|register_error|format_drift|other", "claim": "한국어 지적", "severity": "minor|major|blocking", "confidence": 0.8, "quote": "원문 그대로의 짧은 인용"}]}',
    [
        SCORE_NOTE + " 번역투가 적을수록 translation_markers가 높다.",
        "- drift_flags에는 해당하는 값만 적는다: translation_like(번역투), literary(순문학식 수식), light_novel(라이트노벨식 문체·기호), format(대본·개요 같은 형식 이탈). 없으면 빈 배열이다.",
        KIND_NOTE + " 맞춤법 오류는 \"other\"다.",
        QUOTE_NOTE,
    ],
)

# ---- genre_judge
_gj_user = judge_user(
    "genre_judge",
    '{"judge_score": 72, "dimension_scores": {"genre": 72}, "drift_flags": ["..."], "issues": [{"kind": "genre_issue", "claim": "한국어 지적", "severity": "minor|major|blocking", "quote": "원문 인용"}]}',
    '{"judge_score": 72, "dimension_scores": {"reader_fantasy": 4, "device_correctness": 4, "vocabulary_register": 4, "taboo_restraint": 5}, "drift_flags": [], "issues": [{"kind": "forbidden_development|terminology_violation|western_novel_drift|repetitive_arc|payoff_without_setup|other", "claim": "한국어 지적", "severity": "minor|major|blocking", "confidence": 0.8, "quote": "원문 그대로의 짧은 인용"}]}',
    [
        SCORE_NOTE,
        "- drift_flags에는 장르 이탈을 짧은 꼬리표로만 적고, 없으면 빈 배열이다.",
        KIND_NOTE,
        QUOTE_NOTE,
    ],
)

# ---- voice_judge
_vj_user = judge_user(
    "voice_judge",
    '{"judge_score": 72, "dimension_scores": {"voice": 72}, "drift_flags": ["..."], "issues": [{"kind": "voice_issue", "claim": "한국어 지적", "severity": "minor|major|blocking", "quote": "원문 인용"}]}',
    '{"judge_score": 72, "dimension_scores": {"distinguishability": 4, "verbal_habits": 4, "register_naturalness": 4, "register_consistency": 4}, "drift_flags": [], "issues": [{"kind": "register_error|address_term_error|voice_drift|character_inconsistency|other", "claim": "한국어 지적", "severity": "minor|major|blocking", "confidence": 0.8, "quote": "원문 그대로의 짧은 인용"}]}',
    [
        SCORE_NOTE,
        "- drift_flags에는 말투 이탈을 짧은 꼬리표로만 적고, 없으면 빈 배열이다.",
        KIND_NOTE,
        QUOTE_NOTE,
    ],
)

# ---- continuity_checker
_cc_sys = V4["continuity_checker"][0]
_cc_sys = edit(
    _cc_sys,
    "- 원고와 정사 사이의 모순을 찾는다: 사실, 시간선, 장소, 소지품, 부상, 등급, 세계·힘의 규칙, 관계, 호칭.",
    "- 원고와 정사 사이의 모순을 찾는다: 사실, 시간선, 장소, 소지품, 부상, 등급, 세계·힘의 규칙, 관계, 호칭.\n"
    "- 회차 안의 앞뒤 모순도 찾는다(독자 댓글의 ‘개연성’ 지적): 소개 전에 상대 이름을 아는 인물, 방금 나간 인물의 즉시 재등장, 상태창 수치·카운트다운·날짜의 산수, 한 장면 안에서 바뀌는 소지품·위치·차림. 이때 canon_ref에는 앞선 문단 id를 적는다.",
)
_cc_user = judge_user(
    "continuity_checker",
    '{"issues": [{"kind": "continuity_error", "quote": "원문 인용", "canon_ref": "정사 항목 id", "severity": "minor|major|blocking", "confidence": 0.8, "claim": "한국어 지적", "repair": "최소 수정안"}]}',
    '{"issues": [{"kind": "canon_contradiction|timeline_error|location_error|inventory_impossible|injury_forgotten|rank_incorrect|world_rule_violation|power_rule_violation|relationship_inconsistency|numeric_inconsistency|character_inconsistency|other", "quote": "원문 그대로의 짧은 인용", "canon_ref": "정사 항목 id 또는 앞선 문단 id", "severity": "minor|major|blocking", "confidence": 0.8, "claim": "한국어 지적", "repair": {"scope": "sentence|paragraph|dialogue|scene", "suggestion": "최소 수정안"}}]}',
    [KIND_NOTE, QUOTE_NOTE],
)

# ---- knowledge_leak_checker
_kl_sys = V4["knowledge_leak_checker"][0]
_kl_sys = edit(
    _kl_sys,
    "- 인물이 모르는 지식으로 말하거나 행동하는 경우, 아는 것을 무시하는 경우, 독자에게 아직 공개되면 안 되는 비밀이 새는 경우를 찾는다.",
    "- 인물이 모르는 지식으로 말하거나 행동하는 경우, 아는 것을 무시하는 경우, 독자에게 아직 공개되면 안 되는 비밀이 새는 경우를 찾는다. 처음 만나는 자리에서 소개도 받기 전에 상대 이름이나 사정을 아는 것도 지식 누출이다.",
)
_kl_user = judge_user(
    "knowledge_leak_checker",
    '{"issues": [{"kind": "knowledge_leak", "severity": "minor|major|blocking", "quote": "원문 인용", "claim": "한국어 지적", "confidence": 0.8}]}',
    '{"issues": [{"kind": "knowledge_leak|knowledge_ignorance|reader_knowledge_violation", "severity": "minor|major|blocking", "quote": "원문 그대로의 짧은 인용", "claim": "한국어 지적", "confidence": 0.8}]}',
    [
        "- kind: knowledge_leak(모르는 것을 앎), knowledge_ignorance(아는 것을 무시함), reader_knowledge_violation(독자에게 이른 비밀).",
        QUOTE_NOTE,
    ],
)

FAMILIES: dict[str, tuple] = {
    "chapter_planner": (_cp_sys, V4["chapter_planner"][1]),
    "scene_planner": (_sp_sys, V4["scene_planner"][1]),
    "scene_writer": (_sw_sys, V4["scene_writer"][1]),
    "structure_judge": (_st_sys, _st_user),
    "prose_judge": (_pj_sys, _pj_user),
    "genre_judge": (V4["genre_judge"][0], _gj_user),
    "voice_judge": (V4["voice_judge"][0], _vj_user),
    "continuity_checker": (_cc_sys, _cc_user),
    "knowledge_leak_checker": (_kl_sys, _kl_user),
}
COMPLETE = False
