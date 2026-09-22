[INTAKE json]
{{intake_json}}

철자 로케일: {{spelling_locale}}

지금 Story Spec 항목을 생성하라.

[OUTPUT SCHEMA — 이 JSON 필드를 반환한다. project_id/version은 워크플로가 채운다]
{"items": [{"id": "REQ-001", "kind": "hard|soft|assumption", "category": "genre|premise|character|world|progression|romance|tone|ending|structure|length|mandatory_scene|forbidden_development|content_restriction|style|audience|direction|other", "text": "...", "language": "ko", "provenance": "user|system_default|model_inferred", "confirmed_by_user": true, "scope": {"level": "series|season|arc|chapter_range|character|relationship"}}], "conflicts": [...]}