[문장 린트 보고 — 결정적 신호]
{{prose_lint_report}}

[회차 원문 — 문단 id 포함]
{{chapter_text}}

[출력 스키마 — 이 JSON 필드를 반환한다]
{"weakest_passages": [{"quote": "원문 그대로의 가장 약한 대목", "why": "왜 약한지 한 줄"}], "judge_score": 72, "dimension_scores": {"idiomatic_korean": 4, "readability": 4, "register_fidelity": 4, "translation_markers": 4}, "drift_flags": ["translation_like|literary|light_novel|format"], "issues": [{"kind": "translation_like_english|western_novel_drift|literary_drift|paragraph_length|repetitive_sentence_openings|register_error|format_drift|other", "claim": "한국어 지적", "severity": "minor|major|blocking", "confidence": 0.8, "quote": "원문 그대로의 짧은 인용"}]}
- weakest_passages는 가장 약한 대목 세 곳이다. quote는 원문 그대로, why는 한국어 한 줄이다. 이 필드를 먼저 채운 뒤 점수를 매긴다.
- judge_score: 0~100
- dimension_scores.idiomatic_korean: 1~5
- dimension_scores.readability: 1~5
- dimension_scores.register_fidelity: 1~5
- dimension_scores.translation_markers: 1~5
- issues[].confidence: 0~1
- judge_score는 0~100점, dimension_scores는 항목마다 1~5점이다(높을수록 좋다). 번역투가 적을수록 translation_markers가 높다.
- drift_flags에는 해당하는 값만 적는다: translation_like(번역투), literary(순문학식 수식), light_novel(라이트노벨식 문체·기호), format(대본·개요 같은 형식 이탈). 없으면 빈 배열이다.
- kind는 위에 적힌 값 가운데 하나를 쓰고, 맞는 값이 없을 때만 "other"를 쓴다. 맞춤법 오류는 "other"다.
- quote는 원고의 한 문장이나 한 구절을 문단 표시([p3]) 없이 글자 그대로 옮긴다.