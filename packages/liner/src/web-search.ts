import { createHash } from 'node:crypto';
import { containsPersonalInfo } from '../../search/src/privacy.ts';
import { SearchProviderError } from '../../search/src/provider.ts';
import type { FailedTransmission, ProviderCallContext, ProviderResult, SearchProvider } from '../../search/src/provider.ts';
import type { JobDraft, QueryPlan } from '../../search/src/types.ts';
import type { ResearchProvider } from '../../tailor/src/research.ts';

// Liner Search API(POST /api/v1/tools/search/web)로 실제 웹 검색을 하는 live 검색 provider.
// - 호출마다 원장(ce7_provider_calls)에 먼저 예약하고, 호출 수·예산 한도를 넘으면 네트워크 요청을 보내지 않는다.
// - 전송 뒤에는 어떤 결과든 자동 재시도하지 않는다(유료 호출 중복 방지). 결과를 모르면 unknown으로 남긴다.
// - 결과는 검색 요약(snippet)뿐이다. 요구 사항·모집 상태를 지어내지 않고 원문 확인이 필요하다고 표시한다.
// - API 키는 요청 header에만 쓴다. 오류 메시지·원장·요청 hash에 넣지 않는다.

export const LINER_SEARCH_URL = 'https://platform.liner.com/api/v1/tools/search/web';
// include_knowledge=false 요청은 1,000건당 $1(호출당 1,000 micro-USD). 단가 변동에 대비해 두 배를 예약한다.
export const LINER_RESERVE_MICRO_USD = 2_000;
export const LINER_CALL_MICRO_USD = 1_000;
// 한 번의 검색 실행이 보내는 최대 요청 수(2026-11-21: 채용 사이트 묶음 4개 + 열린 검색 1개. 이전에는 질의 계획 앞 2개).
export const LINER_MAX_QUERIES = 5;
const DEFAULT_TIMEOUT_MS = 20_000;

export type LinerReserve = { ok: true; callId: string } | { ok: false; code: 'LINER_CALL_LIMIT' | 'LINER_BUDGET_LIMIT' | 'LINER_LEASE_NOT_HELD' };
export type LinerLedger = {
  // 짧은 DB transaction 안에서 한도·lease를 확인하고 reserved 행을 만든다.
  // purpose: 검색과 대화는 승인 한도가 달라 원장에서 따로 센다(기본 search).
  reserve(call: ProviderCallContext, requestHash: string, reserveMicroUsd: number, purpose?: 'search' | 'chat'): LinerReserve;
  // 네트워크 요청 직전 reserved → dispatched. 바꾸지 못하면 보내지 않는다.
  dispatch(callId: string): boolean;
  settle(callId: string, status: 'succeeded' | 'failed' | 'unknown', verifiedMicroUsd: number | null): void;
};

export type LinerWebSearchDeps = { apiKey: string; fetch: typeof fetch; ledger: LinerLedger; timeoutMs?: number };

// sites: 이 결과를 가져온 검색어가 좁힌 채용 사이트(없으면 열린 검색).
type LinerResult = { title: string; url: string; description: string; sites?: readonly string[] };
type CallOutcome = { ok: true; results: LinerResult[] } | { ok: false; code: string; message: string; transmission: FailedTransmission };

