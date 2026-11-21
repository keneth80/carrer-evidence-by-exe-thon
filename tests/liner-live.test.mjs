import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { openDatabase } from '../packages/db/src/index.ts';
import { readConfig } from '../apps/api/src/config.ts';
import { routeRequest } from '../apps/api/src/server.ts';
import { runSearchTask } from '../apps/worker/src/search-task.ts';
import { createLinerLedger, readLinerUsage } from '../apps/worker/src/liner-ledger.ts';
import {
  createLinerWebSearchProvider, companyFromTitle, compactQuery, isJobPosting, isRecruitSite, linerQueries, linerQueryPlan, toJobDraft, dedupeKey, wrappedSiteId, LINER_MAX_QUERIES, LINER_SEARCH_URL,
} from '../packages/liner/src/web-search.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { confirmFixture, createSearch, jobsOf, workerDeps } from './helpers/s02-harness.mjs';

// S03: Liner live 웹 검색 adapter. 실제 네트워크 호출 없이 주입한 가짜 fetch와 합성 응답만 쓴다.

const KEY = 'test-liner-key-must-never-leak-0123456789';
const sha256 = value => createHash('sha256').update(value).digest('hex');

// 합성 Liner 응답. 공고 페이지·일반 페이지·중복 주소·위험한 주소를 섞었다. 실제 공고가 아니다.
const SYNTHETIC_RESPONSE = {
  requestId: 'req_synthetic_1',
  totalCount: 8,
  results: [
    { title: '[합성랩스] 프론트엔드 개발자 채용', url: 'https://www.wanted.co.kr/wd/900001', hostname: 'www.wanted.co.kr', faviconUrl: '', description: 'React와 TypeScript로 웹 서비스를 만드는 프론트엔드 개발자를 찾습니다(합성).', date: '2026-11-01' },
    { title: '[합성랩스] 프론트엔드 개발자 채용', url: 'https://www.wanted.co.kr/wd/900001#apply', hostname: 'www.wanted.co.kr', faviconUrl: '', description: '중복 주소', date: '2026-11-01' },
    { title: '주식회사 가상커머스 웹 프론트엔드 엔지니어', url: 'https://careers.virtual-commerce.test/jobs/42', hostname: 'careers.virtual-commerce.test', faviconUrl: '', description: 'Next.js 기반 커머스 화면 개발(합성).', date: '2026-10-28' },
    { title: 'React 상태 관리 정리', url: 'https://blog.example.test/react-state', hostname: 'blog.example.test', faviconUrl: '', description: '블로그 글', date: '2026-10-01' },
    { title: '프론트엔드 개발자 모집', url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1', hostname: 'www.saramin.co.kr', faviconUrl: '', description: '', date: '2026-11-02' },
    { title: '채용 공고', url: 'javascript:alert(1)', hostname: '', faviconUrl: '', description: '위험한 주소', date: '2026-11-02' },
    { title: 'TypeScript 릴리스 노트', url: 'https://news.example.test/ts', hostname: 'news.example.test', faviconUrl: '', description: '기술 뉴스', date: '2026-11-03' },
    { title: 'Frontend Engineer', url: 'https://www.linkedin.com/in/someone', hostname: 'www.linkedin.com', faviconUrl: '', description: '개인 프로필', date: '2026-11-03' },
  ],
};

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return handler(calls.length, init);
  };
  fn.calls = calls;
  return fn;
}

async function liveSetup(prefix) {
  const { folder, cleanup } = tempFolder(prefix);
  const api = await startApi(folder);
  // LINER_MODE=live로 띄운 API와 같다(설정 객체를 서버가 요청마다 참조한다). 키는 API 설정에 들어가지 않는다.
  api.config.mode = 'live';
  const http = client(api, await login(api, 'alice'));
  const { revision } = await confirmFixture(api, http, 'frontend');
  return { api, http, revision, done: async () => { await api.stop(); cleanup(); } };
}

function liveWorker(api, fetch, { maxCalls = 20, budgetMicroUsd = 10_000_000, timeoutMs } = {}) {
  const owner = `worker-${randomUUID()}`;
  const ledger = createLinerLedger({ db: api.db, owner, now: Date.now, maxCalls, budgetMicroUsd });
  return workerDeps(api, { owner, provider: createLinerWebSearchProvider({ apiKey: KEY, fetch, ledger, timeoutMs }) });
}

