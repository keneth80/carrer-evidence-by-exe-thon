// 직무별 문장 패턴 라이브러리(DECISIONS S4-15). 대화 수정과 1차 점검이 '형식'의 참고로 쓴다.
// - 예시는 모두 합성이다. 실제 사람의 이력서를 수집하지 않는다(개인정보·저작권·품질 문제, 사용자 결정).
// - 나은 문장에는 원문에 없는 수치·성과를 넣지 않는다. 수치는 근거가 있을 때만 쓴다는 원칙을 함께 보여준다.
// - 이 패키지는 node 전용 모듈을 쓰지 않는다(웹 화면 점검에서도 쓴다).

// 2026-11-21: 개발 외 직군(영업·마케팅·인사·재무·운영/CS)을 더하고, 직군마다 '서류 검토자가 확인하는 것'(focus)을 넣었다
// (사용자 요청 "다른 직군 이력서의 필수·좋은 내용을 검색해 HR 전문가에게 학습", 웹 조사·출처는 DECISIONS S1-26).
// focus의 지표는 '있으면 보이게, 없으면 묻는' 항목이다. 근거 없는 수치를 만들라는 뜻이 아니다.
export type RoleFamily = 'frontend' | 'backend' | 'data' | 'design' | 'product' | 'sales' | 'marketing' | 'hr' | 'finance' | 'operations' | 'general';
export type PatternExample = { weak: string; better: string; why: string };
export type RolePatterns = { family: RoleFamily; label: string; principles: string[]; focus?: string[]; examples: PatternExample[] };

const COMMON_PRINCIPLES = [
  '한 문장에 한 가지 일: 무엇을(대상) · 어떻게(방법·기술) · 결과(근거가 있을 때만) 순서로 쓴다.',
  '맡은 범위를 정확히 쓴다: 직접 한 일과 함께 한 일을 구분하고, 확인되지 않은 리딩·총괄 표현을 쓰지 않는다.',
  '평가어(뛰어난, 성공적으로)와 다짐(열정, 최선)을 빼고 사실 동사(구현했습니다, 정리했습니다, 맡았습니다)로 끝낸다.',
];

