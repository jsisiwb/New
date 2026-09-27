[인테이크 JSON]
{{intake_json}}

철자 로케일: {{spelling_locale}}

지금 스토리 스펙 항목을 만든다.

[출력 스키마 — 이 JSON 필드를 반환한다. 워크플로가 채우는 필드: project_id, version]
{"items": [{"id": "REQ-001", "kind": "hard|soft|assumption", "category": "genre|premise|character|world|progression|romance|tone|ending|structure|length|mandatory_scene|forbidden_development|content_restriction|style|audience|direction|other", "text": "작가의 원문 또는 한국어 요구 문장", "language": "ko", "provenance": "user|system_default|model_inferred", "confirmed_by_user": false, "rationale": "assumption일 때 이렇게 채운 이유", "scope": {"level": "series|season|arc|chapter_range|character|relationship"}}], "conflicts": []}
- confirmed_by_user: hard·soft는 작가가 직접 적은 경우에만 true, assumption은 반드시 false.
- assumption에는 rationale을 반드시 적는다.
- conflicts가 있으면 item_ids에 서로 충돌하는 항목 id를 두 개 이상 적는다. 충돌 없으면 빈 배열이다.
