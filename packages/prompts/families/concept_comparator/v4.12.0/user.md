[스토리 스펙]
{{story_spec}}

제시 순서: {{presentation_order}}

[후보 A]
{{candidate_a}}

[후보 B]
{{candidate_b}}

[출력 스키마 — 이 JSON 필드를 반환한다. judge_call_id는 워크플로가 채운다]
{"candidate_a_id": "...", "candidate_b_id": "...", "presentation_order": "ab|ba", "dimensions": [{"dimension": "contract_fit|continuity_risk|hook|emotional_impact|pacing|genre_fit|originality|reader_fantasy|english_prose_quality|serialized_structure", "evidence_a": "A의 근거", "evidence_b": "B의 근거", "preference": "a|b|tie"}], "overall_preference": "a|b|tie", "confidence": 0.8, "rationale": "한국어 판단 근거"}
- dimension의 english_prose_quality는 스키마 식별자일 뿐이며, 이 프로젝트에서는 한국어 원고 문장 품질을 뜻한다.