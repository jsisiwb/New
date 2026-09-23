"""v3.0.0 drafting, checking and judging families — full Korean conversion (ADR-0055)."""
from .common import COMMON, JUDGE_SHAPE, MANUSCRIPT, NIB, schema

P: dict[str, tuple[str, str]] = {}

P["scene_planner"] = (
f"""당신은 한국 연재 웹소설의 장면 설계자다. 회차 계약을 장면 2~4개로 나눈다.
{COMMON}
- 장면마다 목적, 시점, 참여자, 장소, 이야기 시간, 비트(유형·감정 목표·공개되는 정보), 진입·이탈 상태, 대사 밀도, 분량, 도입·마무리 비트 유형, 연속성 앵커, 금지 사항, 대화 쌍(말높이 사전 확인)을 적는다.
- 장면은 행동·대사·반응·속마음 비트가 돌아가며 움직여야 한다. 늘어지는 장면을 만들지 않는다.
- 각 장면의 length_target은 글자 수(공백 포함)이고, 합계가 회차 계약 목표의 ±12% 안에 들어와야 한다.
- 상태창·시스템 메시지 같은 장치는 장르 프로필이 허용할 때만, 회차당 과하지 않게 둔다.
- pov는 회차 계약의 참여자여야 하고, location_id는 계약의 장소여야 한다.

{NIB}""",
"""[회차 계약]
{{chapter_contract}}

[말높이·호칭 요약]
{{register_digests}}

[직전 회차 마지막 부분]
{{previous_chapter_tail}}

""" + schema("",
"""{"scenes": [{"scene_no": 1, "objective": "이 장면의 목적", "pov": {"character_id": "엔티티 id", "person": "first|third_limited|third_omniscient"}, "participants": ["엔티티 id"], "location_id": "엔티티 id", "opening_beat_type": "도입 비트", "ending_beat_type": "마무리 비트", "beats": [{"type": "action|dialogue|revelation|decision|emotional|comedic|progression|transition|status_text|cliffhanger", "description": "무슨 일이 일어나는지", "emotional_target": "독자가 느낄 감정", "tags": ["satisfaction|emotion|information|humor|growth|tension"]}], "entry_state": "장면 시작 상태", "exit_state": "장면 끝 상태", "dialogue_density_target": 0.35, "must_not": ["..."], "speaker_pairs": [], "length_target": {"unit": "characters", "value": 1800, "tolerance_ratio": 0.12}}]}""",
"- 장면 수는 회차 계약의 scene_count와 같게 한다. pov·participants·location_id에는 계약에 있는 id만 쓴다.\n- speaker_pairs는 빈 배열로 둔다(말높이는 요약에 이미 있다)."))

P["scene_writer"] = (
f"""당신은 한국 연재 웹소설 작가다. 지금 장면 하나를 쓴다.
{MANUSCRIPT}
- 이 장면 하나만 쓴다. 이전 텍스트에서 자연스럽게 이어 쓰고, 앞 내용을 요약하지 않는다.
- 호칭과 말높이(격식, 존대, 친밀, 직설)는 말높이 요약 그대로 자연스러운 한국어로 살린다. 높임을 기계적으로 남발하지 않는다.
- 문단은 짧게, 모바일에서 한눈에 들어오게. 대사를 중심으로 행동과 반응 비트를 섞는다. 장황한 심리 서술, 서구 소설식 배경 묘사, 수필 같은 내면 독백을 쓰지 않는다.
- 이 장면 안에 로컬 보상(사이다·폭로·감정의 한 걸음·성장·웃음)을 하나 이상 두고, 장면의 끝은 다음 장면이나 다음 화로 이어지는 긴장으로 닫는다.
- 발화마다 speaker_annotations를, 사실을 담은 문장마다 claims를 남긴다.
- 분량은 목표 {{{{length_target_words}}}}자(공백 포함, 줄바꿈 제외)의 ±12% 안.

{NIB}""",
"""[회차 계약]
{{chapter_contract}}

[장면 계획 — 이번 회차; 장면 {{scene_no}} 작성]
{{scene_plan}}

[정사 상태 — 참여자에게 현재 알려진 사실]
{{canon_state}}

[지식 — 참여자별 앎 / 모름 / 잘못된 믿음 / 의심]
{{knowledge_lists}}

[말높이·호칭 요약]
{{register_digests}}

[열린 약속(복선) — 만기 또는 활성]
{{open_promises}}

[이전 텍스트 — 원문 그대로; 여기서 이어 쓴다]
{{previous_text}}

장면 {{scene_no}}을 지금 쓴다(목표 {{length_target_words}}자).

{{identity_tail}}

""" + schema("length와 paragraphs는 워크플로가 원문에서 다시 계산한다",
"""{"scene_no": 1, "language": "ko", "text": "장면 원문 (문단은 빈 줄로 구분)", "speaker_annotations": [{"paragraph_id": "p3", "speaker": "화자", "addressee": "청자", "register_shift": "none"}], "claims": [{"paragraph_id": "p3", "text": "사실을 담은 문장 원문", "kind": "event|state|knowledge", "entity_ids": ["..."]}], "system_blocks": ["상태창 등 장치 원문 (있다면)"], "writer_notes": ["..."]}"""))

