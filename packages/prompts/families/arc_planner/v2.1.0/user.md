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
{"kind": "main", "ordinal": 1, "title": "...", "objective": "...", "conflict": "...", "antagonistic_force": "...", "stakes": "...", "entry_state": "...", "exit_state_assertions": ["..."], "participants": ["캐릭터 id"], "locations": ["장소 id"], "story_time_window": {"start": {...}, "end": {...}}, "chapter_range_est": {"start": 1, "end": 10}, "beats": [{"type": "setup|rising|reversal|payoff|revelation|emotion|progression|climax|aftermath", "description": "...", "emotion": "...", "reveal": "...", "chapter_offset": 0}], "promises_opened": ["id"], "promises_advanced": ["id"], "promises_paid": ["id"], "progression_milestone_ids": ["..."], "relationship_milestone_ids": ["..."], "cadence_check": {"saida_interval": 3, "progression_interval": 2, "max_goguma_streak": 2, "passes": true}, "risks": ["..."], "must_not": ["..."], "repetition_check": "...", "status": "draft"}