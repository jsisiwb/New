이 회차의 스토리 시계: {{story_clock}}

[REGISTRY — 엔티티, id, 이름, 별칭; 알려진 명제와 약속]
{{registry}}

[PRE-PASS — 오프셋이 붙은 등록부 언급, 상태창 숫자, 발화 주석]
{{pre_pass}}

[HYPOTHESES — PLANNED, 원문과 대조해 검증]
{{hypotheses}}

[CHAPTER TEXT — 문단 id 포함]
{{chapter_text}}

[OUTPUT SCHEMA — 이 JSON 필드를 반환한다. project_id/chapter_id/manuscript_version_id/base_canon_version/stage/extractor_call_id/reconciliation은 워크플로가 채운다]
{"items": [{"local_id": "...", "type": "fact|event|knowledge_state|relationship_state|promise_event|proposition|proposition_truth|entity|alias", "op": "assert|close|supersede|retract|open|advance|pay|create", "frame": "canonical", "confidence": 1, "importance": "core|major|minor", "story_clock": {"chapter_no": 1, "ordinal": 1, "precision": "exact"}, "payload": {...}, "evidence": [{"manuscript_version_id": "워크플로 제공", "chapter_no": 1, "paragraph_id": "p3", "start": 1, "end": 5, "quote": "원문과 문자 단위로 일치하는 인용"}]}], "unresolved_questions": [...], "hypothesis_results": [...], "summary_l1": "회차 요약 한 문단", "ending_hook": "엔딩 훅"}