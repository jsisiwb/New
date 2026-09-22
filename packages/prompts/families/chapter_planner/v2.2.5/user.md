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
{"purpose": "...", "reader_experience": "...", "arc_objective_contribution": "...", "must_happen": [{"description": "...", "evidence": "..."}], "must_not_happen": ["..."], "pov": {"character_id": "엔티티 id", "person": "first|third_limited|third_omniscient"}, "participants": [{"character_id": "엔티티 id", "role": "...", "on_page": true}], "mentioned_only": ["엔티티 id"], "locations": ["엔티티 id"], "story_time": {"start": {"chapter_no": 1, "ordinal": 0, "precision": "exact|approx|unknown"}, "end": {"chapter_no": 1, "ordinal": 999, "precision": "exact|approx|unknown"}, "elapsed_since_previous": "직전 회차 직후"}, "knowledge_deltas": [{"knower": {"kind": "character", "entity_id": "엔티티 uuid"}, "proposition_id": "...", "new_proposition": "...", "from_stance": "knows|suspects|believes_false|pretends|unaware|forgot|doubts", "to_stance": "knows|suspects|believes_false|pretends|unaware|forgot|doubts", "how": "...", "channel_kind": "witnessed|told|inferred|read|overheard|deduced|remembered|prior_loop_memory|source_story", "informer_id": "엔티티 id"}], "state_deltas": [{"entity_id": "...", "attribute": "...", "from": "...", "to": "...", "when_in_chapter": "early|middle|late"}], "relationship_deltas": [{"source_id": "...", "target_id": "...", "relationship_state_id": "...", "change": "..."}], "introduces": ["엔티티 id"], "setups": [{"id": "...", "statement": "...", "due_chapter_window": {"min": 2, "max": 5}}], "payoffs": [{"id": "...", "statement": "...", "settles_setup_id": "..."}], "progression": [{"milestone_id": "...", "description": "...", "magnitude": "minor|major"}], "emotional_movement": {"from": "...", "to": "..."}, "conflict": {"type": "external|internal|interpersonal|social", "description": "...", "reversal": "..."}, "local_satisfaction": [{"type": "satisfaction|revelation|emotional_step|growth_confirmed|humor_beat", "description": "..."}], "ending_state": "...", "hook": {"type": "cliffhanger|reveal|decision|arrival_of_threat|emotional_peak|quiet_ominous|mid_scene_fade|summary_reflection", "description": "...", "question_raised": "..."}, "opening": {"type": "continue_cliffhanger|in_medias_res|sharp_dialogue|status_update|time_skip_with_tension", "description": "..."}, "scene_count": 3, "dialogue_density_target": 0.5, "monologue_density_target": 0.2, "length_target": {"unit": "characters", "value": 5500, "tolerance_ratio": 0.12}, "tone_notes": ["..."], "continuity_risks": [{"description": "..."}], "continuity_anchors": [{"fact": "..."}], "knowledge_guards": [{"character_id": "엔티티 id", "must_not_know_proposition_ids": ["..."]}], "acceptance_criteria": [{"id": "...", "kind": "deterministic|judge|human", "description": "...", "check_ref": "...", "threshold": 1}]}