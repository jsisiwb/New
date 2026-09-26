# Finding trace — 22 findings in 1 chapters

One row per blocking or major finding an evaluator raised on its own reading (carried findings are copies and get none), and per finding a second reading demoted to minor. `span`: the finding against the same evaluator's last reading of the chapter. `later`: the same finding in later readings of non-quarantined versions. A round marked `?` is counted along the scorecards, not recovered from the scorecard id.

## Chapter 1

| # | round | version | reading | source | severity | kind | span | second reading | later | quote | claim |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | r0 | v1 | full | judge:genre_judge | minor | other | first_reading | dropped_by_second_reading | open_at_end | 소유권 각인 완료. | (두 번째 판독에서 주요 결함으로 재현되지 않음) 시스템 메시지 형식 누락: 시스템 알림은 대괄호([ ])를 사용해야 하나 평서문으로 서술되었습니다. |
| 0 | r0 | v1 | full | judge:voice_judge | minor | character_inconsistency | first_reading | dropped_by_second_reading | fixed | “미, 미친 새끼 아니야, 이거?!” | (두 번째 판독에서 주요 결함으로 재현되지 않음) 오유리는 나긋나긋하고 여유로운 해요체를 쓴다는 캐릭터 카드의 설정과 달리, 시종일관 당황해서 비명을 지르거나 거친 욕설과 섞인 반 |
| 0 | r0 | v1 | full | judge:voice_judge | minor | register_error | first_reading | dropped_by_second_reading | fixed | “당장 나가요! 경찰 부르기 전에 당장 꺼지라고!” | (두 번째 판독에서 주요 결함으로 재현되지 않음) 오유리의 발화에서 감정의 격화를 표현하기 위해 한 문장 안에서 존댓말과 반말(해라체)을 어색하게 혼용하는 AI 특유의 작위적 패턴 |
| 0 | r0 | v1 | full | judge:voice_judge | minor | register_error | first_reading | dropped_by_second_reading | fixed | “귀가 먹은 건 아닐 테고. 얼마면 되냐고 물었어.” | (두 번째 판독에서 주요 결함으로 재현되지 않음) 서태현은 타인에게 무심하게 해요체와 반말을 섞어 쓴다는 설정이지만, 처음 만난 전당포 주인에게 처음부터 끝까지 일관되게 고압적인  |
| 1 | r1 | v2 (quarantined) | targeted | lint | major | length_out_of_range | no_quote | single_reading | fixed | — | 분량 6365자, 목표 5300자 대비 20% |
| 1 | r1 | v2 (quarantined) | targeted | judge:continuity_checker | major | inventory_impossible | passed_unchanged | single_reading | fixed | 나는 뚝뚝 떨어지는 피를 대충 바지에 문질러 닦고는 휴대폰을 꺼냈다. | 환자복을 입고 병실에서 눈을 뜨자마자 깁스를 부수고 곧장 탈출하는 과정(p8~p82)에서 휴대폰이나 지갑을 챙기는 묘사가 없었음에도, 갑자기 주머니에서 스마트폰을 꺼내 백만 원을  |
| 1 | r1 | v2 (quarantined) | targeted | judge:continuity_checker | major | injury_forgotten | passed_unchanged | single_reading | fixed | 나는 뚝뚝 떨어지는 피를 대충 바지에 문질러 닦고는 휴대폰을 꺼냈다. | 앞선 문단(p188)에서는 상처가 철검과 한 몸이 된 것처럼 단단하게 엉겨 붙었다며 지혈과 각인이 완료된 뉘앙스로 서술되었으나, 직후에 여전히 피가 '뚝뚝 떨어지고 있다'고 묘사되 |
| 1 | r1 | v2 (quarantined) | targeted | judge:voice_judge | major | character_inconsistency | passed_unchanged | single_reading | fixed | “그건 당신 사정이고. 경찰 부르기 전에 좋은 말로 할 때 나가시죠.” | 전당포 주인(오유리)의 말투가 '나긋나긋하고 여유로운 해요체'라는 설정과 전혀 다르게 나타난다. 시종일관 신경질적이고 거칠게 반응하며, 지정된 자주 쓰는 단어(견적, 수수료 등)도 |
| 1 | r1 | v2 (quarantined) | targeted | judge:voice_judge | major | register_error | passed_unchanged | single_reading | fixed | “팔십. 아니, 백만 원요. 낼 돈은 있고?” | 여자의 대사에서 감정이 극에 달하기 전인 대화 초반부터 한 발화 내에 반말과 해요체가 불규칙하게 섞여 나오는 오류가 4회 반복된다. |
| 2 | r2 | v3 (quarantined) | targeted | judge:continuity_checker | major | inventory_impossible | re_raised | kept | fixed | 나는 뚝뚝 떨어지는 피를 대충 바지에 문질러 닦고는 휴대폰을 꺼냈다. | 주인공이 환자복 차림으로 깁스를 부수고 간호사를 밀치며 다급히 병실을 빠져나왔는데, 휴대폰과 지갑을 챙기는 묘사가 전혀 없었습니다. 환자복 주머니에서 지갑을 언급하고 휴대폰을 꺼내 |
| 2 | r2 | v3 (quarantined) | targeted | judge:voice_judge | major | register_error | re_raised | kept | fixed | 그건 당신 사정이고. 경찰 부르기 전에 좋은 말로 할 때 나가시죠. | 초면인 상대에게 하는 대사에서 반말과 존댓말이 특별한 감정 변화 없이 섞여 나옵니다. |
| 2 | r2 | v3 (quarantined) | targeted | judge:voice_judge | major | register_error | re_raised | kept | fixed | 팔십. 아니, 백만 원요. 낼 돈은 있고? | 해요체와 해체가 한 발화 안에서 불규칙하게 혼용되어 대사 톤이 일정하지 않습니다. |
| 2 | r2 | v3 (quarantined) | targeted | judge:voice_judge | minor | character_inconsistency | passed_unchanged | dropped_by_second_reading | fixed | 미, 미친 새끼 아니야, 이거?! | (두 번째 판독에서 주요 결함으로 재현되지 않음) 전당포 사장(오유리)이 여유롭고 핵심을 찌르는 설정과 달리, 일반적인 조역처럼 쉽게 당황하고 거친 욕설을 내뱉어 캐릭터성이 약해집 |
| 3 | r3 | v4 | targeted | judge:continuity_checker | minor | other | passed_unchanged | dropped_by_second_reading | open_at_end | 어이, 명월 사장. 문을 이렇게 꽉 잠가두면 쓰나. | (두 번째 판독에서 재현되지 않은 설정 의심) 주인공이 전당포에 들어올 때 문을 거칠게 밀어젖혀 벽에 부딪혔고(p99), 이후 어느 누구도 문을 닫거나 잠그는 행동을 하지 않았습니 |
| 3 | r3 | v4 | targeted | judge:voice_judge | minor | voice_drift | passed_unchanged | dropped_by_second_reading | open_at_end | 미, 미친 새끼 아니야, 이거?! | (두 번째 판독에서 주요 결함으로 재현되지 않음) 전당포 사장(인물 카드 상 오유리로 추정)이 극도의 패닉 상태를 감안하더라도 '나긋나긋하고 핵심을 찌르는 여유'라는 고유의 성격을 |
| 4 | r4 | v5 (quarantined) | targeted | lint | major | length_out_of_range | no_quote | single_reading | open_at_end | — | 분량 6396자, 목표 5300자 대비 21% |
| 4 | r4 | v5 (quarantined) | targeted | judge:voice_judge | major | register_error | passed_unchanged | single_reading | open_at_end | 그건 당신 사정이고. 경찰 부르기 전에 좋은 말로 할 때 나가시죠. | 전당포 주인(오유리)의 대사에서 반말과 존댓말이 명확한 감정적 계기 없이 계속해서 혼용되어 몰입을 깹니다. |
| 4 | r4 | v5 (quarantined) | targeted | judge:voice_judge | major | character_inconsistency | passed_unchanged | single_reading | open_at_end | 당장 나가! 경찰 부르기 전에 당장 꺼지라고! | 설정상 '나긋나긋하고 핵심을 찌르는 여유로운 해요체'를 써야 할 오유리가 시종일관 당황하며 거칠게 욕설을 내뱉어 캐릭터가 붕괴되었습니다. |
| 5 | r5 | v6 (quarantined) | targeted | judge:continuity_checker | minor | other | passed_unchanged | dropped_by_second_reading | open_at_end | 어이, 명월 사장. 문을 이렇게 꽉 잠가두면 쓰나. | (두 번째 판독에서 재현되지 않은 설정 의심) 서태현이 전당포 문을 거칠게 밀어젖히고 들어온 뒤 다시 문을 닫거나 잠갔다는 묘사가 전혀 없으나, 이후 들이닥친 용역이 '문을 꽉 잠 |
| 5 | r5 | v6 (quarantined) | targeted | judge:prose_judge | minor | literary_drift | passed_unchanged | dropped_by_second_reading | open_at_end | 눈을 가늘게 뜨며 | (두 번째 판독에서 주요 결함으로 재현되지 않음) 결정적 린트 보고가 지적했듯, 지시문에서 금지한 표정 상투구('눈을 가늘게 뜨다')가 쓰였습니다. 구체적인 말이나 다른 행동으로  |
| 5 | r5 | v6 (quarantined) | targeted | judge:prose_judge | minor | literary_drift | changed_since_last_reading | dropped_by_second_reading | open_at_end | 끔찍한 고통이 | (두 번째 판독에서 주요 결함으로 재현되지 않음) 결정적 린트 보고가 지적한 감각 상투구('끔찍한 고통이')입니다. 아픈 부위와 몸의 즉각적인 반응으로 풀어써야 합니다. |
| 5 | r5 | v6 (quarantined) | targeted | judge:voice_judge | major | character_inconsistency | passed_unchanged | kept | open_at_end | 미, 미친 새끼 아니야, 이거?! | 오유리가 설정된 '여유롭고 나긋나긋한' 말투를 잃고, 피투성이 남자의 등장에 평범한 엑스트라 NPC처럼 당황하며 '미친 새끼' 등의 욕설을 남발합니다. |

## Summary

| span state | full | targeted | confirmation | total |
| --- | --- | --- | --- | --- |
| first_reading | 4 | 0 | 0 | 4 |
| re_raised | 0 | 3 | 0 | 3 |
| passed_unchanged | 0 | 12 | 0 | 12 |
| changed_since_last_reading | 0 | 1 | 0 | 1 |
| no_quote | 0 | 2 | 0 | 2 |
| total | 4 | 18 | 0 | 22 |

Confirmation-reading findings on text that passed unchanged: 0 of 0; still blocking or major after any second reading: 0 of 0.

