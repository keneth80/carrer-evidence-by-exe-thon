import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { openDatabase, describeDatabase, defaultMigrations, contractSchemaUrl } from '../packages/db/src/index.ts';
import { runSupplementTask } from '../apps/worker/src/supplement-task.ts';
import { createMockSupplementProvider, screenSupplement } from '../packages/tailor/src/supplement.ts';
import { buildSupplementRequest } from '../packages/liner/src/supplement.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { confirmFixture } from './helpers/s02-harness.mjs';

// S1-16 기본 이력서 보완 대화: 확정 경력 → 에이전트 점검·질문 → 사용자 답변 → 사용자 문장만 경력 후보 → 기존 확정 API로 새 버전.
// 실제 네트워크 없이 mock·가짜 provider만 쓴다. 합성 이력서만 쓴다.

const deps = (api, provider = createMockSupplementProvider()) => ({ db: api.db, owner: `supp-${randomUUID()}`, leaseMs: 30_000, now: Date.now, provider });
const ANSWER = '정산 화면의 조회 속도를 개선했어요. 쿼리 캐시를 적용해 응답 시간을 2초에서 0.5초로 줄였어요.';

async function confirmed(prefix, profile) {
  const { folder, cleanup } = tempFolder(prefix);
  const api = await startApi(folder);
  const user = await login(api, profile);
  const http = client(api, user);
  const fixture = await confirmFixture(api, http, 'frontend');
  return { api, http, cleanup, ...fixture };
}

test('보완 대화: 세션은 현재 확정 버전에 묶이고, 첫 턴은 점검·질문, 답변 → 사용자 문장만 후보, 응답 중 409, 소유권', async () => {
  const { api, http, revision, cleanup } = await confirmed('supplement-', 'sora');
  try {
    assert.equal((await http.post(`/api/v1/resume-fact-revisions/${revision.id}/supplement-sessions`, { json: { force: true } })).status, 400);
    const key = `key-${randomUUID()}`;
    const created = await http.post(`/api/v1/resume-fact-revisions/${revision.id}/supplement-sessions`, { json: {}, key });
    assert.equal(created.status, 202, JSON.stringify(created.body));
    assert.equal(created.body.task.kind, 'supplement_resume');
    const sessionId = created.body.resource_id;
    assert.equal((await http.post(`/api/v1/resume-fact-revisions/${revision.id}/supplement-sessions`, { json: {}, key })).body.resource_id, sessionId, 'same key replays');

    let session = (await http.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).body;
    assert.equal(session.fact_revision_id, revision.id);
    assert.equal(session.head_fact_revision_id, revision.id);
    assert.equal(session.provider_mode, 'mock');
    assert.deepEqual(session.messages, []);
    assert.equal(session.latest_task.state, 'queued');
    assert.equal((await http.post(`/api/v1/resume-supplement-sessions/${sessionId}/messages`, { json: { content: '먼저 보냄' } })).body.code, 'RESPONSE_PENDING', 'first turn still pending');

    assert.equal(await runSupplementTask(deps(api)), 'succeeded');
    session = (await http.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).body;
    const opening = session.messages[0];
    assert.equal(opening.role, 'assistant');
    assert.ok(opening.turn.findings.length > 0, 'the agent reports what to check');
    assert.ok(opening.turn.findings.some(item => item.question), 'and asks questions the user can answer');
    assert.deepEqual(opening.turn.candidates, [], 'no fact candidates before the user says anything');

    assert.equal((await http.post(`/api/v1/resume-supplement-sessions/${sessionId}/messages`, { json: { content: '' } })).status, 400);
    const sent = await http.post(`/api/v1/resume-supplement-sessions/${sessionId}/messages`, { json: { content: ANSWER } });
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    const userMessageId = sent.body.resource_id;
    const busy = await http.post(`/api/v1/resume-supplement-sessions/${sessionId}/messages`, { json: { content: '하나 더' } });
    assert.deepEqual([busy.status, busy.body.code], [409, 'RESPONSE_PENDING']);
    assert.equal(await runSupplementTask(deps(api)), 'succeeded');
    session = (await http.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).body;
    const reply = session.messages.at(-1);
    assert.equal(reply.role, 'assistant');
    assert.ok(reply.turn.candidates.length > 0, 'the answer becomes fact candidates');
    for (const candidate of reply.turn.candidates) {
      assert.ok(ANSWER.replace(/\s+/g, ' ').includes(candidate.statement), `candidate is the user's own sentence: ${candidate.statement}`);
      assert.equal(candidate.message_id, userMessageId);
    }
    assert.ok(reply.turn.candidates.some(item => item.category === 'achievement'), 'a measured sentence is an achievement candidate');

    const intruder = client(api, await login(api, 'intruder'));
    assert.equal((await intruder.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).status, 404);
    assert.equal((await intruder.post(`/api/v1/resume-supplement-sessions/${sessionId}/messages`, { json: { content: '침입' } })).status, 404);
    assert.equal((await intruder.post(`/api/v1/resume-fact-revisions/${revision.id}/supplement-sessions`, { json: {} })).status, 404);
  } finally { await api.stop(); cleanup(); }
});

