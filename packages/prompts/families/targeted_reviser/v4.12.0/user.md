수정 차원: {{dimension}}

[해결할 문제]
{{issues}}

[앞 맥락]
{{context_before}}

[수정할 구간]
{{span_text}}

[뒷 맥락]
{{context_after}}

[반드시 지킬 사실]
{{must_preserve}}

[말높이·호칭 요약]
{{register_digests}}

[수정할 구간] 분량: 약 {{length_budget_words}}어절. 고친 글은 고치는 부분의 원래 길이와 비슷하게 쓴다.

{{identity_tail}}

[출력 스키마 — 이 JSON 필드를 반환한다. id, from_version_id, issue_ids, reviser_call_id, dimension, span의 start·end, regression은 워크플로가 채운다]
{"scope": "sentence|paragraph|dialogue|scene|seam", "span": {"original_quote": "[수정할 구간]에서 고칠 부분을 한 글자도 바꾸지 않고 그대로 옮긴 원문"}, "new_text": "original_quote 자리에 들어갈 고친 원고", "changed_claims": [], "preserved_facts_ack": [], "speaker_annotations": []}
- span.original_quote는 [수정할 구간] 안의 연속된 원문을 띄어쓰기·문장부호까지 그대로 옮긴다. 위치 숫자(start·end)는 세지 않는다. 워크플로가 이 인용으로 위치를 찾는다.
- 고칠 곳이 여러 군데로 흩어져 있으면 그곳들을 모두 포함하는 가장 짧은 연속 구간 하나를 original_quote로 잡는다.
- [수정할 구간] 전체를 고쳐 써야 하면 span을 빼고, new_text에 구간 전체를 고친 글을 쓴다. 빼먹은 문단이 없어야 한다.
- changed_claims는 이야기 속 사실(누가·무엇을·어디서·얼마나)이 바뀐 경우만 한 줄 문자열로 적는다. 문장만 다듬었으면 빈 배열이다.
- preserved_facts_ack에는 [반드시 지킬 사실]에 적힌 id를 하나도 빠짐없이 글자 그대로 적는다. 적힌 id가 없으면 빈 배열이다.