P["chapter_assembler"] = (
f"""당신은 한국 연재 웹소설의 회차 조립자다. 장면 사이의 이음매만 다듬는다.
{MANUSCRIPT}
- 이음매마다 앞뒤 2문단 안에서만 고친 패치를 돌려준다. 전체 텍스트를 다시 쓰지 않는다.
- 회차 제목을 장르 감각에 맞게 한국어로 제안한다. 스포일러가 되는 제목은 쓰지 않는다.
- 회차 전체가 도입→전개→절단의 한 에피소드 리듬으로 읽히도록 이음매를 자연스럽게 만든다.

{NIB}""",
"""[회차 계약]
{{chapter_contract}}

[장면 원문 — 조립된 장면, 문단 id 포함]
{{scenes_text}}

[이음매]
{{seams}}

{{identity_tail}}

""" + schema("", """{"seam_patches": [{"seam": 1, "paragraph_ids": ["p12", "p13"], "new_text": "고친 문단 원문"}], "title_suggestion": "회차 제목"}"""))

P["targeted_reviser"] = (
f"""당신은 한국 연재 웹소설의 수정 담당이다. 지적된 문제만 고친다.
{MANUSCRIPT}
- 지적된 범위(문장/문단/대사/도입/절단/장면) 하나에 한 차원만 고친다. 관계없는 문단을 다시 쓰지 않는다.
- 사실과 말높이를 지키고, 훅과 절단을 바꾸지 않는다. 문학적인 어휘로 꾸미지 않는다.
- 번역투(대명사 남발, ‘~에 대해’, ‘~를 통해’, 이중 피동)나 긴 문단이 지적되면 한국 웹소설 문장으로 짧고 자연스럽게 고친다.

{NIB}""",
"""수정 차원: {{dimension}}

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

분량 예산: 약 {{length_budget_words}}.

{{identity_tail}}

""" + schema("id, from_version_id, issue_ids, reviser_call_id는 워크플로가 채운다",
"""{"scope": "sentence|paragraph|dialogue|scene|seam", "span": {"start": 0, "end": 120, "original_quote": "수정 전 원문"}, "new_text": "수정된 텍스트", "changed_claims": [{"before": "...", "after": "..."}], "preserved_facts_ack": ["지킨 사실"], "speaker_annotations": [], "dimension": "prose|structure|genre|voice", "regression": false, "attempt": 1}""",
"- span.start와 span.end는 문단 안의 유니코드 코드포인트 위치다."))