const REFUSED: Record<string, string> = {
  LINER_CALL_LIMIT: '설정한 Liner 호출 수 한도에 도달해 검색 요청을 보내지 않았습니다.',
  LINER_BUDGET_LIMIT: '설정한 Liner 검색 예산에 도달해 검색 요청을 보내지 않았습니다.',
  LINER_LEASE_NOT_HELD: '검색 작업이 중지되었거나 다른 실행으로 넘어가 검색 요청을 보내지 않았습니다.',
};
// 처리되지 않았다고 확인된 응답(과금 없음). 다른 상태 코드는 처리 여부를 모르므로 unknown이다.
const NOT_PROCESSED: Record<number, [string, string]> = {
  400: ['LINER_INVALID_REQUEST', 'Liner가 검색 요청 형식을 거절했습니다.'],
  401: ['LINER_UNAUTHORIZED', 'Liner API 키가 거절되었습니다. 키 설정을 확인하세요.'],
  402: ['LINER_INSUFFICIENT_CREDITS', 'Liner 크레딧이 부족해 검색하지 못했습니다.'],
  429: ['LINER_RATE_LIMITED', 'Liner 요청 한도에 걸렸습니다. 잠시 뒤 다시 검색하세요.'],
};
const UNKNOWN_MESSAGE = '검색 요청의 처리 여부를 확인할 수 없어 다시 보내지 않았습니다.';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// 공고 페이지로 볼 수 있는 결과만 남긴다. 판단 근거는 제목·주소뿐이므로 화면에서 원문 확인을 요구한다.
// 채용 사이트 우선(사용자 요청 2026-11-21): 회사 자체 채용 페이지는 사이트 안에서 다시 검색해야 해서 공고 본문을 읽기 어렵다.
// 공고 한 건이 한 페이지인 채용 사이트를 먼저 보여 준다. path가 있는 사이트는 그 경로만 공고로 본다(기업 리뷰·피드 글 제외).
export const RECRUIT_SITES: { domain: string; path?: RegExp }[] = [
  { domain: 'wanted.co.kr' }, { domain: 'jobkorea.co.kr' }, { domain: 'saramin.co.kr' },
  { domain: 'linkedin.com', path: /^\/jobs/ }, { domain: 'jobplanet.co.kr', path: /^\/job/ },
  { domain: 'jumpit.co.kr' }, { domain: 'rocketpunch.com' }, { domain: 'rallit.com', path: /^\/positions/ }, { domain: 'rememberapp.co.kr', path: /^\/job/ },
  { domain: 'incruit.com' }, { domain: 'programmers.co.kr' },
];
// 채용 사이트 묶음(실호출 비교 2026-11-21): 사이트 이름을 낱말로 붙이면 결과가 바뀌지 않았고, site: 조건은 동작했다.
// 긴 검색어에 site:를 붙이면 결과가 0~1건이라 검색어는 직무 + 기술 하나로 줄인다(compactQuery).
export const SITE_GROUPS: readonly (readonly string[])[] = [
  ['wanted.co.kr'], ['jobkorea.co.kr', 'saramin.co.kr'], ['jumpit.saramin.co.kr', 'rallit.com', 'jobplanet.co.kr'], ['linkedin.com/jobs'],
];
// 검색 결과 주소의 상당수는 검색 엔진 경유 링크(google.com/goto?url=…)로 감싸져 오고 원래 주소를 알 수 없다.
// site: 조건으로 찾은 결과일 때만 그 채용 사이트의 공고로 받아들이고, 출처에 경유 링크라고 밝힌다.
const isWrappedLink = (url: URL) => onHost(url.hostname.toLowerCase(), 'google.com') && url.pathname.startsWith('/goto');
export const wrappedSiteId = (sites: readonly string[]) => `${sites.map(site => site.replace(/\/.*$/, '')).join('·')} (검색 경유 링크)`;
// 실호출 관찰(2026-11-21): 검색 엔진 경유 주소(google.com/goto)와 SNS 홍보 글이 공고로 섞였다. 공고 본문을 읽을 수 없는 주소다.
// 해외 한인 구인 게시판·해외 채용 목록 사이트도 뺀다(국내 공고 검색이다).
const NOT_JOB_HOSTS = ['google.com', 'threads.com', 'threads.net', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'youtube.com', 'radiokorea.com', 'koreadaily.com', 'missyusa.com', 'heykorean.com'];
const NOT_JOB_HOST_PATTERN = /(^|\.)glassdoor\./;
// 한글 공고여도 해외 근무·해외 취업 글이면 뺀다(채용 사이트 공고는 그대로 둔다).
const OVERSEAS_SIGNAL = /미국\s*(현지|취업|법인\s*근무)|해외\s*취업|H-?1B|영주권|취업\s*비자|\b(?:Los Angeles|California|New York|New Jersey|Texas|Georgia|Virginia)\b|\b[A-Z][a-z]+,\s*(?:CA|NY|NJ|TX|GA|VA|WA)\b/;
const boardOf = (host: string) => RECRUIT_SITES.find(site => onHost(host, site.domain));
export function isRecruitSite(url: URL): boolean {
  const board = boardOf(url.hostname.toLowerCase());
  return Boolean(board && (!board.path || board.path.test(url.pathname)));
}
const TITLE_SIGNAL = /채용|모집|공고|구인|recruit|careers?\b|hiring|\bjobs?\b/i;
const URL_SIGNAL = /(^|[./_-])(recruit\w*|careers?|jobs?|hiring|position|채용)([./_?-]|$)/i;

function onHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