test('후보 확정: 보완 대화의 사용자 메시지는 근거가 되고 에이전트 메시지는 안 된다, 확정 후 세션은 이전 버전에 묶여 있음을 알린다', async () => {
  const { api, http, revision, documentId, draft, cleanup } = await confirmed('supplement-confirm-', 'yuna');
  try {
    const sessionId = (await http.post(`/api/v1/resume-fact-revisions/${revision.id}/supplement-sessions`, { json: {} })).body.resource_id;
    await runSupplementTask(deps(api));
    const userMessageId = (await http.post(`/api/v1/resume-supplement-sessions/${sessionId}/messages`, { json: { content: ANSWER } })).body.resource_id;
    await runSupplementTask(deps(api));
    const session = (await http.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).body;
    const candidate = session.messages.at(-1).turn.candidates[0];
    const assistantId = session.messages.at(-1).id;
    const fact = (messageId, id) => ({ id, category: candidate.category, statement: candidate.statement, evidence: [{ kind: 'user_statement', message_id: messageId, confirmed_at: new Date().toISOString(), quote: candidate.statement }] });

    const fromAgent = await http.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: revision.id, facts: [...revision.facts, fact(assistantId, 'fact_agent')] } });
    assert.equal(fromAgent.status, 422, 'an assistant message is never evidence');
    assert.equal(fromAgent.body.code, 'USER_STATEMENT_NOT_FOUND');

    const added = await http.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: revision.id, facts: [...revision.facts, fact(userMessageId, 'fact_user1')] } });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    const stated = added.body.facts.find(item => item.id === 'fact_user1');
    assert.equal(stated.evidence[0].kind, 'user_statement');
    assert.equal(stated.evidence[0].message_id, userMessageId);

    const after = (await http.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).body;
    assert.equal(after.fact_revision_id, revision.id, 'the session keeps the version it started from');
    assert.equal(after.head_fact_revision_id, added.body.id);
    const stale = await http.post(`/api/v1/resume-fact-revisions/${revision.id}/supplement-sessions`, { json: {} });
    assert.deepEqual([stale.status, stale.body.code], [409, 'FACT_REVISION_NOT_CURRENT'], 'new sessions start from the current version only');
    assert.equal((await http.post(`/api/v1/resume-fact-revisions/${added.body.id}/supplement-sessions`, { json: {} })).status, 202);
  } finally { await api.stop(); cleanup(); }
});

