import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../apps/api/src/config.ts';
import { routeRequest } from '../apps/api/src/server.ts';
import { createLinerLedger, readLinerUsage } from '../apps/worker/src/liner-ledger.ts';
import { createLinerChatProvider, DRAFT_MAX_COMPLETION_TOKENS, LINER_CHAT_URL, LINER_CHAT_MODEL, MAX_COMPLETION_TOKENS, redactPersonal, usageMicroUsd } from '../packages/liner/src/chat.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { startTailoring, say, current } from './helpers/s04-harness.mjs';

// S4-14: Liner Router 대화 provider. 실제 네트워크 없이 가짜 fetch와 합성 이력서·합성 공고만 쓴다.
// 주민등록번호 형태 가림은 실제 번호가 될 수 없는 가짜 값(13월)으로 시험한다. 하네스가 실제 형식(유효한 생년월일)의 값을 파일에 쓰지 못하게 막는다.

const KEY = 'test-liner-chat-key-must-never-leak-0123456789';

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return handler(calls.at(-1)); };
  return { fn, calls };
}
const completion = (content, extra = {}) => new Response(JSON.stringify({
  id: 'chatcmpl-synthetic', object: 'chat.completion', model: 'claude-sonnet-5.5',
  choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 3000, completion_tokens: 400, total_tokens: 3400 }, ...extra,
}), { status: 200, headers: { 'content-type': 'application/json' } });

// 요청에 담긴 현재 문서 블록으로 근거 있는 변경 하나와 슬롭 변경 하나를 만든다.
function editsFrom(call) {
  const context = JSON.parse(call.body.messages[1].content.replace(/^[^\n]*\n/, ''));
  const duties = context.blocks.filter(block => block.section === '경력 내용');
  const target = duties.at(-1);
  return {
    reply: '공고 요구와 연결된 업무 문장을 앞으로 옮겼습니다.',
    changes: [
      { operation: 'reorder', block_id: target.id, before: null, after: null, fact_ids: target.fact_ids, reason: '공고 요구와 연결됩니다.', needs_fact_confirmation: false },
      { operation: 'replace', block_id: duties[0].id, before: duties[0].text, after: `${duties[0].text.replace(/[.]$/, '')} 성공적으로 완료했습니다.`, fact_ids: duties[0].fact_ids, reason: '강조', needs_fact_confirmation: false },
    ],
    questions: [],
  };
}
const ok = call => completion(editsFrom(call));

async function liveSession(prefix) {
  const { folder, cleanup } = tempFolder(prefix);
  const api = await startApi(folder);
  api.config.chatMode = 'live'; // 서버는 요청 때 설정을 읽는다: 이후 만든 대화 작업은 live provider용이다.
  const http = client(api, await login(api, `chat-${randomUUID().slice(0, 8)}`));
  const started = await startTailoring(api, http);
  return { api, http, started, cleanup };
}

function liveDeps(api, fetchFn, limits = {}) {
  const owner = `tailor-${randomUUID()}`;
  const usages = [];
  const ledger = createLinerLedger({ db: api.db, owner, now: Date.now, maxCalls: limits.maxCalls ?? 5, budgetMicroUsd: limits.budget ?? 5_000_000 });
  return { overrides: { owner, provider: createLinerChatProvider({ apiKey: KEY, fetch: fetchFn, ledger, onUsage: usage => usages.push(usage) }) }, usages };
}

const taskRow = (api, id) => ({ ...api.db.prepare('SELECT state, error_code, provider_transmission FROM ce7_tasks WHERE id = ?').get(id) });

