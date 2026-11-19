import { MOCK_JOBS, MOCK_SITE_ID } from '../../search/src/mock-catalog.ts';
import type { FormQuestion } from './types.ts';

// 자체 테스트 폼 site adapter의 서버 쪽 명세. 실행 채널(Chrome 확장)과 분리된 '사이트' 정보다.
// 이 사이트는 mock 공고 게시판(mock-job-board-v1)의 공고에 대한 지원 폼을 제공한다. 실제 기업 접수가 아니다.

export const SELF_FORM_SITE_ID = 'self-form';
export const SELF_FORM_ADAPTER_VERSION = 'self-form.v1';
export const SELF_FORM_ORIGIN = 'http://127.0.0.1:4310';
export const SELF_FORM_PATH_PREFIX = '/demo/apply/';
export const CONSENT_ANSWER = '동의';
export const FILE_FIELD = 'resume_file';

// adapter가 처리할 수 있는 문항. 이 목록에 없는 문항이 폼에 있으면 사용자 확인 대기로 보낸다.
export const SELF_FORM_QUESTIONS: readonly FormQuestion[] = [
  { question_id: 'applicant_name', label: '이름', kind: 'text', required: true, max_length: 50 },
  { question_id: 'applicant_email', label: '이메일', kind: 'email', required: true, max_length: 120 },
  { question_id: 'motivation', label: '지원 동기', kind: 'textarea', required: true, max_length: 2000 },
  { question_id: 'privacy_consent', label: '개인정보 수집·이용 동의', kind: 'checkbox', required: true, max_length: 10 },
];

// 자체 폼 사이트가 공고별로 추가로 묻는 문항(사이트 쪽 데이터). adapter는 이 문항을 처리하지 못한다.
// 폼 문항 변경·미지원 문항을 실제 페이지에서 검증하기 위한 공고다.
const EXTRA_QUESTIONS: Record<string, FormQuestion[]> = {
  'pixelhouse-designer': [{ question_id: 'portfolio_url', label: '포트폴리오 주소', kind: 'text', required: true, max_length: 300 }],
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type DemoPosting = { posting_id: string; company_name: string; title: string; questions: FormQuestion[] };

export function demoPosting(postingId: string): DemoPosting | null {
  if (!SLUG.test(postingId)) return null;
  const job = MOCK_JOBS.find(item => item.job_key === `${MOCK_SITE_ID}:${postingId}`);
  if (!job) return null;
  return { posting_id: postingId, company_name: job.company_name, title: job.title, questions: [...SELF_FORM_QUESTIONS, ...(EXTRA_QUESTIONS[postingId] ?? [])] };
}

export function listDemoPostings(): DemoPosting[] {
  return MOCK_JOBS.map(job => demoPosting(job.job_key.slice(MOCK_SITE_ID.length + 1))).filter((item): item is DemoPosting => item !== null);
}

// 공고가 이 사이트에서 지원 가능한지와 지원 주소. 지원하지 않는 사이트의 공고는 null(사용자 처리).
export function selfFormTarget(job: { job_key: string; site_id: string }): { posting_id: string; target_url: string } | null {
  if (job.site_id !== MOCK_SITE_ID || !job.job_key.startsWith(`${MOCK_SITE_ID}:`)) return null;
  const postingId = job.job_key.slice(MOCK_SITE_ID.length + 1);
  if (!demoPosting(postingId)) return null;
  return { posting_id: postingId, target_url: `${SELF_FORM_ORIGIN}${SELF_FORM_PATH_PREFIX}${postingId}` };
}

// 정확한 지원 주소인지(다른 origin·query·fragment·계정 정보 거절).
export function selfFormPostingFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== SELF_FORM_ORIGIN || url.username || url.password || url.search || url.hash) return null;
    if (!url.pathname.startsWith(SELF_FORM_PATH_PREFIX)) return null;
    const id = url.pathname.slice(SELF_FORM_PATH_PREFIX.length);
    return demoPosting(id) ? id : null;
  } catch { return null; }
}