export const ROLE_PATTERNS: Record<RoleFamily, RolePatterns> = {
  frontend: {
    family: 'frontend', label: '프론트엔드',
    principles: [...COMMON_PRINCIPLES, '화면·기능 이름과 사용한 프레임워크를 함께 쓴다. 성능 개선은 측정 기록이 있을 때만 수치로 쓴다.'],
    focus: ['만든 화면·기능, 사용한 프레임워크, 해결한 문제(성능·접근성·호환성)와 그 과정', '측정 기록이 있으면 로딩 시간·오류율 같은 전후 변화'],
    examples: [
      { weak: '프론트엔드 개발을 열심히 했습니다.', better: '운영 대시보드의 검색·목록·상세 화면을 React와 TypeScript로 구현했습니다.', why: '무엇을(화면)과 어떻게(기술)를 밝혔다.' },
      { weak: '협업 능력이 뛰어납니다.', better: '공통 컴포넌트 사용 기준을 정리해 디자이너와 함께 검토했습니다.', why: '성향 대신 함께 한 일을 썼다.' },
      { weak: '성능을 크게 개선했습니다.', better: '목록 화면에서 불필요한 다시 그리기를 줄이는 작업을 했습니다.', why: '측정 수치가 없으면 한 일만 쓴다.' },
    ],
  },
  backend: {
    family: 'backend', label: '백엔드',
    principles: [...COMMON_PRINCIPLES, 'API·작업·데이터 흐름 단위로 쓰고, 사용한 언어·프레임워크·인프라를 함께 쓴다. 트래픽·처리량은 기록이 있을 때만 쓴다.'],
    focus: ['맡은 API·서비스·데이터 흐름과 언어·프레임워크·인프라', '장애 대응·성능 개선 같은 문제 해결 과정, 기록이 있으면 처리량·응답 시간·비용 변화'],
    examples: [
      { weak: '대규모 시스템을 성공적으로 구축했습니다.', better: '주문 이벤트를 큐로 받아 처리하는 작업자 함수를 Python으로 작성했습니다.', why: '규모 형용사 대신 만든 구성 요소를 썼다.' },
      { weak: 'API 개발 전반을 담당했습니다.', better: '결제 내역 조회 API의 설계와 구현을 맡았습니다.', why: '전반 대신 맡은 API를 특정했다.' },
      { weak: '안정적인 서비스 운영에 기여했습니다.', better: '배포 전 점검 목록을 만들어 팀 배포 절차에 넣었습니다.', why: '기여 대신 실제로 만든 것을 썼다.' },
    ],
  },
  data: {
    family: 'data', label: '데이터·ML',
    principles: [...COMMON_PRINCIPLES, '데이터·지표·모델 이름과 분석 목적을 쓴다. 정확도·효과 수치는 실험 기록이 있을 때만 쓴다.'],
    focus: ['다룬 데이터·지표·모델과 분석 목적', '분석·모델이 바꾼 의사결정이나 업무, 기록이 있으면 정확도·효과 수치'],
    examples: [
      { weak: '데이터 기반 의사결정에 기여했습니다.', better: '주간 이탈 지표를 SQL로 집계하는 대시보드를 만들었습니다.', why: '무엇을 집계했는지 밝혔다.' },
      { weak: '혁신적인 추천 모델을 개발했습니다.', better: '구매 이력으로 상품을 추천하는 모델의 학습 파이프라인을 작성했습니다.', why: '평가어 대신 만든 단계를 썼다.' },
    ],
  },
  design: {
    family: 'design', label: '디자인',
    principles: [...COMMON_PRINCIPLES, '맡은 화면·흐름과 산출물(시안, 디자인 시스템, 사용성 테스트)을 쓴다.'],
    focus: ['포트폴리오 링크가 위쪽에 보이는지(없으면 있는지 묻는다)', '맡은 화면·흐름, 사용 도구(Figma 등), 작업 유형과 디자인 배경·결과의 연결'],
    examples: [
      { weak: '사용자 중심의 탁월한 디자인을 했습니다.', better: '회원가입 흐름을 다시 설계하고 사용성 테스트 결과를 정리했습니다.', why: '평가어 대신 한 일과 산출물을 썼다.' },
      { weak: '디자인 시스템 구축을 주도했습니다.', better: '버튼·입력 컴포넌트의 디자인 기준 문서를 작성했습니다.', why: '확인되지 않은 주도 대신 맡은 범위를 썼다.' },
    ],
  },
  product: {
    family: 'product', label: '기획·PM',
    principles: [...COMMON_PRINCIPLES, '정의한 문제·작성한 문서·조율한 대상을 쓴다. 성과 지표는 측정 기록이 있을 때만 쓴다.'],
    focus: ['기능 목록보다 정의한 문제·판단·우선순위 근거', '기록이 있으면 채택률·전환율·참여·매출 같은 결과 지표의 시작값과 변화'],
    examples: [
      { weak: '프로젝트를 성공적으로 이끌었습니다.', better: '정산 기능의 요구사항 문서를 작성하고 개발·운영팀과 일정을 조율했습니다.', why: '결과 평가 대신 한 일을 썼다.' },
      { weak: '사용자 경험을 극대화했습니다.', better: '고객 문의 유형을 분류해 다음 분기 개선 목록을 만들었습니다.', why: '목표 대신 실제 산출물을 썼다.' },
    ],
  },
  sales: {
    family: 'sales', label: '영업',
    principles: [...COMMON_PRINCIPLES, '맡은 고객군·상품·영업 단계(발굴·제안·협상·계약·관리)를 쓴다. 매출·달성률은 기록이 있을 때만 쓴다.'],
    focus: ['검토자가 짧게 훑으므로 실적이 위쪽에서 바로 보이는지', '기록이 있으면 매출·목표 달성률·신규 고객 수·계약 규모·재계약률'],
    examples: [
      { weak: '영업 전반을 담당했습니다.', better: '중견 제조사 고객의 신규 계약 제안서를 작성하고 가격 협상을 맡았습니다.', why: '전반 대신 맡은 고객과 영업 단계를 썼다.' },
      { weak: '매출 성장에 크게 기여했습니다.', better: '기존 고객의 재계약 일정을 관리하는 목록을 만들어 분기마다 점검했습니다.', why: '기여 대신 한 일을 썼고, 매출 수치는 기록이 있을 때만 쓴다.' },
    ],
  },
  marketing: {
    family: 'marketing', label: '마케팅',
    principles: [...COMMON_PRINCIPLES, '맡은 채널·캠페인·대상 고객과 사용한 도구를 쓴다. 성과 지표는 측정 기록이 있을 때만 쓴다.'],
    focus: ['캠페인·채널별로 무엇을 했는지와 사용 도구(광고 관리자, 웹 분석 도구 등)', '기록이 있으면 클릭률·전환율·광고 수익률·유입·팔로워 증가 같은 결과 지표', '공고에 쓰인 직무 용어(SEO, 콘텐츠 전략, 퍼포먼스 등)와 같은 뜻의 경험'],
    examples: [
      { weak: '마케팅 캠페인 전반을 담당했습니다.', better: '신규 회원 대상 검색 광고 캠페인의 키워드와 예산 배분을 관리했습니다.', why: '전반 대신 채널과 맡은 일을 썼다.' },
      { weak: '브랜드 인지도 향상에 기여했습니다.', better: '브랜드 계정의 주간 콘텐츠 일정을 세우고 게시물 반응을 웹 분석 도구로 집계했습니다.', why: '기여 대신 한 일과 도구를 썼다.' },
    ],
  },
  hr: {
    family: 'hr', label: '인사',
    principles: [...COMMON_PRINCIPLES, '맡은 인사 영역(채용·평가·보상·교육·조직문화·노무)과 대상 조직을 쓴다. 효과 수치는 기록이 있을 때만 쓴다.'],
    focus: ['채용·평가·조직문화 등 주요 프로젝트와 사업·조직 문제의 연결', '기록이 있으면 채용 기간·충원 수·이직률·교육 참여율 같은 데이터'],
    examples: [
      { weak: '인사 업무 전반을 담당했습니다.', better: '개발 직군 채용 공고 작성과 면접 일정 조율을 맡았습니다.', why: '전반 대신 맡은 영역과 일을 썼다.' },
      { weak: '조직문화 개선을 주도했습니다.', better: '퇴사자 면담 내용을 분류해 온보딩 개선 항목을 정리했습니다.', why: '확인되지 않은 주도 대신 실제 산출물을 썼다.' },
    ],
  },
  finance: {
    family: 'finance', label: '재무·회계',
    principles: [...COMMON_PRINCIPLES, '맡은 업무(결산·세무·예산·자금·감사·예측)와 대상 범위를 쓴다. 금액·절감 효과는 기록이 있을 때만 쓴다.'],
    focus: ['직무마다 보는 것이 다르다(자금·예산 예측·감사 등): 공고 직무와 같은 업무가 보이는지', '관련 자격(공인회계사·세무사·CMA·CFA 등)이 잘 보이는 자리에 있는지', '기록이 있으면 다룬 예산·결산 규모, 마감 기간 단축, 비용 절감 금액'],
    examples: [
      { weak: '재무 업무 전반을 담당했습니다.', better: '월 결산 자료를 작성하고 부서별 예산 대비 실적 차이를 분석했습니다.', why: '전반 대신 맡은 업무를 썼다.' },
      { weak: '비용 절감에 크게 기여했습니다.', better: '거래처별 지급 조건을 비교한 자료를 만들어 재계약 검토에 썼습니다.', why: '기여 대신 만든 자료와 쓰임을 썼다.' },
    ],
  },
  operations: {
    family: 'operations', label: '운영·고객지원',
    principles: [...COMMON_PRINCIPLES, '맡은 운영 범위(고객 문의·물류·구매·서비스 운영)와 팀 규모, 바꾼 절차를 쓴다. 지표는 기록이 있을 때만 쓴다.'],
    focus: ['바꾼 절차·도구와 그 이유(프로세스 개선)', '기록이 있으면 고객 만족도·추천 지수·1차 해결률·평균 처리 시간·SLA 준수율의 전후 변화'],
    examples: [
      { weak: '고객 만족도 향상에 기여했습니다.', better: '반복 문의 유형을 정리해 상담 답변 가이드를 만들었습니다.', why: '기여 대신 만든 것을 썼다.' },
      { weak: '운영 업무 전반을 담당했습니다.', better: '입고·출고 일정표를 관리하고 지연 건을 담당 부서에 전달했습니다.', why: '전반 대신 맡은 일을 특정했다.' },
    ],
  },
  general: {
    family: 'general', label: '공통',
    principles: COMMON_PRINCIPLES,
    focus: ['회사마다 맡은 업무와 결과가 함께 보이는지', '공고 직무 요강과 이어지는 경험이 앞에 오는지'],
    examples: [
      { weak: '다양한 경험을 바탕으로 성장했습니다.', better: '고객 문의 응대 절차를 문서로 정리해 팀 공용 자료로 만들었습니다.', why: '경험의 내용을 특정했다.' },
      { weak: '책임감 있게 업무를 수행했습니다.', better: '월말 정산 자료를 확인하고 오류 항목을 담당자에게 전달했습니다.', why: '성향 대신 맡은 일을 썼다.' },
    ],
  },
};