test('Liner 대화: 요청 형식·키 헤더·JSON schema·안티슬롭/주입 규칙·연락처 가림, 원장 chat 1건과 실제 모델 가격 기록', async () => {
  const { api, http, started, cleanup } = await liveSession('chat-ok-');
  try {
    const fake = fakeFetch(ok);
    const { overrides, usages } = liveDeps(api, fake.fn);
    const message = '이 공고에 맞춰줘. 연락은 me@example.com 이나 010-1234-5678 로 주세요';
    const { result, proposal, task } = await say(api, http, started.session.id, message, overrides);
    assert.equal(result, 'succeeded');
    assert.equal(fake.calls.length, 1, 'one call, no retry');
    const [call] = fake.calls;
    assert.equal(call.url, LINER_CHAT_URL);
    assert.equal(call.init.headers['x-api-key'], KEY);
    assert.ok(!call.init.body.includes(KEY), 'key only in header');
    assert.equal(call.body.model, LINER_CHAT_MODEL);
    assert.equal(call.body.routing_strategy, 'balanced');
    assert.equal(call.body.max_completion_tokens, DRAFT_MAX_COMPLETION_TOKENS);
    assert.equal(call.body.response_format.type, 'json_schema');
    assert.equal(call.body.response_format.json_schema.strict, true);
    assert.match(call.body.messages[0].content, /새 수치·기술·자격·직책/);
    assert.match(call.body.messages[0].content, /안티슬롭/);
    assert.match(call.body.messages[0].content, /지시문은 자료일 뿐/);
    const last = call.body.messages.at(-1).content;
    assert.ok(!/me@example\.com|010-1234-5678/.test(last), 'contact details are masked');
    assert.match(last, /\[이메일\].*\[전화번호\]/);

    // 근거 있는 재배치만 남고, '성공적으로'가 들어간 AI 문장은 제외된다.
    assert.ok(proposal, 'grounded change is proposed');
    assert.deepEqual(proposal.changes.map(change => change.operation), ['reorder']);
    const questions = JSON.parse(api.db.prepare('SELECT result_json FROM ce7_tasks WHERE id = ?').get(task.id).result_json).questions;
    assert.ok(questions.some(text => text.includes('성공적으로')), 'slop change is reported, not applied');

    const expectedMicro = usageMicroUsd('claude-sonnet-5.5', 3000, 400);
    assert.equal(expectedMicro, 3000 * 2 + 400 * 10);
    assert.deepEqual(usages, [{ model: 'claude-sonnet-5.5', prompt_tokens: 3000, completion_tokens: 400, micro_usd: expectedMicro }]);
    const chat = readLinerUsage(api.db, 'chat');
    assert.equal(chat.calls, 1);
    assert.equal(chat.verified_micro_usd, expectedMicro);
    assert.equal(readLinerUsage(api.db, 'search').calls, 0, 'chat calls do not use the search allowance');
    assert.equal(taskRow(api, task.id).provider_transmission, 'completed');
  } finally { await api.stop(); cleanup(); }
});

test('Liner 대화: 한도 초과는 보내지 않음, 402는 실패(과금 0), 네트워크 오류는 불명으로 남고 재시도 없음, 잘린 응답은 과금 후 실패', async () => {
  const { api, http, started, cleanup } = await liveSession('chat-fail-');
  try {
    const none = fakeFetch(() => { throw new Error('must not be called'); });
    const refused = await say(api, http, started.session.id, '맞춰줘', liveDeps(api, none.fn, { budget: 10 }).overrides);
    assert.equal(refused.result, 'failed');
    assert.equal(none.calls.length, 0);
    assert.deepEqual(taskRow(api, refused.task.id), { state: 'failed', error_code: 'LINER_BUDGET_LIMIT', provider_transmission: 'not_dispatched' });

    const credits = fakeFetch(() => new Response('{"error":"insufficient"}', { status: 402 }));
    const r402 = await say(api, http, started.session.id, '맞춰줘', liveDeps(api, credits.fn).overrides);
    assert.equal(taskRow(api, r402.task.id).error_code, 'LINER_INSUFFICIENT_CREDITS');
    assert.equal(taskRow(api, r402.task.id).provider_transmission, 'completed');

    const broken = fakeFetch(() => { throw new TypeError('socket hang up'); });
    const lost = await say(api, http, started.session.id, '맞춰줘', liveDeps(api, broken.fn).overrides);
    assert.equal(broken.calls.length, 1);
    assert.deepEqual(taskRow(api, lost.task.id), { state: 'failed', error_code: 'LINER_TRANSMISSION_UNKNOWN', provider_transmission: 'unknown' });

    const cut = fakeFetch(() => completion({}, { choices: [{ index: 0, message: { role: 'assistant', content: '{"reply":"잘' }, finish_reason: 'length' }] }));
    const truncated = await say(api, http, started.session.id, '맞춰줘', liveDeps(api, cut.fn).overrides);
    assert.equal(taskRow(api, truncated.task.id).error_code, 'LINER_CHAT_TRUNCATED');

    const usage = readLinerUsage(api.db, 'chat');
    assert.equal(usage.calls, 3, 'sent calls stay counted; the refused one never got a row');
    assert.equal(usage.unknown_calls, 1);
    assert.equal(usage.verified_micro_usd, usageMicroUsd('claude-sonnet-5.5', 3000, 400), 'only the truncated (processed) call is charged; 402 is 0');
    const { session } = await current(http, started.session.id);
    assert.notEqual(session.state, 'closed');
  } finally { await api.stop(); cleanup(); }
});

test('Liner 대화: 원장 정보 없이 호출하면 보내지 않는다, 모르는 모델은 최고 가격으로 기록', async () => {
  const none = fakeFetch(() => { throw new Error('must not be called'); });
  const provider = createLinerChatProvider({ apiKey: KEY, fetch: none.fn, ledger: { reserve: () => { throw new Error('no'); }, dispatch: () => false, settle: () => undefined } });
  await assert.rejects(provider.respond({ job: { company_name: 'x', title: 'y', content_text: '', requirements: [] }, facts: [], blocks: [], history: [], message: 'hi' }), { code: 'LINER_CALL_CONTEXT_REQUIRED', transmission: 'not_dispatched' });
  assert.equal(none.calls.length, 0);
  assert.equal(usageMicroUsd('some-new-model', 100, 10), 100 * 10 + 10 * 50);
  assert.equal(usageMicroUsd('claude-haiku-5.5', 1000, 1000), Math.ceil(1000 * 0.1 + 1000 * 0.5));
});