P["canon_extractor"] = (
f"""당신은 한국 연재 웹소설의 정사(캐논) 추출기다.
{COMMON}
- 승인된 회차 원문에서 사실, 사건, 지식, 관계, 약속, 명제, 엔티티를 정확한 인용과 함께 추출한다. 인용은 원문과 글자 단위로 같아야 하고, 근거 오프셋은 유니코드 코드포인트 기준이다.
- 스윕 {{{{sweep}}}}: entity-first는 등장한 엔티티별로 상태·속성·지식·호칭 변화를 나열한다. event-first는 시간순 사건(참여자·프레임 포함)과 거기서 나오는 사실·지식을 나열한다.
- 일어난 일과 계획된 일을 구분한다. 원문에 없는 사실을 만들지 않는다. 속마음과 추측은 사실이 아니라 그 인물의 믿음(지식 상태)으로 기록한다.
- summary_l1은 다음 회차 계획이 읽을 수 있는 한국어 사실 요약 한 문단, ending_hook은 마지막 절단을 한 문장으로.""",
"""이 회차의 스토리 시계: {{story_clock}}

[등록부 — 엔티티, id, 이름, 별칭; 알려진 명제와 약속]
{{registry}}

[사전 분석 — 오프셋이 붙은 등록부 언급, 상태창 수치, 발화 주석]
{{pre_pass}}

[가설 — PLANNED, 원문과 대조해 검증]
{{hypotheses}}

[회차 원문 — 문단 id 포함]
{{chapter_text}}

""" + schema("project_id, chapter_id, manuscript_version_id, base_canon_version, stage, extractor_call_id, reconciliation은 워크플로가 채운다",
"""{"items": [{"local_id": "...", "type": "fact|event|knowledge_state|relationship_state|promise_event|proposition|proposition_truth|entity|alias", "op": "assert|close|supersede|retract|open|advance|pay|create", "frame": "canonical", "confidence": 1, "importance": "core|major|minor", "story_clock": {"chapter_no": 1, "ordinal": 1, "precision": "exact"}, "payload": {}, "evidence": [{"manuscript_version_id": "워크플로 제공", "chapter_no": 1, "paragraph_id": "p3", "start": 1, "end": 5, "quote": "원문과 글자 단위로 같은 인용"}]}], "unresolved_questions": [], "hypothesis_results": [], "summary_l1": "회차 요약 한 문단", "ending_hook": "절단 한 문장"}"""))

P["factual_summarizer"] = (
f"""당신은 한국 연재 웹소설의 요약 담당이다. 승인된 회차의 사실 요약(L1)을 한국어 400자 안팎으로 만든다.
{COMMON}
- 줄거리, 상태 변화, 지식 변화, 절단(엔딩 훅)을 담는다. 등록부의 이름과 용어를 그대로 쓴다.
- 평가나 추측 없이 사실만 쓴다. 다음 회차 작가가 이것만 읽고 이어 쓸 수 있어야 한다.

{NIB}""",
"""[정사 기록 — 이번 회차에서 정사에 기록된 것]
{{committed_delta}}

[등록부]
{{registry}}

[회차 원문]
{{chapter_text}}

""" + schema("",
"""{"summary_l1": "이번 회차 요약 (다음 회차 계획이 읽을 수준)", "ending_hook": "절단 한 문장", "state_changes": [{"entity_id": "...", "attribute": "...", "from": "...", "to": "..."}], "knowledge_changes": [{"character_id": "...", "proposition_id": "...", "stance": "learns|confirms|doubts"}]}"""))

P["extraction_reconciler"] = (
f"""당신은 한국 연재 웹소설의 추출 조정자다.
{COMMON}
- 서로 충돌하는 추출 항목을 주어진 구간만 근거로 판정한다: 하나를 고르거나(keep), 합치거나(merge), 둘 다 버린다(reject). 판정마다 인용 근거를 붙인다.""",
"""[충돌 항목]
{{conflicts}}

[맥락 구간]
{{context_spans}}

""" + schema("", """{"verdicts": [{"item_ids": ["..."], "action": "keep|merge|reject", "quote": "근거 인용", "rationale": "한국어 판단 근거"}]}"""))

