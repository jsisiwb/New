[회차 계약]
{{chapter_contract}}

[회차 원문 — 문단 id 포함]
{{chapter_text}}

[출력 스키마 — 이 JSON 필드를 반환한다]
{"criteria": [{"criterion_id": "계약의 acceptance_criteria id", "passed": true, "evidence_paragraph_ids": ["p3"], "note": "한국어 메모"}], "issues": [{"kind": "missing_required_event", "severity": "minor|major|blocking", "confidence": 0.9, "claim": "한국어 지적"}]}
- criteria에는 회차 계약의 acceptance_criteria 항목마다 하나씩, 같은 id를 criterion_id에 그대로 적는다. 빠진 기준은 실패로 처리된다.