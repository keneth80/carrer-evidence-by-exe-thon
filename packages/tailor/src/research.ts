import { containsPersonalInfo } from '../../search/src/privacy.ts';
import type { ChatCallContext, ChatJob } from './provider.ts';

// 정보가 부족할 때 에이전트가 검색으로 보충한다(사용자 요청 2026-11-21, DECISIONS S1-29).
// JD 점검에서만 쓴다: ① 공고 글이 검색 요약뿐이면 같은 공고의 다른 검색 요약을 찾아 공고 글에 덧붙이고 ② 회사가 무슨 사업을 하는지 참고 정보를 찾는다.
// - 검색어는 회사 이름과 공고 제목뿐이다. 이력서 내용·개인정보를 검색어에 넣지 않는다.
// - 검색 결과는 공고·회사에 대한 참고 자료다. 지원자 경력의 근거가 아니며, 근거 검토는 검색 결과를 보지 않는다.
// - 다른 회사·다른 공고의 글이 섞이지 않게 회사 이름이 있는 결과만 쓴다. 실패하면 보충 없이 진행한다(유료 호출 재시도 없음).

export type ResearchResult = { title: string; url: string; description: string };
export type ResearchKind = 'posting' | 'company';
export type ResearchProvider = { readonly mode: 'mock' | 'live'; search(input: { query: string; kind: ResearchKind; call?: ChatCallContext; signal?: AbortSignal }): Promise<ResearchResult[]> };
export type ResearchOutcome = { job: ChatJob; posting: number; company: number; note: string };

export const RESEARCH_LIMITS = { thinJobText: 400, postingResults: 4, companyResults: 3, snippet: 600, jobText: 6000, context: 900 } as const;
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const HOSTLIKE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

// 회사 이름으로 쓸 수 있는 값만(검색 결과에서 회사명을 읽지 못하면 사이트 주소가 들어 있다).
export function companyName(job: ChatJob): string | null {
  const name = squash(job.company_name.replace(/\(합성\)/g, ''));
  // 회사명을 읽지 못한 공고는 사이트 주소나 '… (검색 경유 링크)'가 들어 있다.
  return name.length >= 2 && !HOSTLIKE.test(name) && !name.includes('검색 경유 링크') ? name : null;
}
const roleOf = (job: ChatJob, company: string) => squash(job.title.replace(/^\s*[[【][^\]】]*[\]】]/, '').replaceAll(company, '').replace(/주식회사|㈜|\(주\)|채용|모집|공고|경력직/g, ' ')).slice(0, 60);

export function postingQuery(job: ChatJob): string | null {
  const company = companyName(job);
  if (!company) return null;
  const query = squash(`${company} ${roleOf(job, company)} 채용 자격요건 우대사항`);
  return containsPersonalInfo(query) ? null : query;
}
export function companyQuery(job: ChatJob): string | null {
  const company = companyName(job);
  if (!company) return null;
  const query = `${company} 회사 소개 서비스 사업`;
  return containsPersonalInfo(query) ? null : query;
}

const mentions = (result: ResearchResult, company: string) => `${result.title} ${result.description}`.toLowerCase().includes(company.toLowerCase());
const snippet = (result: ResearchResult) => squash(result.description).slice(0, RESEARCH_LIMITS.snippet);

// 같은 공고로 볼 수 있는 검색 요약만: 회사 이름이 있고, 공고 제목의 직무 낱말이 하나 이상 있어야 한다. 이미 있는 글과 같은 요약은 뺀다.
export function screenPostingResults(results: ResearchResult[], job: ChatJob): string[] {
  const company = companyName(job);
  if (!company) return [];
  const roleWords = roleOf(job, company).split(/[\s·,/()[\]-]+/).filter(word => word.length >= 2);
  const have = squash(job.content_text);
  const kept: string[] = [];
  for (const result of results) {
    const text = snippet(result);
    const whole = `${result.title} ${text}`.toLowerCase();
    if (text.length < 20 || !mentions(result, company) || !roleWords.some(word => whole.includes(word.toLowerCase()))) continue;
    if (have.includes(text) || text.includes(have) && have.length > 40 && text.length - have.length < 20 || kept.includes(text)) continue;
    kept.push(text);
    if (kept.length >= RESEARCH_LIMITS.postingResults) break;
  }
  return kept;
}

export function screenCompanyResults(results: ResearchResult[], job: ChatJob): string[] {
  const company = companyName(job);
  if (!company) return [];
  const kept: string[] = [];
  for (const result of results) {
    const text = squash(result.description).slice(0, 300);
    if (text.length < 20 || !mentions(result, company) || kept.includes(text)) continue;
    kept.push(text);
    if (kept.length >= RESEARCH_LIMITS.companyResults) break;
  }
  return kept;
}

type Run = <T>(work: (signal: AbortSignal) => Promise<T>) => Promise<{ ok: true; value: T } | { ok: false; code: string }>;

// 공고 글 보충(요약뿐일 때)과 회사 참고 정보. 붙여넣은 본문이 있으면 공고 보충 검색은 하지 않는다.
export async function researchJob(provider: ResearchProvider, job: ChatJob, run: Run, call?: ChatCallContext): Promise<ResearchOutcome> {
  let next: ChatJob = job;
  let posting = 0;
  let company = 0;
  const notes: string[] = [];
  const thin = job.content_source !== 'pasted' && job.requirements.length === 0 && squash(job.content_text).length < RESEARCH_LIMITS.thinJobText;
  const first = thin ? postingQuery(job) : null;
  if (first) {
    const got = await run(signal => provider.search({ query: first, kind: 'posting', call, signal }));
    const extra = got.ok ? screenPostingResults(got.value, job) : [];
    posting = extra.length;
    if (extra.length > 0) next = { ...next, content_text: [job.content_text, ...extra].join('\n').slice(0, RESEARCH_LIMITS.jobText), content_source: 'searched' };
    notes.push(got.ok ? `검색으로 공고 내용 보충 ${extra.length}건` : `공고 보충 검색 실패(${got.code})`);
  }
  const second = companyQuery(job);
  if (second) {
    const got = await run(signal => provider.search({ query: second, kind: 'company', call, signal }));
    const context = got.ok ? screenCompanyResults(got.value, job) : [];
    company = context.length;
    if (context.length > 0) next = { ...next, company_context: context.map(text => `- ${text}`).join('\n').slice(0, RESEARCH_LIMITS.context) };
    notes.push(got.ok ? `회사 정보 검색 ${context.length}건` : `회사 정보 검색 실패(${got.code})`);
  }
  return { job: next, posting, company, note: notes.join(' · ') };
}
