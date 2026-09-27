[스토리 스펙]
{{story_spec}}

[선택된 콘셉트]
{{concept}}

[설정 요약]
{{bible_summary}}

목표 회차 수: {{target_chapters}}

시리즈 청사진을 만든다.

[출력 스키마 — 이 JSON 필드를 반환한다. 워크플로가 채우는 필드: project_id, version, pinned, foreshadowing_register, seasons[].id, seasons[].ordinal, protagonist_arc.entity_id, character_arcs[].entity_id]
{"story_promise": "...", "reader_fantasy": "...", "main_conflict": "...", "protagonist_arc": {"start_state": "1화 시점 상태", "end_state": "완결 시점 상태", "turning_points": [{"id": "tp-1", "description": "구체적인 전환점", "window": {"from": 1, "to": 5}}]}, "character_arcs": [{"entity_name": "인물 이름", "start_state": "...", "end_state": "...", "turning_points": [{"id": "ctp-1", "description": "...", "window": {"from": 20, "to": 30}}]}], "progression_arc": {"system_summary": "성장 시스템 요약", "milestones": [{"description": "성장 마일스톤", "window": {"from": 10, "to": 20}}], "cadence_chapters": 5}, "ending": {"type": "happy|bittersweet|open|tragic", "summary": "결말 요약", "final_state_assertions": ["구체적인 최종 상태"]}, "endgame_requirements": [{"id": "EG-1", "statement": "엔드게임 요구사항", "kind": "fact|knowledge|relationship|promise_paid|progression"}], "seasons": [{"title": "시즌 제목", "objective": "시즌 목표", "thesis": "시즌 핵심 갈등", "entry_state": "시즌 진입 상태", "exit_state": "시즌 이탈 상태", "chapter_range_est": {"from": 1, "to": 50}}], "promises": [{"statement": "약속(복선) 서술", "type": "foreshadowing|mystery|chekhov|relationship_beat|character_goal|world_question|running_gag|threat|debt|red_herring", "related_entity_names": ["관련 인물 이름"], "due_min_chapter": 30, "due_max_chapter": 80}]}
- seasons: title과 objective는 비울 수 없다. chapter_range_est는 시즌끼리 이어져야 하고 목표 회차 수 전체를 정확히 덮는다(첫 시즌 from=1, 마지막 시즌 to=N). 시즌 길이는 갈등의 인과에 맞춘다.
- ending.final_state_assertions와 endgame_requirements는 구체적으로, 빈 배열 금지.
[추가 출력 필드 — serial_plan은 필수]
"serial_plan": {
  "arrival": {"original_identity": "이전 삶", "last_memory": "마지막 기억", "first_mismatch": "눈앞의 불일치", "initial_explanation": "처음 가설", "reality_test": "확인 행동과 증거", "emotional_cost": "잃을 수 있는 삶의 무게", "first_choice": "확인 후 첫 선택"},
  "episodes": [{"season_ordinal": 1, "chapter_range": {"from": 1, "to": 7}, "title": "첫 에피소드", "entry_state": "도착 직전 상태", "objective": "이번 목표", "complication": "그 목표를 바꾸는 변수", "payoff": "회수할 구체적 보상", "exit_state": "이번 에피소드의 결과", "next_pressure": "다음 에피소드의 원인"}],
  "opening_chapters": [{"chapter": 1, "entry_state": "첫 순간", "central_situation": "하나의 상황", "reader_discovery": "독자가 알게 될 사실", "choice": "이해한 뒤 내리는 선택", "local_payoff": "작은 보상", "exit_state": "선택의 결과", "next_hook": "다음 화로 이어질 순간"}]
}
위 배열은 모양 예시다. episodes는 전체 {{target_chapters}}화, opening_chapters는 1~{{opening_chapters}}화까지 모두 채운다. 모든 서술 필드는 공백 없이 구체적 내용이 있어야 한다. 모델이 내는 serial_plan을 워크플로가 대신 발명하지 않는다.

[이전 청사진 — 수정할 때만 있음]
{{previous_blueprint}}

[설계 검수 피드백]
{{plan_feedback}}