const ledgerRows = api => api.db.prepare("SELECT * FROM ce7_provider_calls WHERE provider = 'liner' ORDER BY created_at_ms, rowid").all();
const taskOf = async (http, taskId) => (await http.get(`/api/v1/product-tasks/${taskId}`)).body;

test('live search sends the spec request with the key only in a header and maps job pages as live snapshots', async () => {
  const env = await liveSetup('s03-success-');
  try {
    const { api, http, revision } = env;
    const search = await createSearch(http, revision.id);
    assert.equal((await http.get('/api/v1/product-session')).body.capabilities.live_search, true);
    assert.ok(search.intent.queries.length >= 2, 'fixture has at least two query plans');
    const fetch = fakeFetch(() => json(SYNTHETIC_RESPONSE));
    assert.equal(await runSearchTask(liveWorker(api, fetch)), 'succeeded');

    assert.equal(fetch.calls.length, LINER_MAX_QUERIES, 'recruiting-site groups plus one open query per search run');
    const planned = linerQueryPlan(search.intent.queries);
    fetch.calls.forEach((call, index) => {
      assert.equal(call.url, LINER_SEARCH_URL);
      assert.equal(call.init.method, 'POST');
      assert.deepEqual(call.init.headers, { 'x-api-key': KEY, 'Content-Type': 'application/json' });
      assert.deepEqual(call.body, { query: planned[index].query, country_code: 'KR', lang: 'ko', date_range: 'past_month', max_results: 10, include_knowledge: false });
      assert.ok(!call.init.body.includes(KEY), 'key is never in the body');
      assert.ok(call.init.signal instanceof AbortSignal, 'every call can be aborted');
    });

    const { search: run, jobs } = await jobsOf(http, search.searchId);
    assert.equal(run.provider_mode, 'live');
    assert.equal(run.outcome, 'complete');
    assert.deepEqual(jobs.map(job => job.canonical_url), [
      'https://www.wanted.co.kr/wd/900001',
      // 채용 사이트 공고가 회사 채용 페이지보다 먼저 온다(2026-11-21).
      'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1',
      'https://careers.virtual-commerce.test/jobs/42',
    ], 'non-job pages and unsafe urls are dropped; duplicates across results and queries are merged');
    assert.deepEqual(jobs.map(job => job.company_name), ['합성랩스', 'www.saramin.co.kr', '가상커머스'], 'company only from explicit title wording, otherwise hostname');
    for (const job of jobs) {
      assert.equal(job.data_origin, 'live');
      assert.match(job.job_key, /^liner:[0-9a-f]{32}$/);
      assert.equal(job.site_id, new URL(job.canonical_url).hostname);
      assert.deepEqual(job.requirements, []);
      assert.equal(job.open_status, 'unknown');
    }
    assert.equal(jobs[0].content_text, SYNTHETIC_RESPONSE.results[0].description);
    assert.equal(jobs[1].content_text, '프론트엔드 개발자 모집', 'an empty snippet falls back to the title, never invented text');

    const task = await taskOf(http, search.taskId);
    assert.equal(task.provider_transmission, 'completed');
    const rows = ledgerRows(api);
    assert.equal(rows.length, LINER_MAX_QUERIES);
    rows.forEach((row, index) => {
      assert.equal(row.status, 'succeeded');
      assert.equal(row.purpose, 'search');
      assert.equal(row.task_id, search.taskId);
      assert.equal(row.lease_generation, 1);
      assert.equal(row.reserved_micro_usd, 2000);
      assert.equal(row.verified_micro_usd, 1000);
      assert.equal(row.request_hash, sha256(fetch.calls[index].init.body));
    });
    assert.deepEqual(readLinerUsage(api.db), { calls: LINER_MAX_QUERIES, reserved_micro_usd: 2000 * LINER_MAX_QUERIES, verified_micro_usd: 1000 * LINER_MAX_QUERIES, unknown_calls: 0 });
    assert.ok(!JSON.stringify(rows).includes(KEY));
  } finally { await env.done(); }
});

