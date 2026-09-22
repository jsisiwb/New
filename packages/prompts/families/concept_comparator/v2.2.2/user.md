[STORY SPEC]
{{story_spec}}

제시 순서: {{presentation_order}}

[CANDIDATE A]
{{candidate_a}}

[CANDIDATE B]
{{candidate_b}}

[OUTPUT SCHEMA — 이 JSON 필드를 반환한다. judge_call_id는 워크플로가 채운다]
{"candidate_a_id": "...", "candidate_b_id": "...", "presentation_order": "ab|ba", "dimensions": [{"dimension": "contract_fit|continuity_risk|hook|emotional_impact|pacing|genre_fit|originality|reader_fantasy|english_prose_quality|serialized_structure", "evidence_a": "A 증거", "evidence_b": "B 증거", "preference": "a|b|tie"}], "overall_preference": "a|b|tie", "confidence": 0.8, "rationale": "..."}