test('턴 거르기: 사용자 메시지에 없는 후보·새 숫자 초안·평가어 초안은 버리고 질문으로 알린다', () => {
  const facts = [{ id: 'f1', category: 'responsibility', statement: '정산 화면을 개발했습니다.' }];
  const messages = [{ id: 'm1', content: '정산 화면의 조회 속도를 개선했어요.' }];
  const raw = {
    reply: '좋아요.', findings: [{ fact_ids: ['f1', 'nope'], title: '결과', detail: '결과가 없어요.', question: '얼마나 빨라졌나요?' }],
    candidates: [
      { statement: '정산 화면의 조회 속도를 개선했어요.', category: 'achievement', supplements_fact_id: 'f1' },
      { statement: '정산 화면 응답 시간을 70% 줄였습니다.', category: 'achievement', supplements_fact_id: null },
      { statement: '정산 화면의 조회 속도를 개선했어요.', category: 'nonsense', supplements_fact_id: null },
    ],
    drafts: [
      { text: '정산 화면의 조회 속도를 개선했습니다.', fact_ids: ['f1'], note: '어미를 다듬었어요.' },
      { text: '정산 화면 조회 속도를 3배 개선했습니다.', fact_ids: ['f1'], note: '수치를 넣었어요.' },
      { text: '탁월한 역량으로 정산 화면을 개발했습니다.', fact_ids: ['f1'], note: '강조했어요.' },
    ],
    questions: ['어떤 방법으로 개선했나요?'],
  };
  const turn = screenSupplement(raw, { facts, userMessages: messages });
  assert.deepEqual(turn.candidates, [{ statement: '정산 화면의 조회 속도를 개선했어요.', category: 'achievement', supplements_fact_id: 'f1', message_id: 'm1' }]);
  assert.deepEqual(turn.drafts.map(item => item.text), ['정산 화면의 조회 속도를 개선했습니다.']);
  assert.deepEqual(turn.findings[0].fact_ids, ['f1'], 'unknown fact ids are dropped');
  assert.ok(turn.questions.some(item => item.includes('사용자 메시지에 없는')), 'an invented candidate is reported');
  assert.ok(turn.questions.some(item => item.includes('근거')), 'a draft with a new number is reported');
  assert.equal(screenSupplement({ reply: 1 }, { facts, userMessages: messages }), null);
  assert.equal(screenSupplement(null, { facts, userMessages: messages }), null);
});

test('worker: 가짜 provider가 에이전트 문장을 후보로 내도 저장하지 않고, 형식이 틀리면 실패로 끝낸다', async () => {
  const { api, http, revision, cleanup } = await confirmed('supplement-worker-', 'mina');
  try {
    const sessionId = (await http.post(`/api/v1/resume-fact-revisions/${revision.id}/supplement-sessions`, { json: {} })).body.resource_id;
    await runSupplementTask(deps(api));
    await http.post(`/api/v1/resume-supplement-sessions/${sessionId}/messages`, { json: { content: '팀 화면 구조를 정리했어요.' } });
    const inventing = { mode: 'mock', respond: async () => ({ reply: '정리했어요.', findings: [], candidates: [{ statement: '프론트엔드 팀 10명을 리딩하며 매출을 30% 올렸습니다.', category: 'achievement', supplements_fact_id: null }], drafts: [], questions: [] }) };
    assert.equal(await runSupplementTask(deps(api, inventing)), 'succeeded');
    const turn = (await http.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).body.messages.at(-1).turn;
    assert.deepEqual(turn.candidates, []);
    assert.ok(turn.questions.length > 0);

    await http.post(`/api/v1/resume-supplement-sessions/${sessionId}/messages`, { json: { content: '하나 더 말할게요.' } });
    assert.equal(await runSupplementTask(deps(api, { mode: 'mock', respond: async () => ({ nope: true }) })), 'failed');
    const failed = (await http.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).body;
    assert.deepEqual([failed.latest_task.state, failed.latest_task.error_code], ['failed', 'SUPPLEMENT_OUTPUT_INVALID']);
    assert.equal((await http.post(`/api/v1/resume-supplement-sessions/${sessionId}/messages`, { json: { content: '다시 보낼게요.' } })).status, 202, 'a failed turn does not block the next message');
  } finally { await api.stop(); cleanup(); }
});

test('live 요청(전송 없음): 기준일·가림·strict schema, 대화 기록을 담는다', () => {
  const request = buildSupplementRequest({
    facts: [{ id: 'f1', category: 'other', statement: '연락처 test@example.com 010-1234-5678' }],
    patterns: { family: 'general', label: '공통', principles: [], examples: [] },
    history: [{ role: 'assistant', content: '어떤 결과가 있었나요?' }],
    message: '문의 메일은 me@example.com 으로 받았어요.',
  }, 'balanced', new Date('2026-11-19T00:00:00Z'));
  const text = JSON.stringify(request);
  assert.ok(text.includes('2026-11-19'));
  assert.ok(!text.includes('test@example.com') && !text.includes('me@example.com') && !text.includes('010-1234-5678'), 'personal contact data is redacted');
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(request.response_format.json_schema.name, 'resume_supplement');
  assert.ok(request.messages.some(item => item.role === 'assistant' && item.content.includes('어떤 결과')));
});