test('call limit is global: the call past LINER_MAX_CALLS is refused before any fetch', async () => {
  const env = await liveSetup('s03-calls-');
  try {
    const { api, http, revision } = env;
    const fetch = fakeFetch(() => json(SYNTHETIC_RESPONSE));
    const deps = () => liveWorker(api, fetch, { maxCalls: LINER_MAX_QUERIES + 1 });
    const first = await createSearch(http, revision.id);
    assert.equal(await runSearchTask(deps(), first.taskId), 'succeeded');
    assert.equal(fetch.calls.length, LINER_MAX_QUERIES);

    // 두 번째 사용자도 같은 개발 계정 한도를 쓴다.
    const bob = client(api, await login(api, 'bob'));
    const bobRevision = (await confirmFixture(api, bob, 'frontend')).revision;
    const second = await createSearch(bob, bobRevision.id);
    assert.equal(await runSearchTask(deps(), second.taskId), 'succeeded');
    assert.equal(fetch.calls.length, LINER_MAX_QUERIES + 1, 'only one more call fits under the limit');
    const partial = (await jobsOf(bob, second.searchId)).search;
    assert.equal(partial.outcome, 'partial');

    const third = await createSearch(http, revision.id);
    assert.equal(await runSearchTask(deps(), third.taskId), 'failed');
    assert.equal(fetch.calls.length, LINER_MAX_QUERIES + 1, 'refused call never reaches fetch');
    const task = await taskOf(http, third.taskId);
    assert.equal(task.error_code, 'LINER_CALL_LIMIT');
    assert.equal(task.provider_transmission, 'not_dispatched');
    assert.equal(ledgerRows(api).length, LINER_MAX_QUERIES + 1);
  } finally { await env.done(); }
});

test('budget limit counts conservative reservations and refuses before fetch', async () => {
  const env = await liveSetup('s03-budget-');
  try {
    const { api, http, revision } = env;
    const fetch = fakeFetch(() => json(SYNTHETIC_RESPONSE));
    const deps = () => liveWorker(api, fetch, { budgetMicroUsd: 3000 });
    const first = await createSearch(http, revision.id);
    assert.equal(await runSearchTask(deps(), first.taskId), 'succeeded');
    assert.equal(fetch.calls.length, 1, 'second reservation (2000 + 2000) would exceed 3000');
    assert.equal((await jobsOf(http, first.searchId)).search.outcome, 'partial');
    const second = await createSearch(http, revision.id);
    assert.equal(await runSearchTask(deps(), second.taskId), 'failed');
    assert.equal(fetch.calls.length, 1);
    assert.equal((await taskOf(http, second.taskId)).error_code, 'LINER_BUDGET_LIMIT');
    assert.deepEqual(readLinerUsage(api.db), { calls: 1, reserved_micro_usd: 2000, verified_micro_usd: 1000, unknown_calls: 0 });
  } finally { await env.done(); }
});

test('401/402/429/400 are definite non-processed failures: Korean message, no retry, no second query', async () => {
  const env = await liveSetup('s03-4xx-');
  try {
    const { api, http, revision } = env;
    const cases = [[401, 'LINER_UNAUTHORIZED', /키/], [402, 'LINER_INSUFFICIENT_CREDITS', /크레딧/], [429, 'LINER_RATE_LIMITED', /잠시 뒤/], [400, 'LINER_INVALID_REQUEST', /형식/]];
    for (const [status, code, message] of cases) {
      const fetch = fakeFetch(() => json({ error: { code: 'X', message: `server echo ${KEY}` }, retryable: true }, status, status === 429 ? { 'retry-after': '1' } : {}));
      const search = await createSearch(http, revision.id);
      const deps = liveWorker(api, fetch);
      assert.equal(await runSearchTask(deps, search.taskId), 'failed');
      assert.equal(await runSearchTask(deps, search.taskId), 'idle', 'a finished failed task is not run again');
      assert.equal(fetch.calls.length, 1, `${status}: one request only`);
      const task = await taskOf(http, search.taskId);
      assert.equal(task.error_code, code);
      assert.equal(task.provider_transmission, 'completed');
      const row = ledgerRows(api).at(-1);
      assert.equal(row.status, 'failed');
      assert.equal(row.verified_micro_usd, 0);

      // provider 오류 자체도 한국어 안내이며 키·서버 응답 원문을 담지 않는다.
      const direct = fakeFetch(() => json({}, status));
      const provider = createLinerWebSearchProvider({ apiKey: KEY, fetch: direct, ledger: { reserve: () => ({ ok: true, callId: 'c' }), dispatch: () => true, settle: () => {} } });
      await assert.rejects(provider.search({ queries: search.intent.queries, conditions: [], maxCandidates: 10, call: { workspaceId: 'w', taskId: 't', leaseGeneration: 1 } }), error => {
        assert.equal(error.code, code);
        assert.match(error.message, message);
        assert.ok(!error.message.includes(KEY) && !error.message.includes('server echo'));
        return true;
      });
      assert.equal(direct.calls.length, 1);
    }
    assert.ok(!JSON.stringify(api.db.prepare('SELECT * FROM ce7_tasks').all()).includes(KEY));
  } finally { await env.done(); }
});

