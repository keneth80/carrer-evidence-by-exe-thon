import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyName, companyQuery, postingQuery, researchJob, screenCompanyResults, screenPostingResults } from '../packages/tailor/src/research.ts';
import { createMockTailorStageProvider } from '../packages/tailor/src/jd-check.ts';
import { runTailorPipeline } from '../packages/tailor/src/tailor-pipeline.ts';
import { buildJdReviewRequest } from '../packages/liner/src/tailor-stages.ts';
import { createLinerResearchProvider, linerCompanyRequestBody } from '../packages/liner/src/web-search.ts';
import { HR_REVIEW_GUIDE } from '../packages/liner/src/persona.ts';
import { baseBlocks } from '../packages/tailor/src/blocks.ts';

// 사용자 요청(2026-11-21, DECISIONS S1-29): 에이전트가 정보가 부족하면 검색으로 보충해 결과에 반영한다.
// JD 점검에서 ① 요약뿐인 공고 글을 같은 공고의 검색 요약으로 보충 ② 회사 참고 정보. 검색 결과는 이력서의 근거가 아니다. 합성 자료만 쓴다.

const JOB = { company_name: '합성랩', title: '[합성랩] 프론트엔드 개발자 채용', content_text: '합성랩 프론트엔드 개발자 채용 ✓ TypeScript 실무 경험 필수', requirements: [] };
const FACTS = [{ id: 'f1', category: 'skill', statement: 'TypeScript' }, { id: 'f2', category: 'responsibility', statement: 'TypeScript로 정산 화면을 개발했습니다.' }];
const run = async work => { try { return { ok: true, value: await work(new AbortController().signal) }; } catch (error) { return { ok: false, code: error.code ?? 'X' }; } };

test('검색어는 회사 이름·공고 제목뿐이고, 회사 이름을 모르면(사이트 주소) 검색하지 않는다', () => {
  assert.equal(postingQuery(JOB), '합성랩 프론트엔드 개발자 채용 자격요건 우대사항');
  assert.equal(companyQuery(JOB), '합성랩 회사 소개 서비스 사업');
  assert.equal(companyName({ ...JOB, company_name: 'www.synth-jobs.example' }), null);
  assert.equal(companyName({ ...JOB, company_name: '합성핏(SYNTHFIT)' }), '합성핏', 'an alias in parentheses is dropped');
  assert.equal(companyName({ ...JOB, company_name: 'wanted.co.kr (검색 경유 링크)' }), null);
  assert.equal(postingQuery({ ...JOB, company_name: 'www.synth-jobs.example' }), null);
  assert.equal(postingQuery({ ...JOB, company_name: '합성랩 010-1234-5678' }), null, 'personal info never goes into a query');
});

test('검색 결과 거르기: 회사 이름과 직무 낱말이 있는 다른 요약만 덧붙이고, 다른 회사·같은 글·짧은 글은 뺀다', () => {
  const results = [
    { title: '[합성랩] 프론트엔드 개발자 채용', url: 'https://a.example/1', description: '합성랩 프론트엔드 개발자 우대 사항: Next.js·React 개발 경험, 디자인 시스템 구축 경험' },
    { title: '[다른회사] 프론트엔드 개발자 채용', url: 'https://a.example/2', description: '다른회사 프론트엔드 개발자 자격 요건: Vue 개발 경험 필수' },
    { title: '[합성랩] 프론트엔드 개발자 채용', url: 'https://a.example/3', description: JOB.content_text },
    { title: '합성랩 회계 담당자 모집', url: 'https://a.example/4', description: '합성랩 재무팀에서 결산 업무를 맡을 분을 찾습니다. 관련 경력 필수' },
    { title: '합성랩 프론트엔드', url: 'https://a.example/5', description: '합성랩' },
  ];
  assert.deepEqual(screenPostingResults(results, JOB), ['합성랩 프론트엔드 개발자 우대 사항: Next.js·React 개발 경험, 디자인 시스템 구축 경험']);
  assert.deepEqual(screenCompanyResults([{ title: '합성랩 소개', url: 'https://b.example', description: '합성랩은 소상공인 정산 서비스를 운영하는 회사입니다.' }, { title: '무관', url: 'https://b.example/2', description: '다른 회사 이야기입니다. 길이는 충분합니다.' }], JOB),
    ['합성랩은 소상공인 정산 서비스를 운영하는 회사입니다.']);
});

