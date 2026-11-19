import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runReviewTask } from '../apps/worker/src/review-task.ts';
import { createLinerLedger, readLinerUsage } from '../apps/worker/src/liner-ledger.ts';
import { createMockReviewProvider, screenReview } from '../packages/tailor/src/review-provider.ts';
import { createLinerReviewProvider } from '../packages/liner/src/review.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { confirmFixture } from './helpers/s02-harness.mjs';

// S1-14 AI 1차 점검: 확정 경력 한 버전 → review_resume 작업 → 안내·질문 저장. 실제 네트워크 없이 mock·가짜 fetch만 쓴다.

const KEY = 'test-liner-review-key-must-never-leak-012345';
const reviewDeps = (api, provider, owner = `review-${randomUUID()}`) => ({ db: api.db, owner, leaseMs: 30_000, now: Date.now, provider });

async function confirmed(prefix, profile) {
  const { folder, cleanup } = tempFolder(prefix);
  const api = await startApi(folder);
  const http = client(api, await login(api, profile));
  const { revision } = await confirmFixture(api, http, 'frontend');
  return { api, http, revision, cleanup };
}

test('mock 점검: 요청 → 대기 → worker → 안내·질문 저장, 확정 경력 불변, 멱등·중복 진행 거절·소유권', async () => {
  const { api, http, revision, cleanup } = await confirmed('ai-review-', 'hana');
  try {
    const before = (await http.get(`/api/v1/resume-fact-revisions/${revision.id}`)).body;
    assert.equal((await http.post(`/api/v1/resume-fact-revisions/${revision.id}/ai-reviews`, { json: { force: true } })).status, 400);
    const key = `key-${randomUUID()}`;
    const accepted = await http.post(`/api/v1/resume-fact-revisions/${revision.id}/ai-reviews`, { json: {}, key });
    assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
    assert.equal(accepted.body.task.kind, 'review_resume');
    const reviewId = accepted.body.resource_id;
    assert.equal((await http.post(`/api/v1/resume-fact-revisions/${revision.id}/ai-reviews`, { json: {}, key })).body.resource_id, reviewId, 'same key replays');
    const again = await http.post(`/api/v1/resume-fact-revisions/${revision.id}/ai-reviews`, { json: {} });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'REVIEW_PENDING');
    assert.equal((await http.get(`/api/v1/resume-ai-reviews/${reviewId}`)).body.state, 'queued');

    assert.equal(await runReviewTask(reviewDeps(api, createMockReviewProvider())), 'succeeded');
    const review = (await http.get(`/api/v1/resume-ai-reviews/${reviewId}`)).body;
    assert.equal(review.state, 'succeeded');
    assert.equal(review.provider_mode, 'mock');
    assert.match(review.summary, /mock 점검/);
    assert.ok(review.items.some(item => item.title.includes('결과')), 'synthetic resume has no measured results');
    const task = (await http.get(`/api/v1/product-tasks/${accepted.body.task.id}`)).body;
    assert.equal(task.state, 'succeeded');
    assert.ok(task.result_ids.includes(reviewId));
    assert.deepEqual((await http.get(`/api/v1/resume-fact-revisions/${revision.id}`)).body, before, 'facts are not changed by a review');

    const other = client(api, await login(api, 'intruder'));
    assert.equal((await other.get(`/api/v1/resume-ai-reviews/${reviewId}`)).status, 404);
    assert.equal((await other.post(`/api/v1/resume-fact-revisions/${revision.id}/ai-reviews`, { json: {} })).status, 404);
    assert.equal((await http.post(`/api/v1/resume-fact-revisions/${revision.id}/ai-reviews`, { json: {} })).status, 202, 'a new review is allowed once the previous one finished');
  } finally { await api.stop(); cleanup(); }
});

