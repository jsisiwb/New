[ARC PLAN]
{{arc_plan}}

회차 번호: {{chapter_number}}

[이전 회차 요약]
{{previous_chapter_summary}}

[캐논 상태]
{{canon_state}}

[지식 상태]
{{knowledge_state}}

[열린 약속]
{{open_promises}}

[활성 제약]
{{active_constraints}}

목표 길이(글자 수, 공백 포함): {{length_target_words}}

회차 계약을 생성하라.

[OUTPUT SCHEMA — 이 JSON 필드를 반환한다. id/project_id/chapter_number/version/arc_id/season_id/timeline_id/status/pinned/narrative_identity_version_id/active_constraints_ref는 워크플로가 채운다]
{"purpose": "...", "reader_experience": "...", "arc_objective_contribution": "...", "must_happen": [{"description": "...", "evidence": "..."}], "must_not_happen": ["..."], "pov": {"character_id": "엔티티 id", "mode": "close_third|first"}, "participants": [{"character_id": "엔티티 id", "role": "...", "on_page": true}], "mentioned_only": ["엔티티 id"], "locations": ["엔티티 id"], "story_time": {"start": {"chapter_no": 1, "offset": "아침"}, "end": {"chapter_no": 1, "offset": "저녁"}}, "knowledge_deltas": [{"proposition_id": "...", "character_id": "...", "delta": "learns|confirms|doubts", "channel": "witnessed|told|inferred"}], "state_deltas": [{"entity_id": "...", "attribute": "...", "from": "...", "to": "..."}], "relationship_deltas": [{"source_id": "...", "target_id": "...", "relationship_state_id": "...", "change": "..."}], "introduces": ["엔티티 id"], "setups": [{"id": "...", "statement": "...", "due_chapter_window": {"min": 2, "max": 5}}], "payoffs": [{"id": "...", "statement": "...", "settles_setup_id": "..."}], "progression": [{"milestone_id": "...", "description": "..."}], "emotional_movement": {"from": "...", "to": "..."}, "conflict": {"description": "...", "reversal": "..."}, "local_satisfaction": [{"type": "saida|revelation|emotion|growth|humor", "description": "..."}], "ending_state": "...", "hook": {"type": "cliffhanger|revelation|decision|threat|question", "description": "..."}, "opening": {"type": "tension|continuation|question", "description": "..."}, "scene_count": 3, "dialogue_density_target": 0.5, "monologue_density_target": 0.2, "length_target": {"unit": "characters", "value": 5500, "tolerance_ratio": 0.12}, "tone_notes": ["..."], "continuity_risks": [{"description": "..."}], "continuity_anchors": [{"fact": "..."}], "knowledge_guards": [{"character_id": "...", "must_not_know_proposition_ids": ["..."]}], "acceptance_criteria": [{"id": "...", "kind": "deterministic|judge|human", "description": "...", "check_ref": "...", "threshold": 1}]}