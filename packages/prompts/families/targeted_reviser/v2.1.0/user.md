차원: {{dimension}}

[ISSUES — 해결할 문제]
{{issues}}

[CONTEXT BEFORE — 앞 맥락]
{{context_before}}

[SPAN TO REVISE — 수정할 구간]
{{span_text}}

[CONTEXT AFTER — 뒷 맥락]
{{context_after}}

[MUST PRESERVE — 지켜야 할 사실]
{{must_preserve}}

[REGISTER DIGESTS — 호칭·말투 등록 요약]
{{register_digests}}

길이 예산: 약 {{length_budget_words}}.

{{identity_tail}}

[OUTPUT SCHEMA — 이 JSON 필드를 반환한다. id/from_version_id/issue_ids/reviser_call_id는 워크플로가 채운다]
{"scope": "sentence|paragraph|dialogue|opening|ending|scene", "span": {"start": 문단 시작 code point, "end": 끝 code point, "original_quote": "수정 전 원문"}, "new_text": "수정된 텍스트", "changed_claims": [{"before": "...", "after": "..."}], "preserved_facts_ack": ["유지한 사실"], "speaker_annotations": [...], "dimension": "prose|structure|genre|voice", "regression": false, "attempt": 1}