// 실호출(2026-11-18)에서 공고처럼 잡힌 글·일반 채용 안내 페이지를 거른다.
// '○○ 님 - 직함'은 사람 프로필이다(실호출 2026-11-21).
const NOT_POSTING = /자소서|자기소개서|작성\s*(법|포인트|요령|예시)|면접\s*(후기|질문)|합격\s*후기|연봉\s*정보|님\s+[-–]\s/i;
// 개별 공고는 제목에 직무·경력 표현이 있다. '채용'·'인재채용'뿐인 회사 안내 페이지는 공고가 아니다.
const ROLE_SIGNAL = /개발|엔지니어|디자이너|기획|마케|매니저|분석|데이터|연구|운영|영업|인턴|경력|신입|engineer|developer|designer|manager|analyst|scientist|researcher|\b(?:pm|po|staff|lead|intern)\b|front|back|full.?stack/i;

// 품질 검증(2026-11-20) 실호출에서 섞인 결과: 주간 공고 모음글, 해시태그 홍보글, 한글이 없는 해외 공고(영문·히브리어).
const ROUNDUP = /\d+\s*월\s*\d+\s*주\s*차|주간\s*채용|채용\s*(?:공고\s*)?(?:모음|정리|소식|큐레이션|리스트)|모아\s*보기|총정리|top\s*\d+|^\d[\d,]*\+?\s.*\bjobs\b/i;
const HASHTAG = /(?:^|\s)#[^\s#]+/g;
const HANGUL = /[가-힣]/;

// 국내 검색(country_code=KR, lang=ko)인데 제목·요약 어디에도 한글이 없고 요약이 있으면 해외 공고로 본다.
// 요약이 비었거나(판단 근거 없음) 국내 채용 사이트·.kr 주소는 영문 공고여도 남긴다.
function looksOverseas(title: string, description: string, host: string): boolean {
  if (host.endsWith('.kr')) return false;
  return description.trim() !== '' && !HANGUL.test(title) && !HANGUL.test(description);
}

// sites: 이 결과를 가져온 검색어의 site: 조건. 경유 링크는 이 조건이 있을 때만 공고로 본다.
export function isJobPosting(title: string, url: URL, description = '', sites?: readonly string[]): boolean {
  const host = url.hostname.toLowerCase();
  if (NOT_POSTING.test(title) || ROUNDUP.test(title)) return false;
  if ((description.match(HASHTAG)?.length ?? 0) >= 3) return false;
  if (isWrappedLink(url)) return Boolean(sites?.length) && ROLE_SIGNAL.test(title) && (HANGUL.test(title) || HANGUL.test(description));
  if (NOT_JOB_HOSTS.some(domain => onHost(host, domain)) || NOT_JOB_HOST_PATTERN.test(host)) return false;
  const board = boardOf(host);
  if (board && !board.path) return true;
  if (OVERSEAS_SIGNAL.test(`${title} ${description}`)) return false;
  if (looksOverseas(title, description, host)) return false;
  if (!ROLE_SIGNAL.test(title)) return false;
  // 경로가 정해진 채용 사이트(LinkedIn·잡플래닛·리멤버)는 공고 경로만 받는다.
  if (board?.path) return board.path.test(url.pathname);
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* 잘못된 % 인코딩은 원래 경로로 판단한다. */ }
  return TITLE_SIGNAL.test(title) || URL_SIGNAL.test(`${host}${path}`);
}

// 제목에 회사명이 명시된 형식만 읽는다. 찾지 못하면 null(호출부가 hostname을 쓴다). 추측으로 회사명을 만들지 않는다.
const NOT_COMPANY = /채용|모집|공고|경력|신입|정규직|계약직|인턴|급구|마감|개발|엔지니어|디자이너|매니저|developer|engineer|hiring|job/i;
// 요약이 '회사, 공고 제목, …' 꼴일 때만 첫 구절을 회사로 읽는다. 공고 제목이 바로 이어지지 않으면 지역·조건일 수 있어 읽지 않는다(실호출: '서울, …').
function companyFromSummary(title: string, description: string): string | undefined {
  const found = description.match(/^\s*((?:주식회사|㈜|\(주\))?\s*[^\s,]{2,30}),\s*(.+)$/s);
  const head = title.replace(/\s+/g, ' ').trim().slice(0, 8);
  return found && head.length >= 4 && found[2].replace(/\s+/g, ' ').trim().startsWith(head) ? found[1] : undefined;
}

