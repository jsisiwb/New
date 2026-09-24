이 회차의 스토리 시계: {{story_clock}}

[등록부 — 엔티티, id, 이름, 별칭; 알려진 명제와 약속]
{{registry}}

[사전 분석 — 오프셋이 붙은 등록부 언급, 상태창 수치, 발화 주석]
{{pre_pass}}

[가설 — PLANNED, 원문과 대조해 검증]
{{hypotheses}}

[회차 원문 — 문단 id 포함]
{{chapter_text}}

[출력 스키마 — 이 JSON 필드를 반환한다. 워크플로가 채우는 필드: project_id, chapter_id, manuscript_version_id, base_canon_version, stage, extractor_call_id, reconciliation]
{"items": [{"local_id": "...", "type": "fact", "op": "assert|close|supersede|retract|open|advance|pay|create", "frame": "canonical", "confidence": 1, "importance": "core|major|minor", "story_clock": {"chapter_no": 1, "ordinal": 1, "precision": "exact"}, "payload": {"entity_id": "...", "attribute": "status"}, "evidence": [{"manuscript_version_id": "워크플로 제공", "chapter_no": 1, "paragraph_id": "p3", "start": 1, "end": 5, "quote": "원문과 글자 단위로 같은 인용"}]}], "unresolved_questions": [], "hypothesis_results": [], "summary_l1": "회차 요약 한 문단", "ending_hook": "절단 한 문장"}
- items[].payload의 필수 필드는 type마다 다르다 — fact: entity_id, attribute; event: type, summary, participants; knowledge_state: knower, proposition_id, stance, source, valid_from; relationship_state: from_entity_id, to_entity_id, type, valid_from; promise_event: promise_id, kind; proposition: statement, kind; proposition_truth: proposition_id, timeline_id, value; entity: type, display_name; alias: entity_id, alias
- items[].confidence: 0~1
- items[].story_clock.ordinal: 0~999999