test('v0.7.4 migration: ce7_tasks 재생성 후 기존 작업·원장·색인이 남고 supplement_resume와 보완 대화 표가 생긴다', () => {
  const { folder, cleanup } = tempFolder('migrate-074-');
  const path = join(folder, 'app.sqlite');
  const H = 'a'.repeat(64);
  try {
    let db = openDatabase(path, readFileSync(contractSchemaUrl, 'utf8'), defaultMigrations().slice(0, 4));
    const insert = (table, values) => db.prepare(`INSERT INTO ${table} (${Object.keys(values)}) VALUES (${Object.keys(values).map(() => '?')})`).run(...Object.values(values));
    db.exec('BEGIN');
    insert('workspaces', { id: 'w1', session_token_hash: 'b'.repeat(64), csrf_token_hash: H, revision: 0, created_at_ms: 0, expires_at_ms: 9, updated_at_ms: 0 });
    insert('ce7_principals', { id: 'p1', auth_subject: 'test:w1', mode: 'synthetic_local', created_at_ms: 0 });
    insert('ce7_workspace_owners', { workspace_id: 'w1', principal_id: 'p1', created_at_ms: 0 });
    insert('ce7_tasks', { id: 't1', workspace_id: 'w1', kind: 'review_resume', state: 'succeeded', input_json: '{}', input_hash: H, available_at_ms: 0, created_at_ms: 0, updated_at_ms: 0 });
    insert('ce7_provider_calls', { id: 'c1', workspace_id: 'w1', task_id: 't1', provider: 'liner', purpose: 'chat', request_hash: H, status: 'succeeded', reserved_micro_usd: 2000, verified_micro_usd: 1000, lease_generation: 1, created_at_ms: 0, updated_at_ms: 0 });
    db.exec('COMMIT');
    assert.throws(() => insert('ce7_tasks', { id: 'early', workspace_id: 'w1', kind: 'supplement_resume', state: 'queued', input_json: '{}', input_hash: H, available_at_ms: 0, created_at_ms: 0, updated_at_ms: 0 }), /CHECK constraint failed/);
    db.close();

    db = openDatabase(path);
    const described = describeDatabase(db);
    assert.ok(described.applied_versions.includes('v0.7.4'));
    assert.equal(described.contract_version, 'v0.7.9', 'later migrations (v0.7.5·v0.7.6 progress columns, v0.7.9 job text) apply on top');
    assert.equal(described.domain_tables, 55);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare("SELECT kind FROM ce7_tasks WHERE id = 't1'").get().kind, 'review_resume');
    assert.equal(db.prepare("SELECT task_id FROM ce7_provider_calls WHERE id = 'c1'").get().task_id, 't1');
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'ce7_tasks_ready'").get());
    assert.equal(db.prepare('SELECT count(*) AS n FROM temp.sqlite_master').get().n, 0);
    db.prepare("INSERT INTO ce7_tasks (id, workspace_id, kind, state, input_json, input_hash, available_at_ms, created_at_ms, updated_at_ms) VALUES ('t2', 'w1', 'supplement_resume', 'queued', '{}', ?, 0, 0, 0)").run(H);
    db.exec('BEGIN');
    db.prepare("INSERT INTO ce7_documents (id, workspace_id, input_kind, filename, mime_type, byte_size, sha256, object_key, data_origin, extraction_status, created_at_ms) VALUES ('d1', 'w1', 'pasted_text', 'a.txt', 'text/plain', 1, ?, 'o1', 'synthetic', 'extracted', 0)").run(H);
    db.prepare("INSERT INTO ce7_fact_revisions (id, workspace_id, document_id, revision, facts_json, content_hash, confirmed_at_ms, created_at_ms) VALUES ('f1', 'w1', 'd1', 1, '[]', ?, 1, 1)").run(H);
    db.exec("UPDATE ce7_documents SET current_fact_revision_id = 'f1' WHERE id = 'd1'");
    db.exec('COMMIT');
    db.exec("INSERT INTO ce8_supplement_sessions (id, workspace_id, document_id, fact_revision_id, provider_mode, state, created_at_ms, updated_at_ms) VALUES ('s1', 'w1', 'd1', 'f1', 'mock', 'open', 0, 0)");
    assert.throws(() => db.exec("INSERT INTO ce8_supplement_sessions (id, workspace_id, document_id, fact_revision_id, provider_mode, state, created_at_ms, updated_at_ms) VALUES ('s2', 'w1', 'nope', 'f1', 'mock', 'open', 0, 0)"), /FOREIGN KEY/);
    db.exec("INSERT INTO ce8_supplement_messages (id, workspace_id, session_id, role, content, result_json, task_id, created_at_ms) VALUES ('m1', 'w1', 's1', 'user', '답변', NULL, NULL, 1)");
    assert.throws(() => db.exec("INSERT INTO ce8_supplement_messages (id, workspace_id, session_id, role, content, result_json, task_id, created_at_ms) VALUES ('m2', 'w1', 's1', 'system', 'x', NULL, NULL, 1)"), /CHECK constraint failed/);
    assert.throws(() => db.exec("UPDATE ce8_supplement_messages SET content = '바꿈' WHERE id = 'm1'"), /SUPPLEMENT_MESSAGE_IMMUTABLE/);
    assert.throws(() => db.exec("UPDATE ce8_supplement_sessions SET fact_revision_id = 'other' WHERE id = 's1'"), /SUPPLEMENT_SESSION_IDENTITY/);
    db.close();
  } finally { cleanup(); }
});

