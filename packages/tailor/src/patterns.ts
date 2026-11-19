// 직무별 문장 패턴 라이브러리(DECISIONS S4-15). 대화 수정과 1차 점검이 '형식'의 참고로 쓴다.
// - 예시는 모두 합성이다. 실제 사람의 이력서를 수집하지 않는다(개인정보·저작권·품질 문제, 사용자 결정).
// - 나은 문장에는 원문에 없는 수치·성과를 넣지 않는다. 수치는 근거가 있을 때만 쓴다는 원칙을 함께 보여준다.
// - 이 패키지는 node 전용 모듈을 쓰지 않는다(웹 화면 점검에서도 쓴다).

export type RoleFamily = 'frontend' | 'backend' | 'data' | 'design' | 'product' | 'general';
export type PatternExample = { weak: string; better: string; why: string };
export type RolePatterns = { family: RoleFamily; label: string; principles: string[]; examples: PatternExample[] };

const COMMON_PRINCIPLES = [
  '한 문장에 한 가지 일: 무엇을(대상) · 어떻게(방법·기술) · 결과(근거가 있을 때만) 순서로 쓴다.',
  '맡은 범위를 정확히 쓴다: 직접 한 일과 함께 한 일을 구분하고, 확인되지 않은 리딩·총괄 표현을 쓰지 않는다.',
  '평가어(뛰어난, 성공적으로)와 다짐(열정, 최선)을 빼고 사실 동사(구현했습니다, 정리했습니다, 맡았습니다)로 끝낸다.',
];

export const ROLE_PATTERNS: Record<RoleFamily, RolePatterns> = {
  frontend: {
    family: 'frontend', label: '프론트엔드',
    principles: [...COMMON_PRINCIPLES, '화면·기능 이름과 사용한 프레임워크를 함께 쓴다. 성능 개선은 측정 기록이 있을 때만 수치로 쓴다.'],
    examples: [
      { weak: '프론트엔드 개발을 열심히 했습니다.', better: '운영 대시보드의 검색·목록·상세 화면을 React와 TypeScript로 구현했습니다.', why: '무엇을(화면)과 어떻게(기술)를 밝혔다.' },
      { weak: '협업 능력이 뛰어납니다.', better: '공통 컴포넌트 사용 기준을 정리해 디자이너와 함께 검토했습니다.', why: '성향 대신 함께 한 일을 썼다.' },
      { weak: '성능을 크게 개선했습니다.', better: '목록 화면에서 불필요한 다시 그리기를 줄이는 작업을 했습니다.', why: '측정 수치가 없으면 한 일만 쓴다.' },
    ],
  },
  backend: {
    family: 'backend', label: '백엔드',
    principles: [...COMMON_PRINCIPLES, 'API·작업·데이터 흐름 단위로 쓰고, 사용한 언어·프레임워크·인프라를 함께 쓴다. 트래픽·처리량은 기록이 있을 때만 쓴다.'],
    examples: [
      { weak: '대규모 시스템을 성공적으로 구축했습니다.', better: '주문 이벤트를 큐로 받아 처리하는 작업자 함수를 Python으로 작성했습니다.', why: '규모 형용사 대신 만든 구성 요소를 썼다.' },
      { weak: 'API 개발 전반을 담당했습니다.', better: '결제 내역 조회 API의 설계와 구현을 맡았습니다.', why: '전반 대신 맡은 API를 특정했다.' },
      { weak: '안정적인 서비스 운영에 기여했습니다.', better: '배포 전 점검 목록을 만들어 팀 배포 절차에 넣었습니다.', why: '기여 대신 실제로 만든 것을 썼다.' },
    ],
  },
  data: {
    family: 'data', label: '데이터·ML',
    principles: [...COMMON_PRINCIPLES, '데이터·지표·모델 이름과 분석 목적을 쓴다. 정확도·효과 수치는 실험 기록이 있을 때만 쓴다.'],
    examples: [
      { weak: '데이터 기반 의사결정에 기여했습니다.', better: '주간 이탈 지표를 SQL로 집계하는 대시보드를 만들었습니다.', why: '무엇을 집계했는지 밝혔다.' },
      { weak: '혁신적인 추천 모델을 개발했습니다.', better: '구매 이력으로 상품을 추천하는 모델의 학습 파이프라인을 작성했습니다.', why: '평가어 대신 만든 단계를 썼다.' },
    ],
  },
  design: {
    family: 'design', label: '디자인',
    principles: [...COMMON_PRINCIPLES, '맡은 화면·흐름과 산출물(시안, 디자인 시스템, 사용성 테스트)을 쓴다.'],
    examples: [
      { weak: '사용자 중심의 탁월한 디자인을 했습니다.', better: '회원가입 흐름을 다시 설계하고 사용성 테스트 결과를 정리했습니다.', why: '평가어 대신 한 일과 산출물을 썼다.' },
      { weak: '디자인 시스템 구축을 주도했습니다.', better: '버튼·입력 컴포넌트의 디자인 기준 문서를 작성했습니다.', why: '확인되지 않은 주도 대신 맡은 범위를 썼다.' },
    ],
  },
  product: {
    family: 'product', label: '기획·PM',
    principles: [...COMMON_PRINCIPLES, '정의한 문제·작성한 문서·조율한 대상을 쓴다. 성과 지표는 측정 기록이 있을 때만 쓴다.'],
    examples: [
      { weak: '프로젝트를 성공적으로 이끌었습니다.', better: '정산 기능의 요구사항 문서를 작성하고 개발·운영팀과 일정을 조율했습니다.', why: '결과 평가 대신 한 일을 썼다.' },
      { weak: '사용자 경험을 극대화했습니다.', better: '고객 문의 유형을 분류해 다음 분기 개선 목록을 만들었습니다.', why: '목표 대신 실제 산출물을 썼다.' },
    ],
  },
  general: {
    family: 'general', label: '공통',
    principles: COMMON_PRINCIPLES,
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
    ...patterns.examples.map(item => `- 약함: "${item.weak}" → 나음: "${item.better}" (${item.why})`),
  ].join('\n');
}
