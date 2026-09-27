import { type SerialPlan } from './serial-architecture.js';

/** Synthetic fixture only; production never fills missing authored architecture. */
export function serialPlanFixture(target = 2): SerialPlan {
  return {
    arrival: {
      original_identity: '장부를 고치며 동생의 연락을 기다리던 회계사',
      last_memory: '현관에서 떨어지는 우산 소리',
      first_mismatch: '자기 손이 아닌 손에 남은 낯선 흉터',
      initial_explanation: '누군가 꾸민 꿈이 아닐까 의심한다',
      reality_test: '물에 비친 얼굴과 문밖 명부를 맞춰 본다',
      emotional_cost: '동생에게 답장을 보낼 수 없음을 깨닫는다',
      first_choice: '문밖 사람에게 현재 날짜를 묻는다',
    },
    episodes: [
      {
        season_ordinal: 1,
        chapter_range: { from: 1, to: target },
        title: '장부의 첫 단서',
        entry_state: '낯선 처지에 놓인다',
        objective: '오늘의 잠자리를 지킨다',
        complication: '기록과 사람의 말이 다르다',
        payoff: '모순의 출처를 찾는다',
        exit_state: '증인을 만나기로 한다',
        next_pressure: '증인의 조건을 알아야 한다',
      },
    ],
    opening_chapters: Array.from({ length: Math.min(target, 10) }, (_, i) => ({
      chapter: i + 1,
      entry_state: `진입${i + 1}`,
      central_situation: `상황${i + 1}`,
      reader_discovery: `독자발견${i + 1}`,
      choice: `선택${i + 1}`,
      local_payoff: `보상${i + 1}`,
      exit_state: `결과${i + 1}`,
      next_hook: `절단${i + 1}`,
    })) as SerialPlan['opening_chapters'],
  };
}