test('network error, timeout, 5xx and unparsable bodies stay unknown and are never retried', async () => {
  const env = await liveSetup('s03-unknown-');
  try {
    const { api, http, revision } = env;
    const handlers = {
      network: () => { throw new Error(`connect ECONNRESET with ${KEY}`); },
      timeout: (_n, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
      server500: () => json({ error: { code: 'INTERNAL_ERROR' } }, 500),
      downstream502: () => json({ error: { code: 'DOWNSTREAM_ERROR' }, retryable: true }, 502),
      unparsable: () => new Response('not json', { status: 200 }),
      wrongShape: () => json({ requestId: 'x' }),
    };
    for (const [name, handler] of Object.entries(handlers)) {
      const fetch = fakeFetch(handler);
      const search = await createSearch(http, revision.id);
      const deps = liveWorker(api, fetch, { timeoutMs: 50 });
      assert.equal(await runSearchTask(deps, search.taskId), 'failed', name);
      assert.equal(await runSearchTask(deps, search.taskId), 'idle');
      assert.equal(fetch.calls.length, 1, `${name}: sent once, no automatic retry`);
      const task = await taskOf(http, search.taskId);
      assert.equal(task.error_code, 'LINER_TRANSMISSION_UNKNOWN', name);
      assert.equal(task.provider_transmission, 'unknown', name);
      const row = ledgerRows(api).at(-1);
      assert.equal(row.status, 'unknown', name);
      assert.equal(row.verified_micro_usd, null, 'unknown cost is not marked verified');
    }
    assert.equal(readLinerUsage(api.db).unknown_calls, Object.keys(handlers).length);
    const dump = JSON.stringify([api.db.prepare('SELECT * FROM ce7_tasks').all(), ledgerRows(api)]);
    assert.ok(!dump.includes(KEY), 'key never reaches DB rows even when an error message contains it');
  } finally { await env.done(); }
});

test('cancel between queries stops the second paid call; missing call context sends nothing', async () => {
  const env = await liveSetup('s03-cancel-');
  try {
    const { api, http, revision } = env;
    const search = await createSearch(http, revision.id);
    const fetch = fakeFetch(() => {
      api.db.prepare('UPDATE ce7_tasks SET cancel_requested = 1 WHERE id = ?').run(search.taskId);
      return json(SYNTHETIC_RESPONSE);
    });
    assert.equal(await runSearchTask(liveWorker(api, fetch), search.taskId), 'canceled');
    assert.equal(fetch.calls.length, 1, 'no new paid call after cancel');
    assert.equal(ledgerRows(api).length, 1);
    assert.equal((await jobsOf(http, search.searchId)).jobs.length, 0, 'results arriving after cancel are discarded');

    const direct = fakeFetch(() => json(SYNTHETIC_RESPONSE));
    const provider = createLinerWebSearchProvider({ apiKey: KEY, fetch: direct, ledger: createLinerLedger({ db: api.db, owner: 'x', now: Date.now, maxCalls: 20, budgetMicroUsd: 10_000_000 }) });
    await assert.rejects(provider.search({ queries: search.intent.queries, conditions: [], maxCandidates: 10 }), { code: 'LINER_CALL_CONTEXT_REQUIRED', transmission: 'not_dispatched' });
    await assert.rejects(provider.search({ queries: search.intent.queries, conditions: [], maxCandidates: 10, call: { workspaceId: 'w', taskId: search.taskId, leaseGeneration: 99 } }), { code: 'LINER_LEASE_NOT_HELD' });
    assert.equal(direct.calls.length, 0);
  } finally { await env.done(); }
});

test('live 관찰 회귀: 글·일반 채용 안내 제외, 회사명 형식, 사이트 간 중복', () => {
  // 2026-11-18 Liner 실호출 결과의 제목 형식을 합성 이름으로 옮겼다.
  assert.equal(isJobPosting('프론트엔드 개발자 자소서 프로젝트 경험 예시와 작성 포인트', new URL('https://career-tips.example.test/cover_letter_article/910')), false);
  assert.equal(isJobPosting('채용', new URL('https://synthlab.example.test/careers/')), false);
  assert.equal(isJobPosting('인재채용', new URL('https://synthnara.example.test/careers')), false);
  assert.equal(isJobPosting('[합성랩] 백엔드 엔지니어 (3~5년) 채용 공고', new URL('https://www.wanted.co.kr/wd/1')), true);
  assert.equal(isJobPosting('Staff Front-end Engineer (New Product) - Synthpay', new URL('https://startup-board.example.test/ko/jobs/abc')), true);
  assert.equal(companyFromTitle('합성에이피 - [IT] 백엔드 개발자 경력사원 모집 - 슈퍼인턴'), '합성에이피');
  assert.equal(companyFromTitle('Software Dev Engineer I, Security Platform - Synthzon US 채용'), 'Synthzon US');
  assert.equal(companyFromTitle('Staff Front-end Engineer (New Product) - Synthpay'), 'Synthpay');
  const a = toJobDraft({ title: '[Synthpay Pay] Staff Front-end Engineer (New Product)', url: 'https://www.synthpay.jobs/kr/jobs/1', description: '' });
  const b = toJobDraft({ title: 'Staff Front-end Engineer (New Product) - Synthpay', url: 'https://startup-board.example.test/ko/jobs/abc', description: '' });
  const c = toJobDraft({ title: '[다른회사] Staff Front-end Engineer (New Product)', url: 'https://other.example.test/jobs/2', description: '' });
  assert.equal(dedupeKey(a), dedupeKey(b), 'same posting on two sites');
  assert.notEqual(dedupeKey(a), dedupeKey(c), 'same title at another company is kept');
});

test('검색 정확도(품질 검증 2026-11-20): 주간 공고 모음글·해시태그 홍보글·한글 없는 해외 공고를 뺀다', () => {
  const url = new URL('https://board.example.test/jobs/1');
  assert.equal(isJobPosting('10월 4주차 백엔드 엔지니어 채용공고 모음', url, '자세한 채용공고는 프로필 링크에서!'), false, 'weekly roundup');
  assert.equal(isJobPosting('프론트엔드 개발자 채용', url, '자세한 내용은 링크에서 #합성 #개발자 #채용'), false, 'hashtag promo post');
  assert.equal(isJobPosting('Senior Full Stack Engineer; Angular/Node.js', url, 'Deep Angular expertise (required): modern Angular development'), false, 'English-only posting from a KR search is overseas');
  assert.equal(isJobPosting('Senior Full Stack Engineer (React + Node.js)', url, 'לארגון ממשלתי גדול דרוש/ה Senior Full Stack Engineer'), false, 'foreign-script posting');
  // 유지: 한글 요약이 있는 영문 제목, 요약이 없는 영문 제목, 국내 채용 사이트·.kr 주소의 영문 공고
  assert.equal(isJobPosting('Senior Frontend Engineer', url, '합성페이 결제 화면을 만드는 프론트엔드 엔지니어를 찾습니다.'), true);
  assert.equal(isJobPosting('Staff Front-end Engineer (New Product) - Synthpay', url, ''), true);
  assert.equal(isJobPosting('Backend Engineer', new URL('https://www.wanted.co.kr/wd/2'), 'We are hiring a backend engineer in Seoul.'), true);
  assert.equal(isJobPosting('Backend Engineer', new URL('https://careers.synth.co.kr/jobs/3'), 'We are hiring a backend engineer in Seoul.'), true);
  assert.equal(isJobPosting('[합성랩] 백엔드 개발자 채용', url, '✓ TypeScript 실무 경험 필수 ✓ 우대: #Next.js'), true, 'one hashtag is not a promo post');
  assert.equal(toJobDraft({ title: 'Senior Full Stack Engineer; Angular/Node.js', url: 'https://board.example.test/jobs/9', description: 'Deep Angular expertise (required)' }), null, 'toJobDraft applies the description rules');
});

test('mapping helpers: job signals, explicit company names, privacy-filtered queries', () => {
  assert.equal(isJobPosting('아무 제목', new URL('https://www.jobkorea.co.kr/Recruit/GI_Read/1')), true);
  assert.equal(isJobPosting('Frontend Engineer', new URL('https://www.linkedin.com/jobs/view/1')), true);
  assert.equal(isJobPosting('Frontend Engineer', new URL('https://www.linkedin.com/in/someone')), false);
  assert.equal(isJobPosting('백엔드 개발자 공지', new URL('https://recruit.example.test/notice/1')), true);
  // 실호출(2026-11-18)에서 본 오탐: 직무 없는 회사 채용 안내 페이지는 개별 공고가 아니다.
  assert.equal(isJobPosting('회사 소개', new URL('https://recruit.example.test/notice/1')), false);
  assert.equal(isJobPosting('React 팁', new URL('https://blog.example.test/%E0%A4%A')), false, 'malformed path encoding does not throw');
  assert.equal(companyFromTitle('[채용] 프론트엔드 개발자'), null, 'generic brackets are not company names');
  assert.equal(companyFromTitle('(주)합성소프트 백엔드 개발자'), '합성소프트');
  assert.equal(companyFromTitle('합성모빌리티 채용 - 웹 개발'), '합성모빌리티');
  assert.equal(companyFromTitle('개발자 채용'), null);
  assert.equal(toJobDraft({ title: '채용', url: 'mailto:a@b.test', description: '' }), null);
  assert.deepEqual(linerQueries([
    { query: '연락처: 010-1234-5678 React', fact_ids: ['f1'] },
    { query: '프론트엔드 개발자 React', fact_ids: ['f2'] },
    { query: 'Next.js 채용', fact_ids: ['f3'] },
    { query: 'Storybook', fact_ids: ['f4'] },
  ]), [
    '프론트엔드 개발자 React 채용 site:wanted.co.kr',
    '프론트엔드 개발자 React 채용 site:jobkorea.co.kr OR site:saramin.co.kr',
    '프론트엔드 개발자 React 채용 site:jumpit.saramin.co.kr OR site:rallit.com OR site:jobplanet.co.kr',
    '프론트엔드 개발자 React 채용 site:linkedin.com/jobs',
    'Next.js 채용',
  ], 'contact info is never sent; recruiting-site groups first, then one open query; 채용 is not repeated');
  // 검색어는 직무 + 기술 하나로 줄인다(긴 검색어에 site:를 붙이면 결과가 없었다).
  assert.equal(compactQuery('합성 개발 리드 · 시니어 풀스택 엔지니어 React Next.js TypeScript'), '풀스택 엔지니어 React');
  assert.equal(compactQuery('회계 결산 담당'), '회계 결산');
  assert.equal(compactQuery('Frontend Developer React'), 'Frontend Developer');
});

test('config: live needs key and both caps, errors never echo the key; mock default is unchanged', async () => {
  const live = { LINER_MODE: 'live', LINER_API_KEY: KEY, LINER_MAX_CALLS: '20', LINER_BUDGET_MICRO_USD: '10000000' };
  const config = readConfig(live);
  assert.equal(config.mode, 'live');
  assert.deepEqual(config.liner, { maxCalls: 20, budgetMicroUsd: 10_000_000 });
  assert.ok(!JSON.stringify(config).includes(KEY), 'the key is not kept in the config object');
  const invalid = [
    [{ ...live, LINER_API_KEY: undefined }, /LINER_API_KEY_REQUIRED/],
    [{ ...live, LINER_API_KEY: '   ' }, /LINER_API_KEY_REQUIRED/],
    [{ ...live, LINER_MAX_CALLS: undefined }, /LINER_MAX_CALLS_INVALID/],
    [{ ...live, LINER_MAX_CALLS: '0' }, /LINER_MAX_CALLS_INVALID/],
    [{ ...live, LINER_MAX_CALLS: '1.5' }, /LINER_MAX_CALLS_INVALID/],
    [{ ...live, LINER_MAX_CALLS: 'abc' }, /LINER_MAX_CALLS_INVALID/],
    [{ ...live, LINER_BUDGET_MICRO_USD: undefined }, /LINER_BUDGET_INVALID/],
    [{ ...live, LINER_BUDGET_MICRO_USD: '0' }, /LINER_BUDGET_INVALID/],
    [{ ...live, LINER_MODE: 'real' }, /LINER_MODE_INVALID/],
  ];
  for (const [env, pattern] of invalid) {
    assert.throws(() => readConfig(env), error => pattern.test(error.message) && !error.message.includes(KEY));
  }
  const mock = readConfig({ LINER_MAX_CALLS: '0', LINER_BUDGET_MICRO_USD: '0' });
  assert.equal(mock.mode, 'mock');
  assert.equal(mock.liner, null);

  const db = openDatabase(':memory:');
  try {
    assert.equal((await routeRequest('GET', '/api/health', db)).body.live_search, 'mock');
    const liveHealth = (await routeRequest('GET', '/api/health', db, 'live')).body;
    assert.equal(liveHealth.live_search, 'implemented_liner_web');
    assert.equal(liveHealth.mode, 'live');
  } finally { db.close(); }

  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(example, /^LINER_MAX_CALLS=0$/m);
  assert.match(example, /^LINER_API_KEY=$/m, '.env.example names the key without a value');
});

test('mock mode stays the default: mock search runs never call fetch and keep synthetic labels', async () => {
  const { folder, cleanup } = tempFolder('s03-mock-');
  const api = await startApi(folder);
  try {
    const user = await login(api, 'alice');
    const http = client(api, user);
    assert.equal((await http.get('/api/v1/product-session')).body.capabilities.live_search, false);
    const { revision } = await confirmFixture(api, http, 'frontend');
    const search = await createSearch(http, revision.id);
    assert.equal(await runSearchTask(workerDeps(api)), 'succeeded');
    const { search: run, jobs } = await jobsOf(http, search.searchId);
    assert.equal(run.provider_mode, 'mock');
    assert.ok(jobs.length > 0 && jobs.every(job => job.data_origin === 'synthetic'));
    assert.equal(ledgerRows(api).length, 0);
  } finally { await api.stop(); cleanup(); }
});

// 사용자 요청(2026-11-21): 회사 자체 채용 페이지는 사이트 안에서 다시 검색해야 해서 공고 본문을 읽기 어렵다 → 채용 사이트 우선.
test('채용 사이트 우선: 채용 사이트 공고를 먼저 두고, 같은 공고는 채용 사이트 쪽을 남긴다. 리뷰·피드 경로는 공고로 보지 않는다', async () => {
  const u = value => new URL(value);
  assert.equal(isRecruitSite(u('https://www.wanted.co.kr/wd/1')), true);
  assert.equal(isRecruitSite(u('https://www.linkedin.com/jobs/view/1')), true);
  assert.equal(isRecruitSite(u('https://www.linkedin.com/posts/someone')), false);
  assert.equal(isRecruitSite(u('https://www.jobplanet.co.kr/job/search?posting_ids%5B%5D=1')), true);
  assert.equal(isRecruitSite(u('https://career.rememberapp.co.kr/job/posting/1')), true);
  assert.equal(isRecruitSite(u('https://careers.synth-company.example/jobs/1')), false);
  assert.equal(isJobPosting('합성랩 백엔드 개발자 채용', u('https://www.jobplanet.co.kr/job/search?posting_ids%5B%5D=1'), '합성 공고'), true);
  assert.equal(isJobPosting('합성랩 백엔드 개발자 기업 리뷰', u('https://www.jobplanet.co.kr/companies/1/reviews'), '합성 리뷰'), false, 'company review page is not a posting');
  assert.equal(isJobPosting('합성랩 백엔드 개발자 채용', u('https://www.rallit.com/positions/1/backend'), ''), true);
  assert.equal(isJobPosting('합성랩 백엔드 개발자 채용', u('https://www.google.com/goto?url=abc'), '합성 공고'), false, 'search-engine redirect link');
  assert.equal(isJobPosting('합성랩 백엔드 개발자 모집', u('https://www.threads.com/@synthetic/post/1'), '합성 공고'), false, 'social post');

  const results = [
    { title: '합성모빌리티 채용 - 웹 개발자', url: 'https://careers.synth-mobility.example/jobs/web', description: '합성 공고' },
    { title: '[합성랩] 프론트엔드 개발자 채용', url: 'https://careers.synth-lab.example/jobs/fe', description: '합성 공고' },
    { title: '[합성랩] 프론트엔드 개발자 채용', url: 'https://www.wanted.co.kr/wd/100', description: '합성 공고' },
    { title: '[합성핀] 백엔드 개발자 채용', url: 'https://www.jobkorea.co.kr/Recruit/GI_Read/200', description: '합성 공고' },
  ];
  const ledger = { reserve: () => ({ ok: true, callId: 'c1' }), dispatch: () => true, settle: () => undefined };
  const fetchFn = async () => new Response(JSON.stringify({ results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const provider = createLinerWebSearchProvider({ apiKey: 'test-key-recruit-first', fetch: fetchFn, ledger });
  const found = await provider.search({ queries: [{ query: '프론트엔드 개발자', fact_ids: ['f1'] }], maxCandidates: 10, call: { workspaceId: 'w', taskId: 't', leaseGeneration: 1 } });
  assert.deepEqual(found.jobs.map(job => job.site_id), ['www.wanted.co.kr', 'www.jobkorea.co.kr', 'careers.synth-mobility.example'], 'recruiting sites first; the company-page duplicate is dropped');
});

// 실호출 비교(2026-11-21): 결과의 절반 이상이 검색 엔진 경유 링크(google.com/goto)였다. site: 조건으로 찾은 것만 받아들이고 출처에 밝힌다.
test('검색 경유 링크: 채용 사이트 검색에서 온 공고만 받고, 사람 프로필·목록 페이지·열린 검색의 경유 링크는 뺀다', () => {
  const wrapped = 'https://www.google.com/goto?url=SYNTHETIC&gsessionid=x';
  const sites = ['jobkorea.co.kr', 'saramin.co.kr'];
  const kept = toJobDraft({ title: '합성핀 채용 - 풀스택 개발자 채용 (경력 3년 이상)', url: wrapped, description: '모집분야. 풀스택 개발자 ; 경력. 경력(3년이상)', sites });
  assert.equal(kept.site_id, wrappedSiteId(sites));
  assert.equal(kept.site_id, 'jobkorea.co.kr·saramin.co.kr (검색 경유 링크)');
  assert.equal(toJobDraft({ title: '합성핀 채용 - 풀스택 개발자 채용', url: wrapped, description: '모집분야. 풀스택 개발자' }), null, 'open-query wrapped link has no known site');
  assert.equal(toJobDraft({ title: '가상인 님 - 프로덕트 개발자 | Product Developer', url: wrapped, description: '기술 스택: React. 학력. 합성대학교', sites }), null, 'person profile');
  assert.equal(toJobDraft({ title: 'Full Stack Engineer (React/TypeScript) at Synth AI', url: wrapped, description: 'We are hiring a full stack engineer.', sites: ['linkedin.com/jobs'] }), null, 'no Hangul: overseas posting');
  assert.equal(isJobPosting('148 engineering jobs in Seoul, South Korea', new URL('https://www.synth-board.example/Job/seoul-engineering-jobs'), '합성 목록'), false, 'listing page');
  assert.equal(wrappedSiteId(['linkedin.com/jobs']), 'linkedin.com (검색 경유 링크)');
});

// 마무리(2026-11-21): 해외 한인 구인 글·해외 목록 사이트 제외, 채용 사이트 제목·요약 형식에서 회사 이름 읽기.
test('해외 구인 글은 빼고, 채용 사이트의 제목·요약 형식에서 회사 이름을 읽는다', () => {
  const u = value => new URL(value);
  assert.equal(isJobPosting('차량처리센터 시스템 운영 팀리더(Development Team Lead) 채용', u('https://ktown.koreadaily.com/jobs/1'), '합성 구인 글'), false, 'overseas Korean classifieds host');
  assert.equal(isJobPosting('148 engineering jobs in Seoul', u('https://www.glassdoor.ie/Job/seoul'), '합성 목록'), false);
  assert.equal(isJobPosting('합성무역 백엔드 개발자 채용', u('https://careers.synth-trade.example/jobs/1'), '미국 현지 법인에서 근무할 개발자를 찾습니다. 취업 비자 지원'), false, 'overseas work on a company page');
  assert.equal(isJobPosting('합성무역 백엔드 개발자 채용', u('https://www.wanted.co.kr/wd/1'), '미국 현지 고객을 상대합니다'), true, 'recruiting-site postings stay');
  assert.equal(isJobPosting('합성무역 백엔드 개발자 채용', u('https://careers.synth-trade.example/jobs/2'), '서울 본사에서 근무합니다'), true);

  assert.equal(companyFromTitle('합성디 [합성캔버스] 프론트엔드 엔지니어 (Product) 채용'), '합성디');
  assert.equal(companyFromTitle('합성테크놀로지스-AI Platform Engineer(AI 플랫폼)'), '합성테크놀로지스');
  assert.equal(companyFromTitle('웹 풀스택 개발자 채용 공고', '주식회사합성그룹, 웹 풀스택 개발자 채용 공고, 경력:경력무관, 학력:학력무관'), '합성그룹');
  assert.equal(companyFromTitle('AI 기반 풀스택 개발자 채용 (Flutter·React)', '모집분야. 풀스택 개발자 ; 경력. 경력(3년이상)'), null, 'no company wording: stays unknown');
  assert.equal(companyFromTitle('풀스택 개발자 채용', '경력 3년 이상, 급여: 회사 내규에 따름'), null, 'a requirement phrase is not a company');
  assert.equal(companyFromTitle('Synthlux Full Stack Engineer — 서울, 대한민국', '서울, 대한민국에서 풀스택 엔지니어를 채용합니다'), null, 'a location at the start of the summary is not a company');
});
