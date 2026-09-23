[계약 형태 — 필수 훅 / 도입 / 절단 / 보상]
{{contract_shape}}

[구조 린트 보고 — 결정적 신호]
{{structure_lint_report}}

[회차 원문 — 문단 id 포함]
{{chapter_text}}

[출력 스키마 — 이 JSON 필드를 반환한다]
{"judge_score": 72, "dimension_scores": {"hook_timing": 4, "dialogue_forwardness": 4, "local_payoff": 4, "ending_pull": 4, "exposition_control": 4}, "drift_flags": ["western_novel|serial|exposition|cadence"], "issues": [{"kind": "late_hook|weak_ending|weak_pacing|excessive_exposition|western_novel_drift|serial_drift|payoff_without_setup|repeated_scene|other", "claim": "한국어 지적", "severity": "minor|major|blocking", "confidence": 0.8, "quote": "원문 그대로의 짧은 인용"}], "hook_sentence_index": 0, "local_payoff_present": true, "ending_type_detected": "cliffhanger|revelation|decision|threat|question"}
- judge_score는 0~100점, dimension_scores는 항목마다 1~5점이다(높을수록 좋다).
- drift_flags에는 해당하는 값만 적는다: western_novel(서구 소설식 구조), serial(훅·보상·절단의 연재 장치 실패), exposition(설명 과다), cadence(호흡 처짐). 없으면 빈 배열이다.
- kind는 위에 적힌 값 가운데 하나를 쓰고, 맞는 값이 없을 때만 "other"를 쓴다.
- quote는 원고의 한 문장이나 한 구절을 문단 표시([p3]) 없이 글자 그대로 옮긴다.