test('live 점검(가짜 fetch): 요청 형식·패턴·가림, 없는 사실 ID와 형식 틀린 항목은 버림, 원장 purpose=chat', async () => {
  const { api, http, revision, cleanup } = await confirmed('ai-review-live-', 'iris');
  try {
    api.config.chatMode = 'live';
    const accepted = await http.post(`/api/v1/resume-fact-revisions/${revision.id}/ai-reviews`, { json: {} });
    const calls = [];
    const known = revision.facts.find(fact => fact.category === 'responsibility').id;
    const fetchFn = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      const content = { summary: '역할과 기술은 분명합니다. 결과를 확인할 수 있는 문장이 없습니다.', items: [
        { fact_ids: [known, 'fact_does_not_exist'], title: '결과가 드러나지 않아요', detail: '맡은 일은 분명하지만 결과를 알 수 없습니다.', question: '이 작업 뒤에 달라진 점이 기록으로 남아 있나요?' },
        { fact_ids: [], title: '', detail: '제목 없는 항목', question: null },
      ] };
      return new Response(JSON.stringify({ model: 'claude-haiku-5.5', choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 300 } }), { status: 200 });
    };
    const owner = `review-${randomUUID()}`;
    const ledger = createLinerLedger({ db: api.db, owner, now: Date.now, maxCalls: 3, budgetMicroUsd: 2_000_000 });
    assert.equal(await runReviewTask(reviewDeps(api, createLinerReviewProvider({ apiKey: KEY, fetch: fetchFn, ledger }), owner)), 'succeeded');
    assert.equal(calls.length, 1);
    const body = calls[0].body;
    assert.equal(calls[0].init.headers['x-api-key'], KEY);
    assert.equal(body.response_format.json_schema.name, 'resume_review');
    assert.match(body.messages[0].content, /사실을 새로 만들거나/);
    assert.match(body.messages[0].content, /프론트엔드/, 'role pattern guidance is attached');
    assert.ok(!body.messages[1].content.includes('frontend@example.com'));
    assert.match(body.messages[1].content, /^오늘 날짜\(기준일\): \d{4}-\d{2}-\d{2}\n/, 'the model gets today so past periods are not called future');
    const review = (await http.get(`/api/v1/resume-ai-reviews/${accepted.body.resource_id}`)).body;
    assert.equal(review.provider_mode, 'live');
    assert.equal(review.items.length, 1, 'malformed item dropped');
    assert.deepEqual(review.items[0].fact_ids, [known], 'unknown fact id dropped');
    const usage = readLinerUsage(api.db, 'chat');
    assert.equal(usage.calls, 1);
    assert.equal(usage.verified_micro_usd, Math.ceil(1200 * 0.1 + 300 * 0.5));
  } finally { await api.stop(); cleanup(); }
});

test('점검 실패·중지: 모드 불일치는 실패로 남고, 중지된 작업의 점검은 실패로 보인다, 형식 틀린 응답은 저장하지 않는다', async () => {
  const { api, http, revision, cleanup } = await confirmed('ai-review-fail-', 'jun');
  try {
    const first = await http.post(`/api/v1/resume-fact-revisions/${revision.id}/ai-reviews`, { json: {} });
    const liveStub = { mode: 'live', review: async () => { throw new Error('must not be called'); } };
    assert.equal(await runReviewTask(reviewDeps(api, liveStub)), 'failed');
    const failed = (await http.get(`/api/v1/resume-ai-reviews/${first.body.resource_id}`)).body;
    assert.deepEqual([failed.state, failed.error_code], ['failed', 'PROVIDER_MODE_MISMATCH']);

    const second = await http.post(`/api/v1/resume-fact-revisions/${revision.id}/ai-reviews`, { json: {} });
    api.db.prepare("UPDATE ce7_tasks SET state = 'canceled', cancel_requested = 1, error_code = 'CANCELED_BY_USER' WHERE id = ?").run(second.body.task.id);
    const canceled = (await http.get(`/api/v1/resume-ai-reviews/${second.body.resource_id}`)).body;
    assert.deepEqual([canceled.state, canceled.error_code], ['failed', 'CANCELED_BY_USER']);

    assert.equal(screenReview({ summary: 1, items: [] }, revision.facts), null);
    assert.equal(screenReview(null, revision.facts), null);
    const third = await http.post(`/api/v1/resume-fact-revisions/${revision.id}/ai-reviews`, { json: {} });
    assert.equal(await runReviewTask(reviewDeps(api, { mode: 'mock', review: async () => ({ nope: true }) })), 'failed');
    assert.equal((await http.get(`/api/v1/resume-ai-reviews/${third.body.resource_id}`)).body.error_code, 'REVIEW_OUTPUT_INVALID');
  } finally { await api.stop(); cleanup(); }
});
