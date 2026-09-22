[STORY SPEC]
{{story_spec}}

[선택된 콘셉트]
{{concept}}

[성경 요약]
{{bible_summary}}

목표 회차 수: {{target_chapters}}

시리즈 청사진을 생성하라.

[OUTPUT SCHEMA — 이 JSON 필드를 반환한다. project_id/version/pinned/foreshadowing_register/시즌과 약속의 id는 워크플로가 채운다]
{"story_promise": "...", "reader_fantasy": "...", "main_conflict": "...", "protagonist_arc": {"start_state": "1화 시점 상태", "end_state": "완결 시점 상태", "turning_points": [{"id": "tp-1", "description": "구체적 전환점", "window": {"from": 1, "to": 5}}]}, "character_arcs": [{"entity_name": "캐릭터 이름", "start_state": "...", "end_state": "...", "turning_points": [...]}], "progression_arc": {"system_summary": "성장 시스템 요약", "milestones": [{"description": "성장 마일스톤", "window": {"from": 10, "to": 20}}], "cadence_chapters": 5}, "ending": {"type": "happy|bittersweet|open|tragic", "summary": "엔딩 요약", "final_state_assertions": ["구체적 최종 상태", "또 하나의 최종 상태"]}, "endgame_requirements": [{"id": "EG-1", "statement": "엔드게임 요구사항", "kind": "fact|knowledge|relationship|promise_paid|progression"}], "seasons": [{"title": "시즌 제목", "objective": "이 시즌의 목표", "thesis": "시즌 핵심 갈등", "entry_state": "시즌 진입 상태", "exit_state": "시즌 이탈 상태", "chapter_range_est": {"from": 1, "to": 50}}], "promises": [{"statement": "약속 서술", "type": "foreshadowing|mystery|chekhov|relationship_beat|character_goal|world_question|running_gag|threat|debt|red_herring", "related_entity_names": ["관련 인물 이름"], "due_min_chapter": 30, "due_max_chapter": 80}]}
- seasons: title과 objective는 비어 있으면 안 된다. chapter_range_est.from/to는 시즌끼리 연속이어야 하고 목표 회차 수 전체를 정확히 덮는다(첫 시즌 from=1, 마지막 시즌 to=N화). 시즌당 40~60화 권장.
- ending.final_state_assertions와 endgame_requirements는 구체적이어야 하고 빈 배열이면 안 된다.