// description: 제목에 회사 이름이 없는 채용 사이트 공고는 요약이 '회사, 공고 제목, 경력:…' 꼴로 시작한다(사람인). 그 첫 구절만 읽는다.
export function companyFromTitle(title: string, description = ''): string | null {
  const candidates = [
    title.match(/^\s*[[【]([^\]】]{1,40})[\]】]/)?.[1],
    title.match(/(?:주식회사|㈜|\(주\))\s*([^\s|·,()[\]-]{1,30})/)?.[1],
    title.match(/^\s*([^\s|·[\]-]{2,30})\s+채용/)?.[1],
    // '회사 - 직무 …' 형식(앞 구간)과 '직무 … - 회사 (채용)' 형식(끝 구간). 직무 단어가 섞인 구간은 NOT_COMPANY가 거른다.
    title.match(/^\s*([^|·[\]\s-][^|·[\]-]{0,28}?)\s+-\s+/)?.[1],
    title.match(/\s-\s([^|·[\]-]{2,30}?)(?:\s*채용)?\s*$/)?.[1],
    // '회사 [브랜드] 직무 채용'(랠릿), '회사-직무'(원티드 일부) 형식.
    title.match(/^\s*([^\s[\]|·-]{2,20})\s+\[[^\]]{1,30}\]\s/)?.[1],
    title.match(/^\s*([가-힣][가-힣A-Za-z0-9&.]{1,19})-(?=[A-Za-z가-힣])/)?.[1],
    companyFromSummary(title, description),
  ];
  for (const raw of candidates) {
    const value = raw?.replace(/주식회사|㈜|\(주\)/g, '').trim();
    if (value && !NOT_COMPANY.test(value)) return value;
  }
  return null;
}

// 같은 공고가 여러 사이트에 실린 경우를 하나로 본다: 회사명 앞 4글자 + 회사·사이트 표기를 뺀 직무 제목.
export function dedupeKey(job: JobDraft): string {
  const role = job.title
    .replace(/^\s*[[【][^\]】]*[\]】]\s*/, '')
    .replace(/\s-\s[^-]*$/, '')
    .replace(/채용|공고/g, '')
    .replace(/[\s·,:]+/g, ' ')
    .trim()
    .toLowerCase();
  return `${job.company_name.toLowerCase().replace(/\s+/g, '').slice(0, 4)}|${role}`;
}

const clean = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max);

export function toJobDraft(result: LinerResult): JobDraft | null {
  let url: URL;
  try { url = new URL(result.url); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.hash = '';
  const title = clean(result.title, 300);
  if (!title || !isJobPosting(title, url, result.description, result.sites)) return null;
  const canonical = url.toString();
  const host = isWrappedLink(url) && result.sites?.length ? wrappedSiteId(result.sites) : url.hostname.toLowerCase();
  return {
    job_key: `liner:${sha256(canonical).slice(0, 32)}`,
    company_name: companyFromTitle(title, result.description) ?? host,
    title,
    canonical_url: canonical,
    site_id: host,
    // 검색 결과 요약뿐이다. 요약이 비면 제목을 쓴다(새 문장을 만들지 않는다).
    content_text: clean(result.description, 2_000) || title,
    requirements: [],
    open_status: 'unknown',
    data_origin: 'live',
  };
}

// 질의 계획 문장에 공고 검색어를 붙인다. 개인정보가 섞인 계획은 보내지 않는다.
// 직무 + 기술 하나로 줄인 검색어. 계획 문장은 '직무 … 기술 기술 기술' 꼴이고 직무에 '·'로 여러 이름이 있으면 마지막 이름을 쓴다.
const SENIORITY = /^(시니어|주니어|수석|책임|선임|리드|senior|junior|lead|staff|principal)$/i;
export function compactQuery(query: string): string {
  const words = (query.split(/\s[·|]\s/).at(-1) ?? query).replace(/채용/g, ' ').split(/\s+/).filter(Boolean);
  const firstSkill = words.findIndex(word => /[A-Za-z0-9]/.test(word) && !SENIORITY.test(word));
  const roleWords = (firstSkill > 0 ? words.slice(0, firstSkill) : words.slice(0, 2)).filter(word => !SENIORITY.test(word));
  const role = roleWords.length > 0 ? roleWords : words.slice(0, 2);
  return [...role.slice(0, 3), ...(firstSkill > 0 ? [words[firstSkill]] : [])].join(' ');
}

export type LinerQuery = { query: string; sites: readonly string[] | null };
// 첫 계획으로 채용 사이트 묶음마다 한 번씩 찾고, 마지막 한 번은 사이트 조건 없이 찾는다(회사 채용 페이지 등).
// 개인정보가 섞인 계획은 보내지 않는다.
export function linerQueryPlan(plans: QueryPlan[]): LinerQuery[] {
  const safe = plans.map(plan => plan.query.trim()).filter(query => query.length > 0 && !containsPersonalInfo(query));
  if (safe.length === 0) return [];
  const compact = compactQuery(safe[0]);
  const open = safe[1] ?? safe[0];
  return [
    ...SITE_GROUPS.map(sites => ({ query: `${compact} 채용 ${sites.map(site => `site:${site}`).join(' OR ')}`, sites })),
    { query: open.includes('채용') ? open : `${open} 채용`, sites: null },
  ].slice(0, LINER_MAX_QUERIES);
}
export const linerQueries = (plans: QueryPlan[]): string[] => linerQueryPlan(plans).map(item => item.query);

// 요청 본문. 키 순서를 고정해 request_hash가 같은 요청에 같은 값이 되게 한다.
export function linerRequestBody(query: string) {
  return { query, country_code: 'KR', lang: 'ko', date_range: 'past_month', max_results: 10, include_knowledge: false };
}
// 회사 참고 정보 검색(S1-29)은 최근 한 달로 좁히지 않는다(회사 소개는 오래된 글이 많다).
export function linerCompanyRequestBody(query: string) {
  return { query, country_code: 'KR', lang: 'ko', max_results: 10, include_knowledge: false };
}

function parseResults(body: unknown): LinerResult[] | null {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { results?: unknown }).results)) return null;
  return ((body as { results: unknown[] }).results).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const { title, url, description } = item as Record<string, unknown>;
    if (typeof title !== 'string' || typeof url !== 'string') return [];
    return [{ title, url, description: typeof description === 'string' ? description : '' }];
  });
}