test('보충 검색: 요약뿐인 공고만 공고 글을 보충하고(붙여넣은 본문은 하지 않음), 실패하면 보충 없이 이유를 남긴다', async () => {
  const asked = [];
  const provider = { mode: 'mock', search: async input => { asked.push(input.kind); return input.kind === 'posting'
    ? [{ title: '[합성랩] 프론트엔드 개발자 채용', url: 'https://a.example/1', description: '합성랩 프론트엔드 개발자 우대 사항: Next.js 개발 경험 우대' }]
    : [{ title: '합성랩', url: 'https://b.example', description: '합성랩은 소상공인 정산 서비스를 운영하는 회사입니다.' }]; } };
  const found = await researchJob(provider, JOB, run);
  assert.deepEqual(asked, ['posting', 'company']);
  assert.equal(found.job.content_source, 'searched');
  assert.match(found.job.content_text, /^합성랩 프론트엔드 개발자 채용 ✓ TypeScript 실무 경험 필수\n합성랩 프론트엔드 개발자 우대 사항/);
  assert.match(found.job.company_context, /소상공인 정산 서비스/);
  assert.equal(found.note, '검색으로 공고 내용 보충 1건 · 회사 정보 검색 1건');

  asked.length = 0;
  const pasted = await researchJob(provider, { ...JOB, content_source: 'pasted', content_text: '자격 요건\n- TypeScript 실무 경험 필수' }, run);
  assert.deepEqual(asked, ['company'], 'a pasted posting is not replaced by search snippets');
  assert.equal(pasted.job.content_source, 'pasted');

  const failing = { mode: 'mock', search: async () => { throw Object.assign(new Error('x'), { code: 'LINER_CALL_LIMIT' }); } };
  const none = await researchJob(failing, JOB, run);
  assert.equal(none.job.content_text, JOB.content_text);
  assert.match(none.note, /공고 보충 검색 실패\(LINER_CALL_LIMIT\) · 회사 정보 검색 실패\(LINER_CALL_LIMIT\)/);
});

test('JD 점검: 보충한 공고 글에서 요구를 읽고, 단계 기록과 답에 검색으로 보충했다고 밝힌다. 검색 결과는 근거 검토 자료가 아니다', async () => {
  const provider = { mode: 'mock', search: async input => input.kind === 'posting'
    ? [{ title: '[합성랩] 프론트엔드 개발자 채용', url: 'https://a.example/1', description: '합성랩 프론트엔드 개발자 우대 사항 ✓ Next.js 개발 경험 우대' }] : [] };
  const stages = createMockTailorStageProvider();
  const result = await runTailorPipeline({ chat: { mode: 'mock', respond: async () => { throw new Error('unused'); } }, stages, research: provider, taskId: 't1', now: () => 1_800_000_000_000, report: () => true, invoke: work => work(new AbortController().signal) },
    { job: JOB, facts: FACTS, blocks: baseBlocks(FACTS), history: [], message: null, userMessages: [] });
  assert.equal(result.kind, 'ok');
  assert.ok(result.turn.requirements.some(item => /Next\.js/.test(item.requirement)), 'a requirement found only in the searched snippet');
  assert.match(result.turn.pipeline.stages[0].note, /공고 글\(검색 보충\)에서 요구사항 \d+개 추출.*검색으로 공고 내용 보충 1건 · 회사 정보 검색 0건/);
  assert.match(result.reply, /검색해 내용을 보충/);
  assert.equal(result.turn.requirements.find(item => /Next\.js/.test(item.requirement)).status, 'missing', 'search text never becomes evidence for the candidate');
});

test('Liner: 회사 참고 정보는 HR 점검 요청에만 참고 자료로 가고, 보충 검색은 공고 검색과 같은 원장을 쓴다. HR 실무 기준이 점검 지침에 있다', async () => {
  const request = buildJdReviewRequest({ job: { ...JOB, company_context: '- 합성랩은 정산 서비스를 운영합니다.' }, facts: FACTS, checks: [] }, 'quality', new Date('2026-11-21T00:00:00Z'));
  assert.match(request.messages[1].content, /"company_context":"- 합성랩은 정산 서비스를 운영합니다\."/);
  assert.match(request.messages[0].content, /company_context\(회사 참고 정보\)가 있으면 검색 요약이다/);
  assert.match(request.messages[0].content, /면접에서 확인할 가능성이 큰 질문/);
  for (const phrase of ['가장 최근 경력부터', '업무명 나열', '연차에 맞는 역할', '팀 성과와 본인 기여', '이직·공백']) assert.ok(HR_REVIEW_GUIDE.includes(phrase), phrase);
  assert.equal('date_range' in linerCompanyRequestBody('x'), false);

  const calls = [];
  const ledger = { reserve: (call, hash, amount, purpose) => { calls.push(purpose ?? 'search'); return { ok: true, callId: 'c1' }; }, dispatch: () => true, settle: () => undefined };
  const fetchFn = async (_url, init) => { calls.push(JSON.parse(init.body).query); return new Response(JSON.stringify({ results: [{ title: 't', url: 'https://a.example', description: 'd' }] }), { status: 200 }); };
  const research = createLinerResearchProvider({ apiKey: 'test-key-research', fetch: fetchFn, ledger });
  assert.deepEqual(await research.search({ query: '합성랩 회사 소개', kind: 'company', call: { workspaceId: 'w', taskId: 't', leaseGeneration: 1 } }), [{ title: 't', url: 'https://a.example', description: 'd' }]);
  assert.deepEqual(calls, ['search', '합성랩 회사 소개']);
  await assert.rejects(research.search({ query: '합성랩', kind: 'company' }), { code: 'LINER_CALL_CONTEXT_REQUIRED' });
  await assert.rejects(research.search({ query: '합성랩 010-1234-5678', kind: 'company', call: { workspaceId: 'w', taskId: 't', leaseGeneration: 1 } }), { code: 'LINER_NO_SAFE_QUERY' });
});