const FAMILY_SIGNALS: [RoleFamily, RegExp][] = [
  ['frontend', /프론트|front|react|vue|angular|next\.?js|웹\s*퍼블리|ui\s*개발/i],
  ['backend', /백엔드|back-?end|서버|server|spring|django|fastapi|node\.?js|java\b|golang|\bgo\b|kotlin/i],
  ['data', /데이터|data|머신\s*러닝|machine learning|\bml\b|\bai\b|분석|analyst|scientist/i],
  ['design', /디자이너|디자인|designer|\bux\b|figma/i],
  ['product', /기획|\bpm\b|\bpo\b|product manager|프로덕트\s*매니저|서비스\s*기획/i],
  ['sales', /영업|세일즈|sales|business development|사업\s*개발|account (executive|manager)|어카운트\s*매니저/i],
  ['marketing', /마케팅|마케터|marketing|marketer|그로스|퍼포먼스|브랜딩|\bseo\b|광고\s*운영|콘텐츠\s*(기획|마케팅)/i],
  // '인사이트'는 인사 직군이 아니다. 공고 제목에 흔한 '채용' 단어만으로는 고르지 않는다.
  ['hr', /인사(?!이트)|\bhr\b|\bhrbp\b|people\s*(team|ops|operations|partner)|리크루터|recruiter|talent acquisition|채용\s*담당|노무|조직\s*문화/i],
  ['finance', /재무|회계|세무|finance|financial|accounting|accountant|fp&a|자금|결산|\bcpa\b|내부\s*감사|treasury/i],
  ['operations', /고객\s*(지원|상담|경험|센터|성공)|\bcs\b|\bcx\b|customer (service|support|success)|물류|\bscm\b|구매|운영\s*(관리|매니저|담당)|operations/i],
];