async function callOnce(deps: LinerWebSearchDeps, call: ProviderCallContext, query: string, signal?: AbortSignal, request: (query: string) => object = linerRequestBody): Promise<CallOutcome> {
  const body = JSON.stringify(request(query));
  const reserved = deps.ledger.reserve(call, sha256(body), LINER_RESERVE_MICRO_USD);
  if (!reserved.ok) return { ok: false, code: reserved.code, message: REFUSED[reserved.code], transmission: 'not_dispatched' };
  if (signal?.aborted || !deps.ledger.dispatch(reserved.callId)) {
    // 예약만 하고 보내지 않았다. 한도 계산에는 남기되 전송하지 않은 것으로 끝낸다.
    deps.ledger.settle(reserved.callId, 'failed', 0);
    return { ok: false, code: 'LINER_LEASE_NOT_HELD', message: REFUSED.LINER_LEASE_NOT_HELD, transmission: 'not_dispatched' };
  }
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await deps.fetch(LINER_SEARCH_URL, {
      method: 'POST',
      headers: { 'x-api-key': deps.apiKey, 'Content-Type': 'application/json' },
      body,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    // 네트워크 오류·시간 초과·중단: 서버가 처리했는지 알 수 없다. 오류 원문은 남기지 않는다.
    deps.ledger.settle(reserved.callId, 'unknown', null);
    return { ok: false, code: 'LINER_TRANSMISSION_UNKNOWN', message: UNKNOWN_MESSAGE, transmission: 'unknown' };
  }
  const rejected = NOT_PROCESSED[response.status];
  if (rejected) {
    await response.body?.cancel().catch(() => undefined);
    deps.ledger.settle(reserved.callId, 'failed', 0);
    return { ok: false, code: rejected[0], message: rejected[1], transmission: 'completed' };
  }
  let results: LinerResult[] | null = null;
  if (response.ok) {
    try { results = parseResults(await response.json()); } catch { results = null; }
  } else {
    await response.body?.cancel().catch(() => undefined);
  }
  if (!results) {
    deps.ledger.settle(reserved.callId, 'unknown', null);
    return { ok: false, code: 'LINER_TRANSMISSION_UNKNOWN', message: UNKNOWN_MESSAGE, transmission: 'unknown' };
  }
  // 처리된 요청은 결과가 비어도 과금된다.
  deps.ledger.settle(reserved.callId, 'succeeded', LINER_CALL_MICRO_USD);
  return { ok: true, results };
}

export function createLinerWebSearchProvider(deps: LinerWebSearchDeps): SearchProvider {
  return {
    mode: 'live',
    async search(input): Promise<ProviderResult> {
      if (!Number.isInteger(input.maxCandidates) || input.maxCandidates < 1 || input.maxCandidates > 10 || input.queries.length === 0) {
        throw new SearchProviderError('INVALID_SEARCH_INPUT', '질의 1개 이상과 1~10 범위의 후보 수가 필요합니다.', 'not_dispatched');
      }
      if (!input.call) throw new SearchProviderError('LINER_CALL_CONTEXT_REQUIRED', '호출 원장에 남길 작업 정보가 없어 검색 요청을 보내지 않았습니다.', 'not_dispatched');
      const queries = linerQueryPlan(input.queries);
      if (queries.length === 0) throw new SearchProviderError('LINER_NO_SAFE_QUERY', '개인정보가 없는 검색어가 없어 검색 요청을 보내지 않았습니다.', 'not_dispatched');
      const found: LinerResult[] = [];
      let succeeded = 0;
      let failure: Extract<CallOutcome, { ok: false }> | null = null;
      for (const query of queries) {
        if (input.signal?.aborted) break;
        const outcome = await callOnce(deps, input.call, query.query, input.signal);
        if (!outcome.ok) { failure = outcome; break; } // 실패 뒤에는 남은 질의도 보내지 않는다(호출 절약·장애 확산 방지).
        succeeded += 1;
        found.push(...outcome.results.map(result => (query.sites ? { ...result, sites: query.sites } : result)));
      }
      if (input.signal?.aborted) throw new SearchProviderError('LINER_ABORTED', '검색 작업이 중단되었습니다.', failure?.transmission ?? (succeeded > 0 ? 'completed' : 'not_dispatched'));
      if (succeeded === 0) throw new SearchProviderError(failure?.code ?? 'LINER_TRANSMISSION_UNKNOWN', failure?.message ?? UNKNOWN_MESSAGE, failure?.transmission ?? 'unknown');
      const seen = new Set<string>();
      // 채용 사이트 공고를 먼저 둔다(같은 공고가 회사 페이지에도 있으면 채용 사이트 쪽이 남는다). 그 안에서는 검색 순서를 지킨다.
      const drafts = found.flatMap(result => { const job = toJobDraft(result); return job ? [job] : []; });
      // 순서: 주소가 채용 사이트인 공고 → 채용 사이트 검색의 경유 링크 → 그 밖(회사 채용 페이지 등).
      const rankOf = (job: JobDraft) => { const url = new URL(job.canonical_url); return isRecruitSite(url) ? 0 : isWrappedLink(url) ? 1 : 2; };
      const ordered = [0, 1, 2].flatMap(rank => drafts.filter(job => rankOf(job) === rank));
      const jobs = ordered.flatMap(job => {
        if (seen.has(job.canonical_url) || seen.has(dedupeKey(job))) return [];
        seen.add(job.canonical_url);
        seen.add(dedupeKey(job));
        return [job];
      }).slice(0, input.maxCandidates);
      const failed = queries.length - succeeded;
      return { outcome: jobs.length === 0 ? 'empty' : failed > 0 ? 'partial' : 'complete', jobs, failed_queries: failed };
    },
  };
}

// 에이전트의 보충 검색(S1-29): JD 점검이 공고 글·회사 정보가 부족할 때 쓴다. 공고 검색과 같은 원장(purpose=search)·한도·재시도 금지 규칙.
// 실패는 예외로 알린다(호출부는 보충 없이 계속한다). 호출 정보가 없으면 보내지 않는다.
export function createLinerResearchProvider(deps: LinerWebSearchDeps): ResearchProvider {
  return {
    mode: 'live',
    async search(input) {
      if (!input.call) throw new SearchProviderError('LINER_CALL_CONTEXT_REQUIRED', '호출 원장에 남길 작업 정보가 없어 검색 요청을 보내지 않았습니다.', 'not_dispatched');
      if (containsPersonalInfo(input.query)) throw new SearchProviderError('LINER_NO_SAFE_QUERY', '개인정보가 있는 검색어는 보내지 않습니다.', 'not_dispatched');
      const outcome = await callOnce(deps, input.call, input.query, input.signal, input.kind === 'company' ? linerCompanyRequestBody : linerRequestBody);
      if (!outcome.ok) throw new SearchProviderError(outcome.code, outcome.message, outcome.transmission);
      return outcome.results.map(result => ({ title: result.title, url: result.url, description: result.description }));
    },
  };
}