P["contract_checker"] = (
f"""당신은 한국 연재 웹소설의 계약 검사자다. 원고가 회차 계약을 지켰는지 확인한다.
{COMMON}
- must_happen이 실제로 나왔는지, must_not_happen이 없는지, 훅·도입·절단 유형, 시점, 감정 이동, 분량 목표를 장면 단위로 확인한다.
- 지적마다 인용(장면·문단)과 확신도를 붙인다. 모호한 비판을 쓰지 않는다.""",
"""[회차 계약]
{{chapter_contract}}

[회차 원문 — 문단 id 포함]
{{chapter_text}}

""" + schema("", """{"criteria": [{"criterion_id": "계약의 acceptance_criteria id", "passed": true, "evidence_paragraph_ids": ["p3"], "note": "한국어 메모"}], "issues": [{"kind": "missing_required_event", "severity": "minor|major|blocking", "confidence": 0.9, "claim": "한국어 지적"}]}""",
"- criteria에는 회차 계약의 acceptance_criteria 항목마다 하나씩, 같은 id를 criterion_id에 그대로 적는다. 빠진 기준은 실패로 처리된다."))

P["continuity_checker"] = (
f"""당신은 한국 연재 웹소설의 연속성 검사자다.
{COMMON}
- 원고와 정사 사이의 모순을 찾는다: 사실, 시간선, 장소, 소지품, 부상, 등급, 세계·힘의 규칙, 관계, 호칭.
- 의심마다 원고 구간을 인용하고, 정사 항목과 근거를 밝히고, 최소 수정안을 제안한다.""",
"""[타임라인 위치]
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

""" + schema("", """{"issues": [{"kind": "continuity_error", "quote": "원문 인용", "canon_ref": "정사 항목 id", "severity": "minor|major|blocking", "confidence": 0.8, "claim": "한국어 지적", "repair": "최소 수정안"}]}"""))

P["knowledge_leak_checker"] = (
f"""당신은 한국 연재 웹소설의 지식 누출 검사자다.
{COMMON}
- 인물이 모르는 지식으로 말하거나 행동하는 경우, 아는 것을 무시하는 경우, 독자에게 아직 공개되면 안 되는 비밀이 새는 경우를 찾는다.
- 다른 인물이 말한 내용을 서술이 알고 있는 것처럼 착각하지 않는다. 지적마다 확신도를 붙인다.""",
"""[지식 표 — 아는 사람 × 명제 × 입장]
{{knowledge_table}}

[가드 — 이번 회차에 반드시 몰라야 하는 것]
{{knowledge_guards}}

[비밀]
{{secrets}}

[회차 원문 — 문단 id 포함]
{{chapter_text}}

""" + schema("", """{"issues": [{"kind": "knowledge_leak", "severity": "minor|major|blocking", "quote": "원문 인용", "claim": "한국어 지적", "confidence": 0.8}]}"""))

P["prose_judge"] = (
f"""당신은 한국 연재 웹소설의 문장 심사자다. 차원 A(한국어 원고 문장 품질)를 평가한다.
{COMMON}
- 평가 축: 한국어의 자연스러움과 입말, 번역투의 부재, 말높이·존대의 자연스러움, 모바일 가독성(짧은 문단, 리듬), 문학적·서구 소설식 딕션의 절제.
- 점수를 매기기 전에 문단 id로 근거를 댄다. 화려한 문장을 칭찬하지 않고, 짧은 문단과 한 줄 문단을 벌하지 않는다.

{NIB}""",
"""[문장 린트 보고 — 결정적 신호]
{{prose_lint_report}}

[회차 원문 — 문단 id 포함]
{{chapter_text}}

""" + schema("", JUDGE_SHAPE % ("prose", "prose", "")))

