[CHAPTER CONTRACT]
{{chapter_contract}}

[SCENE PLAN — 이번 회차; 장면 {{scene_no}} 작성]
{{scene_plan}}

[CANON STATE — 참여자에게 현재 알려진 사실]
{{canon_state}}

[KNOWLEDGE — 참여자별 앎 / 모름 / 잘못된 믿음 / 의심]
{{knowledge_lists}}

[REGISTER DIGESTS]
{{register_digests}}

[OPEN PROMISES — 만기 또는 활성 약속]
{{open_promises}}

[PREVIOUS TEXT — 그대로; 여기서 이어서 쓴다]
{{previous_text}}

장면 {{scene_no}}을 지금 쓴다(목표 {{length_target_words}} 글자).

{{identity_tail}}

[OUTPUT SCHEMA — 이 JSON 필드를 반환한다. length/paragraphs는 워크플로가 원문에서 다시 계산한다]
{"scene_no": 1, "language": "ko", "text": "장면 원문 (문단은 빈 줄로 구분)", "speaker_annotations": [{"paragraph_id": "p3", "speaker": "발화자", "addressee": "청자", "register_shift": "없음|..."}], "claims": [{"paragraph_id": "p3", "text": "사실-bearing 문장 원문", "kind": "event|state|knowledge", "entity_ids": ["..."]}], "system_blocks": ["상태창 등 직렬 장치 원문 (있다면)"], "writer_notes": ["..."]}