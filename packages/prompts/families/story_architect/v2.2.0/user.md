[STORY SPEC]
{{story_spec}}

[선택된 콘셉트]
{{concept}}

[성경 요약]
{{bible_summary}}

목표 회차 수: {{target_chapters}}

시리즈 청사진을 생성하라.

[OUTPUT SCHEMA — 이 JSON 필드를 반환한다. project_id/version/pinned과 시즌·약속의 id는 워크플로가 채운다]
{"story_promise": "...", "reader_fantasy": "...", "main_conflict": "...", "themes": ["..."], "protagonist_arc": {"start_state": "...", "end_state": "...", "turning_points": [{"description": "...", "chapter_from": 1, "chapter_to": 2}]}, "character_arcs": [...], "relationship_arcs": [...], "progression_arc": "...", "mysteries": [{"id": "...", "statement": "...", "reveal_window": {...}}], "foreshadowing_register": [{"id": "...", "statement": "...", "planted_chapter": 1, "payoff_chapter": 2, "importance": "core|major|minor"}], "red_herrings": [...], "ending": {"type": "happy|bittersweet|open|tragic", "summary": "...", "final_state_assertions": ["..."]}, "endgame_requirements": [{"id": "...", "statement": "..."}], "seasons": [{"id": "...", "ordinal": 1, "title": "...", "goal": "...", "entry_state": "...", "exit_state": "...", "chapter_start": 1, "chapter_end": 40, "arcs": [...]}], "promises": [{"id": "...", "statement": "...", "type": "...", "importance": "core|major|minor"}], "hard_requirement_bindings": [{"requirement_id": "...", "binding": "..."}]}