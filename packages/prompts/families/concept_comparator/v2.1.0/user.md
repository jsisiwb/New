[STORY SPEC]
{{story_spec}}

제시 순서: {{presentation_order}}

[CANDIDATE A]
{{candidate_a}}

[CANDIDATE B]
{{candidate_b}}

[OUTPUT SCHEMA — 이 JSON 필드를 반환한다. judge_call_id는 워크플로가 채운다]
{"candidate_a_id": "...", "candidate_b_id": "...", "presentation_order": "AB|BA", "dimensions": [{"dimension": "concept", "preference": "A|B", "confidence": 0.8, "rationale": "..."}], "overall_preference": "A|B", "confidence": 0.8, "rationale": "..."}