test('mock 초안은 대화체 어미만 이력서 문체로 바꾸고 시제·내용은 그대로 둔다', async () => {
  const provider = createMockSupplementProvider();
  const message = '화면 설계를 직접 맡았어요. 앱 연동 코드를 작성했어요. 배포 담당자였어요. 지금은 서버 개발자예요. 운영 화면을 함께 만들어요.';
  const out = await provider.respond({ facts: [], patterns: [], history: [], message, userMessages: [] });
  assert.deepEqual(out.drafts.map(draft => draft.text), [
    '화면 설계를 직접 맡았습니다.',
    '앱 연동 코드를 작성했습니다.',
    '배포 담당자였습니다.',
    '지금은 서버 개발자입니다.',
  ]);
});

test('답하기 버튼이 붙인 머리말은 대화에는 남고 경력 후보 문장에는 들어가지 않는다', async () => {
  const { userSentenceFor, sentencesOf } = await import('../packages/tailor/src/user-sentence.ts');
  const tailor = '‘코드 리뷰 경험’ 관련: 팀 PR마다 코드 리뷰를 맡아 리뷰 기준 문서를 정리했어요.';
  assert.equal(userSentenceFor(tailor, tailor), '팀 PR마다 코드 리뷰를 맡아 리뷰 기준 문서를 정리했어요.');
  const supplement = '‘결과를 숫자로 말할 수 있나요? (예: 처리 시간)’에 대한 답: 응답 시간을 2초에서 1초로 줄였어요. 캐시를 붙였어요.';
  assert.deepEqual(sentencesOf(supplement), ['응답 시간을 2초에서 1초로 줄였어요.', '캐시를 붙였어요.']);
  assert.equal(userSentenceFor(supplement, '응답 시간을 2초에서 1초로 줄였습니다.'), '응답 시간을 2초에서 1초로 줄였어요.');
  // 맞춤 대화는 이미 쓴 글 다음 줄에 머리말을 붙인다.
  const twoLines = 'React 경험을 강조해줘\n‘코드 리뷰 경험’ 관련: 팀 PR마다 코드 리뷰를 맡았어요.';
  assert.equal(userSentenceFor(twoLines, '‘코드 리뷰 경험’ 관련: 팀 PR마다 코드 리뷰를 맡았어요.'), '팀 PR마다 코드 리뷰를 맡았어요.');
  // 괄호로 시작하는 진짜 문장은 자르지 않는다.
  assert.equal(userSentenceFor('(주)예시플레이에서 정산 화면을 개발했어요.', '(주)예시플레이에서 정산 화면을 개발했어요.'), '(주)예시플레이에서 정산 화면을 개발했어요.');
  const out = await createMockSupplementProvider().respond({ facts: [], patterns: [], history: [], message: supplement, userMessages: [] });
  assert.ok(out.candidates.every(item => !item.statement.includes('에 대한 답')), JSON.stringify(out.candidates));
});