// 직무 문장·공고 제목에서 가장 많이 맞는 직무군을 고른다. 없으면 공통.
export function roleFamilyOf(texts: string[]): RoleFamily {
  const joined = texts.join('\n');
  let best: { family: RoleFamily; hits: number } = { family: 'general', hits: 0 };
  for (const [family, pattern] of FAMILY_SIGNALS) {
    const hits = [...joined.matchAll(new RegExp(pattern.source, 'gi'))].length;
    if (hits > best.hits) best = { family, hits };
  }
  return best.family;
}

export function patternsFor(texts: string[]): RolePatterns {
  return ROLE_PATTERNS[roleFamilyOf(texts)];
}

// live 모델 지시문용 문단. 예시는 형식만 참고하고 내용(회사·기술·업무)은 가져오지 않게 한다.
export function patternGuidance(patterns: RolePatterns): string {
  return [
    `참고 문장 패턴(${patterns.label}, 합성 예시 — 형식만 참고하고 예시의 회사·기술·업무 내용은 절대 가져오지 않는다):`,
    ...patterns.principles.map(line => `- ${line}`),
    // 테스트·이전 호출자가 만든 패턴 객체에는 focus가 없을 수 있다.
    ...(patterns.focus?.length ? [`서류 검토자가 이 직군에서 확인하는 것(근거에 있으면 잘 보이게, 없으면 지어내지 말고 질문으로만 묻는다):`, ...patterns.focus.map(line => `- ${line}`)] : []),
    ...patterns.examples.map(item => `- 약함: "${item.weak}" → 나음: "${item.better}" (${item.why})`),
  ].join('\n');
}
