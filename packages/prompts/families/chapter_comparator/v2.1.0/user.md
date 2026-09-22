[CONTRACT SHAPE — 필수 훅 / 오프닝 / 엔딩 / 해소 / 길이 목표]
{{contract_shape}}

제시 순서: {{presentation_order}}
이번 실행의 루브릭 차원 순서: {{rubric_order}}

[CANDIDATE A — 문단 id 포함]
{{candidate_a}}

[SCORECARD A — 결정적 검사와 심사 섹션]
{{scorecard_a}}

[CANDIDATE B — 문단 id 포함]
{{candidate_b}}

[SCORECARD B — 결정적 검사와 심사 섹션]
{{scorecard_b}}

[OUTPUT SCHEMA — 이 JSON 필드를 반환한다. judge_call_id는 워크플로가 채운다]
{"candidate_a_id": "...", "candidate_b_id": "...", "presentation_order": "AB|BA", "dimensions": [{"dimension": "prose|structure|genre|voice", "preference": "A|B", "confidence": 0.8, "rationale": "..."}], "overall_preference": "A|B", "confidence": 0.8, "rationale": "..."}