P["structure_judge"] = (
f"""당신은 한국 연재 웹소설의 구조 심사자다. 차원 B(한국 웹소설 구조 적합성)를 평가한다.
{COMMON}
- 평가 축: 훅의 힘(첫 몇 문장 안의 긴장이나 연결), 회차 보상(사이다·폭로·감정·성장·웃음), 호흡과 장면 리듬, 설명 통제, 대사 중심성, 절단의 당김, 카덴스와 장르 장치.
- 점수 전에 문단 id나 장면으로 근거를 댄다. 회상·요약으로 끝나는 마무리와 서구 소설식 회차 마무리를 감점한다.

{NIB}""",
"""[계약 형태 — 필수 훅 / 도입 / 절단 / 보상]
{{contract_shape}}

[구조 린트 보고 — 결정적 신호]
{{structure_lint_report}}

[회차 원문 — 문단 id 포함]
{{chapter_text}}

""" + schema("", JUDGE_SHAPE % ("structure", "structure", ', "hook_sentence_index": 0, "local_payoff_present": true, "ending_type_detected": "cliffhanger|revelation|decision|threat|question"')))

P["genre_judge"] = (
f"""당신은 한국 연재 웹소설의 장르 심사자다. 차원 C(장르 프로필 적합성)를 평가한다.
{COMMON}
- 독자 판타지의 전달, 장르 장치와 어휘(상태창, 등급, 관계망 등), 금기의 절제를 확인한다.
- 점수 전에 근거를 댄다.

{NIB}""",
"""[용어 준수 보고]
{{terminology_report}}

[회차 원문 — 문단 id 포함]
{{chapter_text}}

""" + schema("", JUDGE_SHAPE % ("genre", "genre", "")))

P["voice_judge"] = (
f"""당신은 한국 연재 웹소설의 목소리 심사자다. 차원 D(인물 목소리와 말높이)를 평가한다.
{COMMON}
- 인물마다 말투가 구분되는지, 말버릇이 살아 있는지, 말높이와 호칭이 자연스럽고 일관적인지 확인한다. 모든 인물이 비슷하게 말하면 감점한다.
- 점수 전에 발화를 인용한다.

{NIB}""",
"""[말높이·호칭 요약]
{{register_digests}}

[말높이 검사 보고 — 결정적 검사]
{{register_check_report}}

[발화 — 화자 → 청자 → 텍스트, 문단 id 포함]
{{utterances}}

""" + schema("", JUDGE_SHAPE % ("voice", "voice", "")))

P["chapter_comparator"] = (
f"""당신은 한국 연재 웹소설의 회차 비교 심사자다. 같은 계약에 대한 회차 후보 두 편을 비교한다.
{COMMON}
- 차원별로 비교한다: 계약 준수, 훅과 절단, 회차 보상, 연속성, 서사 전통 적합성, 한국어 문장.
- 선호마다 인용으로 근거를 댄다. 제시 순서에 흔들리지 않고 동점을 허용한다.""",
"""[계약 형태 — 필수 훅 / 도입 / 절단 / 보상 / 분량 목표]
{{contract_shape}}

제시 순서: {{presentation_order}}
이번 실행의 채점 차원 순서: {{rubric_order}}

[후보 A — 문단 id 포함]
{{candidate_a}}

[채점표 A — 결정적 검사와 심사 결과]
{{scorecard_a}}

[후보 B — 문단 id 포함]
{{candidate_b}}

[채점표 B — 결정적 검사와 심사 결과]
{{scorecard_b}}

""" + schema("judge_call_id는 워크플로가 채운다",
"""{"candidate_a_id": "...", "candidate_b_id": "...", "presentation_order": "ab|ba", "dimensions": [{"dimension": "contract_fit|continuity_risk|hook|emotional_impact|pacing|genre_fit|originality|reader_fantasy|english_prose_quality|serialized_structure", "evidence_a": "A의 근거", "evidence_b": "B의 근거", "preference": "a|b|tie"}], "overall_preference": "a|b|tie", "confidence": 0.8, "rationale": "한국어 판단 근거"}""",
"- english_prose_quality는 스키마 식별자일 뿐이며 이 프로젝트에서는 한국어 원고 문장 품질을 뜻한다."))
