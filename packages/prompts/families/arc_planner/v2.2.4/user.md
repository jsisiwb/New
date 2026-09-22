[BLUEPRINT]
{{blueprint}}

[시즌]
{{season}}

[아크 브리프]
{{arc_brief}}

[캐논 상태]
{{canon_state}}

[열린 약속]
{{open_promises}}

아크 계획을 생성하라.

[OUTPUT SCHEMA — 이 JSON 필드를 반환한다. id/project_id/season_id는 워크플로가 채운다]
{"kind": "major|minor", "ordinal": 1, "title": "...", "objective": "...", "conflict": "...", "antagonistic_force": "...", "stakes": "...", "entry_state": "...", "exit_state_assertions": ["..."], "participants": ["캐릭터 id"], "locations": ["장소 id"], "story_time_window": {"start": {"chapter_no": 1, "ordinal": 0, "precision": "exact|approx|unknown"}, "end": {"chapter_no": 10, "ordinal": 0, "precision": "exact|approx|unknown"}}, "chapter_range_est": {"from": 1, "to": 10}, "beats": [{"id": "...", "type": "setup|escalation|reversal|cider|revelation|emotional|progression|climax|aftermath|comedic|relationship", "description": "...", "target_chapter_offset": 0, "participants": [...], "promise_refs": [...], "knowledge_changes_planned": [...]}], "promises_opened": ["id"], "promises_advanced": ["id"], "promises_paid": ["id"], "progression_milestone_ids": ["..."], "relationship_milestone_ids": ["..."], "cadence_check": {"saida_interval": 3, "progression_interval": 2, "max_goguma_streak": 2, "passes": true}, "risks": ["..."], "must_not": ["..."], "repetition_check": "...", "status": "draft"}