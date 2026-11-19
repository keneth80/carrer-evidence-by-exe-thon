import type { JobDraft, JobRequirement } from './types.ts';

// mock 검색 provider의 합성 공고 목록. 회사·주소는 가상이며 .invalid 도메인을 사용한다.
// 원문(content_text)은 실제 공고처럼 '항목: 값' 줄과 자격 요건 목록으로 구성해 같은 판정 규칙을 거친다.

export const MOCK_SITE_ID = 'mock-job-board-v1';

type Entry = {
  slug: string; company: string; title: string;
  attributes: Record<string, string>;
  duties: string[]; required: string[]; preferred: string[];
};

const ENTRIES: Entry[] = [
  { slug: 'lumino-frontend', company: '루미노랩 (합성)', title: '프론트엔드 개발자',
    attributes: { 근무지: '서울', '근무 방식': '하이브리드 (주 2일 출근)', '고용 형태': '정규직', 경력: '3년 이상' },
    duties: ['React와 TypeScript로 운영 화면을 개발합니다.', '공통 컴포넌트와 화면 상태 구조를 설계합니다.'],
    required: ['React 기반 화면 개발 경험', 'TypeScript 사용 경험'], preferred: ['Storybook 등 디자인 시스템 운영 경험'] },
  { slug: 'bridgework-senior-frontend', company: '브릿지워크 (합성)', title: '시니어 프론트엔드 엔지니어',
    attributes: { 근무지: '서울', '근무 방식': '원격 근무', '고용 형태': '정규직', 연봉: '7000만 원 이상', 경력: '5년 이상' },
    duties: ['Next.js 기반 서비스의 화면 구조를 개선합니다.', '코드 리뷰 기준을 정리하고 팀과 공유합니다.'],
    required: ['React와 Next.js 서비스 개발 경험', '코드 리뷰 경험'], preferred: ['Storybook으로 컴포넌트 문서를 운영한 경험'] },
  { slug: 'orbit-web-frontend', company: '오빗스튜디오 (합성)', title: '웹 프론트엔드 개발자',
    attributes: { 근무지: '성남 판교', '근무 방식': '사무실 출근 (원격 불가)', '고용 형태': '계약직', 연봉: '4000만~5000만 원' },
    duties: ['콘텐츠 편집기 화면을 개발합니다.'],
    required: ['Vue 또는 React 개발 경험', 'TypeScript 사용 경험'], preferred: [] },
  { slug: 'nova-fullstack', company: '노바커머스 (합성)', title: '풀스택 개발자',
    attributes: { 근무지: '서울', '근무 방식': '하이브리드', '고용 형태': '정규직' },
    duties: ['주문 관리 화면과 API를 함께 개발합니다.'],
    required: ['React와 Node.js 개발 경험', 'TypeScript 사용 경험'], preferred: ['AWS 운영 경험'] },
  { slug: 'cloudpin-backend', company: '클라우드핀 (합성)', title: '백엔드 개발자',
    attributes: { 근무지: '서울', '근무 방식': '원격 근무', '고용 형태': '정규직', 연봉: '6000만 원 이상', 경력: '3년 이상' },
    duties: ['FastAPI로 업무 API를 개발합니다.', 'AWS 기반 배포와 운영 로그를 관리합니다.'],
    required: ['Python과 FastAPI 기반 API 개발 경험', 'AWS 운영 경험'], preferred: ['비동기 작업 처리 경험'] },
  { slug: 'datawave-server', company: '데이터웨이브 (합성)', title: '서버 개발자',
    attributes: { 근무지: '부산', '근무 방식': '하이브리드', '고용 형태': '정규직', 연봉: '협의' },
    duties: ['AWS Lambda와 SQS로 비동기 작업을 처리합니다.', 'DynamoDB 데이터 모델을 설계합니다.'],
    required: ['Python 서버 개발 경험', 'AWS Lambda와 SQS 사용 경험'], preferred: ['DynamoDB 사용 경험'] },
  { slug: 'steplogic-backend', company: '스텝로직 (합성)', title: '백엔드 엔지니어',
    attributes: { 근무지: '서울', '근무 방식': '사무실 출근', '고용 형태': '정규직' },
    duties: ['Java와 Spring으로 결제 API를 개발합니다.'],
    required: ['Java와 Spring 개발 경험', 'Kafka 사용 경험'], preferred: [] },
  { slug: 'greennote-data', company: '그린노트 (합성)', title: '데이터 엔지니어',
    attributes: { '근무 방식': '원격 근무', '고용 형태': '정규직' },
    duties: ['Python과 Airflow로 데이터 파이프라인을 운영합니다.'],
    required: ['Python 데이터 처리 경험', 'SQL 사용 경험'], preferred: ['Airflow 운영 경험'] },
  { slug: 'pixelhouse-designer', company: '픽셀하우스 (합성)', title: '프로덕트 디자이너',
    attributes: { 근무지: '서울', '근무 방식': '하이브리드', '고용 형태': '정규직' },
    duties: ['Figma로 서비스 화면을 설계합니다.'],
    required: ['Figma 사용 경험', '사용자 조사 경험'], preferred: [] },
  { slug: 'mobileworks-ios', company: '모바일웍스 (합성)', title: 'iOS 개발자',
    attributes: { 근무지: '대전', '근무 방식': '사무실 출근', '고용 형태': '인턴' },
    duties: ['Swift로 모바일 앱을 개발합니다.'],
    required: ['Swift 개발 경험'], preferred: [] },
];

function toDraft(entry: Entry): JobDraft {
  const lines = [`[합성 공고] ${entry.company} · ${entry.title}`];
  for (const [label, value] of Object.entries(entry.attributes)) lines.push(`${label}: ${value}`);
  lines.push('주요 업무', ...entry.duties.map(text => `- ${text}`));
  lines.push('자격 요건', ...entry.required.map(text => `- ${text}`));
  if (entry.preferred.length) lines.push('우대 사항', ...entry.preferred.map(text => `- ${text}`));
  lines.push('이 공고는 개발용 합성 자료이며 실제 채용이 아닙니다.');
  const requirements: JobRequirement[] = [
    ...entry.required.map((text, index) => ({ id: `req_${index + 1}`, text, importance: 'required' as const, source_quote: text })),
    ...entry.preferred.map((text, index) => ({ id: `req_p${index + 1}`, text, importance: 'preferred' as const, source_quote: text })),
  ];
  return {
    job_key: `${MOCK_SITE_ID}:${entry.slug}`, company_name: entry.company, title: entry.title,
    canonical_url: `https://jobs.example.invalid/${entry.slug}`, site_id: MOCK_SITE_ID,
    content_text: lines.join('\n'), requirements, open_status: 'unknown', data_origin: 'synthetic',
  };
}

export const MOCK_JOBS: readonly JobDraft[] = ENTRIES.map(toDraft);
