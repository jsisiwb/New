[계약 형태 — 필수 훅 / 도입 / 절단 / 보상 / 분량 목표]
{{contract_shape}}

제시 순서: {{presentation_order}}
이번 실행의 채점 차원 순서: {{rubric_order}}

[후보 A — 문단 id 포함]
{{candidate_a}}

[채점표 A — 결정적 검사와 심사 결과]
{{scorecard_a}}

[후보 B — 문단 id 포함]
{{candidate_b}}

[채점표 B — 결정적 검사와 심사 결과]
{{scorecard_b}}

[출력 스키마 — 이 JSON 필드를 반환한다. judge_call_id는 워크플로가 채운다]
{"candidate_a_id": "...", "candidate_b_id": "...", "presentation_order": "ab|ba", "dimensions": [{"dimension": "contract_fit|continuity_risk|hook|emotional_impact|pacing|genre_fit|originality|reader_fantasy|english_prose_quality|serialized_structure", "evidence_a": "A의 근거", "evidence_b": "B의 근거", "preference": "a|b|tie"}], "overall_preference": "a|b|tie", "confidence": 0.8, "rationale": "한국어 판단 근거"}
- english_prose_quality는 스키마 식별자일 뿐이며 이 프로젝트에서는 한국어 원고 문장 품질을 뜻한다.