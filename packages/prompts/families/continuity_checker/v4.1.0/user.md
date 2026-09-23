[타임라인 위치]
{{timeline_position}}

[잠긴 사실]
{{locked_facts}}

[정사 상태 — 참여자, 회차 시작 시점 기준]
{{canon_state}}

[최근 사건]
{{recent_events}}

[세계와 힘의 규칙]
{{world_rules}}

[회차 원문 — 문단 id 포함]
{{chapter_text}}

[출력 스키마 — 이 JSON 필드를 반환한다]
{"issues": [{"kind": "canon_contradiction|timeline_error|location_error|inventory_impossible|injury_forgotten|rank_incorrect|world_rule_violation|power_rule_violation|relationship_inconsistency|numeric_inconsistency|character_inconsistency|other", "quote": "원문 그대로의 짧은 인용", "canon_ref": "정사 항목 id 또는 앞선 문단 id", "severity": "minor|major|blocking", "confidence": 0.8, "claim": "한국어 지적", "repair": {"scope": "sentence|paragraph|dialogue|scene", "suggestion": "최소 수정안"}}]}
- kind는 위에 적힌 값 가운데 하나를 쓰고, 맞는 값이 없을 때만 "other"를 쓴다.
- quote는 원고의 한 문장이나 한 구절을 문단 표시([p3]) 없이 글자 그대로 옮긴다.