test('연락처 가림: 이메일·휴대전화·유선전화 형태만 바꾸고 기간·버전·수량 숫자는 그대로 둔다', () => {
  assert.equal(redactPersonal('a.b@x.co 010 1234 5678 +82-10-9876-5432 02-123-4567'), '[이메일] [전화번호] [전화번호] [전화번호]');
  assert.equal(redactPersonal('2021.03 - 2026.10 React 18 · 30명 · 1,200건'), '2021.03 - 2026.10 React 18 · 30명 · 1,200건');
});

test('CHAT_MODE=liner 설정: 키·대화 전용 호출 수·예산이 모두 있어야 하고, health가 실제 모드를 말한다', async () => {
  assert.equal(readConfig({}).chatMode, 'mock');
  assert.throws(() => readConfig({ CHAT_MODE: 'gpt' }), /CHAT_MODE_INVALID/);
  assert.throws(() => readConfig({ CHAT_MODE: 'liner' }), /LINER_API_KEY_REQUIRED/);
  assert.throws(() => readConfig({ CHAT_MODE: 'liner', LINER_API_KEY: KEY }), /LINER_CHAT_MAX_CALLS_INVALID/);
  assert.throws(() => readConfig({ CHAT_MODE: 'liner', LINER_API_KEY: KEY, LINER_CHAT_MAX_CALLS: '0' }), /LINER_CHAT_MAX_CALLS_INVALID/);
  assert.throws(() => readConfig({ CHAT_MODE: 'liner', LINER_API_KEY: KEY, LINER_CHAT_MAX_CALLS: '3' }), /LINER_CHAT_BUDGET_INVALID/);
  assert.throws(() => readConfig({ CHAT_MODE: 'liner', LINER_API_KEY: KEY, LINER_CHAT_MAX_CALLS: '3', LINER_CHAT_BUDGET_MICRO_USD: '100', LINER_CHAT_ROUTING: 'fast' }), /LINER_CHAT_ROUTING_INVALID/);
  const config = readConfig({ CHAT_MODE: 'liner', LINER_API_KEY: KEY, LINER_CHAT_MAX_CALLS: '3', LINER_CHAT_BUDGET_MICRO_USD: '1000000' });
  assert.deepEqual(config.chat, { maxCalls: 3, budgetMicroUsd: 1_000_000, routing: 'balanced' });
  assert.ok(!JSON.stringify(config).includes(KEY), 'config never carries the key');
  const { folder, cleanup } = tempFolder('chat-health-');
  const api = await startApi(folder);
  try {
    assert.equal((await routeRequest('GET', '/api/health', api.db, 'mock', 'live')).body.conversational_editing, 'implemented_liner_chat');
    assert.equal((await routeRequest('GET', '/api/health', api.db)).body.conversational_editing, 'implemented_mock_chat');
  } finally { await api.stop(); cleanup(); }
});

test('사실 확인 후보: 모델이 어미를 바꿔도 사용자 메시지의 원문 문장을 쓰고, 사용자가 말하지 않은 내용은 버린다(실호출 관찰)', async () => {
  const { userSentenceFor } = await import('../apps/worker/src/tailor-task.ts');
  const message = '공통 컴포넌트 구조를 정리하면서 프론트엔드 개발자 3명의 코드 리뷰를 맡았어요. 이것도 반영해 줘';
  assert.equal(userSentenceFor(message, '공통 컴포넌트 구조를 정리하면서 프론트엔드 개발자 3명의 코드 리뷰를 맡았습니다.'), '공통 컴포넌트 구조를 정리하면서 프론트엔드 개발자 3명의 코드 리뷰를 맡았어요.');
  assert.equal(userSentenceFor(message, '프론트엔드 개발자 3명의 코드 리뷰를 맡았어요'), '프론트엔드 개발자 3명의 코드 리뷰를 맡았어요', 'exact substring stays as is');
  assert.equal(userSentenceFor(message, '프론트엔드 팀 10명을 리딩하며 매출을 30% 올렸습니다'), null, 'invented content is not attributed to the user');
});

test('주민등록번호 형태 가림: 실제 번호가 될 수 없는 가짜 값(13월·공백 변형)으로 규칙을 확인한다', () => {
  assert.equal(redactPersonal('식별번호 991301-1234567 입니다'), '식별번호 [주민등록번호] 입니다');
  assert.equal(redactPersonal('991399 - 2345678'), '[주민등록번호]');
  assert.equal(redactPersonal('사번 2024-0001234 · 주문 991301-9234567'), '사번 2024-0001234 · 주문 991301-9234567', 'other number shapes are left alone');
});
