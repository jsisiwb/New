"""Shared Korean building blocks for the v4 prompt families (ADR-0056: Korean webnovel craft engine).

v4 keeps the v3 variable surfaces and output shapes (the workflow contract) and rewrites the instruction
surface around how Korean serialized webnovels are actually planned and written: the daily 5,000-자 mobile
episode, 초반 25화 funnel, 사이다/고구마 rhythm, 절단, 캐빨 cast design, 떡밥 ledgers and the anti-번역투 /
anti-AI-상투구 diction the language layer lists.
"""
from .common import JSON_RULES, NIB, TAGS, schema  # noqa: F401  (re-exported for the v4 modules)

# The market frame every v4 role shares. Concrete, not a vibe: this is the reader the output must hold.
MARKET = (
    "이 작품은 노벨피아·카카오페이지·문피아·네이버 시리즈에 매일 한 화(공백 포함 약 5,000~5,500자)씩 올라가는 "
    "한국 남성향 연재 웹소설이다. 독자는 출퇴근길 휴대폰으로 읽고, 매 화 끝에서 ‘다음 화’를 누를지 결정한다. "
    "초반 25화 무료 구간에서 선작·연독률이 갈리고, 한 화라도 지루하면 댓글에 ‘하차’가 달린다."
)

# Platform-neutral serial frame for the chapter-stage families: audience and genre specifics (남성향 하렘,
# 로판 …) come from the project's identity layers, so one family serves every Korean project.
MARKET_SERIAL = (
    "이 작품은 노벨피아·카카오페이지·문피아·네이버 시리즈 같은 플랫폼에 매일 한 화(공백 포함 약 5,000~5,500자)씩 올라가는 "
    "한국 연재 웹소설이다. 독자는 휴대폰으로 읽고, 매 화 끝에서 ‘다음 화’를 누를지 결정한다. "
    "한 화라도 지루하면 댓글에 ‘하차’가 달린다."
)

WEST_OFF = (
    "서구식 3막 구조, 영웅의 여정, 테마 중심 설계, 예언과 선택받은 자의 장엄한 서사, 세계관 연대기, 느린 여정물의 호흡을 "
    "쓰지 않는다. 대신 한국 웹소설의 에피소드 엔진(무시→역전, 갑질→응징, 위기→각성, 떡밥→회수, 오해→착각 코미디, 경쟁→서열 상승)으로 설계한다."
)

def plan_rules(market: str) -> str:
    return f"""기획 원칙:
- {market}
- 한 화 = 핵심 사건 하나 + 로컬 보상(사이다·폭로·감정의 한 걸음·성장 확인·웃음) 하나 이상 + 다음 화를 누르게 만드는 절단 하나.
- 고구마(답답함)는 최대 2화 연속, 사이다는 늦어도 3화 안에 온다. 사이다는 주변 인물의 반응(경악·오해·인정)으로 증폭된다.
- 주인공은 목표가 분명하고 능동적이다. 답답하게 참기만 하거나, 착하기만 해서 손해 보는 전개를 오래 끌지 않는다. 약점은 있되 무능하지 않다.
- 캐릭터는 ‘캐빨’이 되어야 한다: 한눈에 들어오는 외모 포인트, 말투, 욕망, 사연이 선명하다.
- {WEST_OFF}"""


PLAN_RULES = plan_rules(MARKET)
PLAN_RULES_SERIAL = plan_rules(MARKET_SERIAL)

DESIGN_V4 = f"""공통 규칙:
{JSON_RULES}
- 스펙·콘셉트·앞 단계 설계와 모순되지 않게 설계한다. 비어 있는 부분은 장르 관습에 맞게 구체적으로 채우되, 스펙이 정한 것은 바꾸지 않는다.
- ‘다양한’, ‘여러 가지’, ‘특별한 힘’, ‘복잡한 과거’ 같은 뭉뚱그린 표현을 쓰지 않는다. 이름, 숫자, 조건, 대가, 회차를 적는다.
- 서술 값은 한국 웹소설 기획서의 문장으로 쓴다. 영어 표현이나 번역 투 문장을 섞지 않는다.
{TAGS}"""

COMMON_V4 = f"""공통 규칙:
{JSON_RULES}
- 설정을 지어내지 않는다. 이야기 상태에 관한 주장은 모두 주어진 맥락에서 나와야 하고, 불확실하면 불확실하다고 적는다.
{TAGS}"""

# The prose-side contract every manuscript-producing v4 role shares.
PROSE_RULES = """원고 원칙:
- 처음부터 한국어로 생각하고 한국어로 쓴다. 영어로 구상해 옮긴 듯한 문장, 번역 소설의 말투, 순문학의 관조를 쓰지 않는다.
- 문단은 한두 문장. 세 문장을 넘는 서술 문단은 쪼갠다. 강조할 문장, 반전, 충격은 한 줄 문단으로 떼어 놓는다. 문단 사이는 빈 줄 하나.
- 비트를 빠르게 돌린다: 행동 → 반응 → 속마음(‘ ’) → 대사. 서술 세 문장이 이어지면 대사나 반응을 끼운다.
- 설명은 행동·대사·상태창·짧은 속마음 안에서만 한다. 세계관·역사·마법 이론을 문단째로 풀지 않는다.
- ‘그’·‘그녀’를 쓰지 말고 이름·호칭을 쓰거나 주어를 생략한다. 대사마다 ‘~가 말했다’를 붙이지 않는다(누가 말하는지는 말투와 앞뒤 행동으로 드러낸다).
- 감정은 이름 붙이지 않고 몸의 반응·행동·짧은 속마음으로 보여 준다. 비유는 회차 전체에 서너 번까지.
- 대사는 짧게 주고받는다(한 번에 한두 문장). 인물마다 어미·말버릇·호칭이 다르다.
- 1인칭 주인공 시점이면 서술과 속마음에 주인공의 입말(자조, 짧은 감탄, 속으로 삼키는 욕)이 살짝 묻어난다. 대사는 이 세계 사람의 말투다.
- 상태창·시스템 알림은 대괄호([ ]) 한 줄씩, 보여 줄 이유가 있을 때만.
- 금지: 날씨·풍경으로 여는 도입, 잠에서 깨는 일상 루틴, 장면 끝의 교훈·요약·관조(‘그렇게 하루가 저물었다’, ‘이것은 시작에 불과했다’, ‘세상은 원래 ~’), 형용사 세 개 이상 쌓기, 문단마다 붙는 비유, ‘알 수 없는 감정’·‘시간이 멈춘 듯’ 같은 상투구, 마크다운·제목·장면 번호·작가 메모."""

JUDGE_FRAME = (
    "당신은 노벨피아·카카오페이지 연재작을 매일 검수하는 한국 웹소설 편집자다. 독자가 이 화를 끝까지 읽고 다음 화를 누를지, "
    "댓글에 ‘번역체 같다’, ‘AI가 쓴 것 같다’, ‘전개 느리다’가 달릴지를 기준으로 본다. 점수보다 근거가 먼저다."
)
