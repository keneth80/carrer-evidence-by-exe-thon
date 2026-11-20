import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { openDatabase, describeDatabase, defaultMigrations, contractSchemaUrl } from '../packages/db/src/index.ts';
import { baseBlocks } from '../packages/tailor/src/blocks.ts';
import { ChatProviderError } from '../packages/tailor/src/provider.ts';
import { checkRequirements, createMockTailorStageProvider, screenJdReview } from '../packages/tailor/src/jd-check.ts';
import { runTailorPipeline } from '../packages/tailor/src/tailor-pipeline.ts';
import { buildJdReviewRequest, buildTailorCriticRequest, createLinerTailorStageProvider } from '../packages/liner/src/tailor-stages.ts';
import { createLinerChatProvider } from '../packages/liner/src/chat.ts';
import { createLinerLedger, readLinerUsage } from '../apps/worker/src/liner-ledger.ts';
import { progressView, TAILOR_PROGRESS } from '../apps/web/src/resume/progress.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { startTailoring, current, runTailor } from './helpers/s04-harness.mjs';

// S1-18 공고(JD) 맞춤 점검·수정 오케스트레이션: ① 요구사항 대조 → ② AI 점검(첫 턴) / ③ 수정안 작성 → ④ 근거 검토(답변 턴).
// 네트워크 없이 mock·가짜 provider만 쓴다. 합성 이력서·합성 공고만 쓴다.

const JOB = {
  company_name: '합성회사', title: '프론트엔드 개발자', content_text: '합성 공고 본문',
  requirements: [
    { id: 'r1', text: 'React 기반 웹 개발 경험', importance: 'required', source_quote: 'React 기반 웹 개발 경험' },
    { id: 'r2', text: 'TypeScript 사용 경험', importance: 'required', source_quote: 'TypeScript 사용 경험' },
    { id: 'r3', text: '디자인 시스템 구축 경험', importance: 'preferred', source_quote: '디자인 시스템 구축 경험' },
  ],
};
const FACTS = [
  { id: 'f1', category: 'role', statement: '프론트엔드 개발자' },
  { id: 'f2', category: 'skill', statement: 'React' },
  { id: 'f3', category: 'skill', statement: 'TypeScript' },
  { id: 'f4', category: 'responsibility', statement: 'React로 정산 화면을 개발했습니다.' },
];
const BLOCKS = baseBlocks(FACTS);
const ANSWER = 'TypeScript로 정산 화면의 타입을 정리했어요.';

function harness({ chat, stages }) {
  const calls = [];
  const snapshots = [];
  const wrap = (name, fn) => input => { calls.push(name); return fn(input); };
  const deps = {
    chat: { mode: chat.mode, respond: wrap('respond', input => chat.respond(input)) },
    stages: stages && { mode: stages.mode, review: wrap('review', input => stages.review(input)), critic: wrap('critic', input => stages.critic(input)) },
    taskId: 'task_1', now: () => 1_800_000_000_000,
    report: progress => { snapshots.push(structuredClone(progress)); return true; },
    invoke: work => work(new AbortController().signal),
  };
  return { deps, calls, snapshots };
}
const stateOf = progress => Object.fromEntries(progress.stages.map(stage => [stage.key, stage.state]));
const chatWith = changes => ({ mode: 'mock', respond: async () => ({ reply: '수정안을 만들었어요.', changes, questions: [] }) });
const skills = BLOCKS.find(block => block.id === 'blk_skills');
const duty = BLOCKS.find(block => block.fact_ids.includes('f4'));
const answerInput = { job: JOB, facts: FACTS, blocks: BLOCKS, history: [], message: ANSWER, userMessages: [{ id: 'm1', content: ANSWER }] };

test('요구사항 대조: 업무 문장 근거가 있으면 충족, 기술 이름만 있으면 근거 약함, 없으면 미기재(경험 없음으로 단정하지 않음)', () => {
  const frozen = structuredClone(FACTS);
  const checks = checkRequirements(FACTS, JOB);
  assert.deepEqual(checks.map(item => [item.requirement_id, item.status]), [['r1', 'met'], ['r2', 'weak'], ['r3', 'missing']]);
  assert.deepEqual(checks[0].fact_ids.sort(), ['f2', 'f4'], 'skill + the duty sentence that uses it');
  assert.deepEqual(checks[1].fact_ids, ['f3']);
  assert.deepEqual(checks[2].fact_ids, []);
  assert.ok(!/경험 없음$|경험이 없습니다/.test(checks[2].note) && /단정하지 않|뜻은 아니/.test(checks[2].note), 'missing is not "no experience"');
  assert.deepEqual(FACTS, frozen, 'facts are not mutated');
  assert.deepEqual(checkRequirements([], { ...JOB, requirements: [] }), []);
});

test('AI 점검 응답은 서버가 다시 거른다: 없는 요구·충족 요구·모르는 fact id·빈 질문은 버리고, 형식이 틀리면 null', () => {
  const checks = checkRequirements(FACTS, JOB);
  const screened = screenJdReview({ reply: '두 가지를 물어볼게요.', questions: ['추가 질문'], findings: [
    { requirement_id: 'r2', fact_ids: ['f3'], title: '쓰임새가 없어요', question: 'TypeScript를 어디에 썼나요?' },
    { requirement_id: 'r1', fact_ids: ['f2'], title: '이미 충족', question: '또 묻기' },
    { requirement_id: 'r9', fact_ids: [], title: '없는 요구', question: '?' },
    { requirement_id: 'r3', fact_ids: ['f99'], title: '모르는 근거', question: '디자인 시스템을 만든 적이 있나요?' },
    { requirement_id: 'r3', fact_ids: [], title: '빈 질문', question: '' },
  ] }, checks, FACTS);
  assert.deepEqual(screened.findings.map(item => item.requirement_id), ['r2', 'r3']);
  assert.deepEqual(screened.findings[1].fact_ids, [], 'unknown fact ids are removed');
  assert.deepEqual(screened.questions, ['추가 질문']);
  assert.equal(screenJdReview({ reply: 'x' }, checks, FACTS), null);
  assert.equal(screenJdReview(null, checks, FACTS), null);
});

test('첫 턴(JD 점검): ① 요구사항 대조 결과를 ② AI 점검에 넘기고 질문만 낸다. 수정안·근거 검토는 건너뛰고 진행 기록은 단계 순서대로 바뀐다', async () => {
  const mock = createMockTailorStageProvider();
  let reviewInput = null;
  const stages = { ...mock, review: async input => { reviewInput = input; return mock.review(input); } };
  const { deps, calls, snapshots } = harness({ chat: chatWith([]), stages });
  const result = await runTailorPipeline(deps, { ...answerInput, message: null, userMessages: [] });
  assert.equal(result.kind, 'ok');
  assert.deepEqual(calls, ['review'], 'no chat edit call on the JD check');
  assert.deepEqual(reviewInput.checks.map(item => item.status), ['met', 'weak', 'missing']);
  assert.deepEqual(stateOf(snapshots[0]), { match: 'running', review: 'pending', draft: 'pending', critic: 'pending' });
  assert.deepEqual(stateOf(snapshots.at(-1)), { match: 'done', review: 'done', draft: 'skipped', critic: 'skipped' });
  assert.deepEqual([...new Set(snapshots.map(item => item.stages.find(stage => stage.state === 'running')?.key).filter(Boolean))], ['match', 'review']);
  assert.equal(snapshots[0].stages[0].label, '요구사항 대조');
  assert.deepEqual(result.changes, []);
  assert.equal(result.turn.kind, 'jd_check');
  assert.equal(result.turn.requirements.length, 3);
  assert.deepEqual(result.turn.findings.map(item => item.requirement_id), ['r2', 'r3'], 'questions only for weak / missing requirements');
  assert.ok(result.questions.length >= 2);
  assert.equal(result.turn.pipeline.requirements_checked, 3);
});

test('첫 턴: AI 점검이 실패해도 대조 결과는 보여 주고 실패를 숨기지 않는다. 점검 provider가 없으면 AI 점검을 건너뛴다고 적는다', async () => {
  const broken = { ...createMockTailorStageProvider(), review: async () => { throw new ChatProviderError('MOCK_REVIEW_FAILED', 'x'); } };
  const failed = harness({ chat: chatWith([]), stages: broken });
  const result = await runTailorPipeline(failed.deps, { ...answerInput, message: null, userMessages: [] });
  assert.equal(result.kind, 'ok');
  assert.equal(stateOf(failed.snapshots.at(-1)).review, 'failed');
  assert.match(result.reply, /HR 전문가 점검은 하지 못했어요/);
  assert.equal(result.turn.requirements.length, 3);

  const none = harness({ chat: chatWith([]), stages: null });
  const skipped = await runTailorPipeline(none.deps, { ...answerInput, message: null, userMessages: [] });
  assert.equal(skipped.kind, 'ok');
  assert.equal(stateOf(none.snapshots.at(-1)).review, 'skipped');
  assert.deepEqual(none.calls, []);
});

test('답변 턴: ④ 근거 검토가 뺀 수정안은 이유와 남고, keep이어도 결정적 가드가 다시 거른다. 사용자 문장 후보는 근거 검토 없이 남는다', async () => {
  const changes = [
    { operation: 'replace', block_id: skills.id, before: skills.text, after: 'TypeScript · React', fact_ids: ['f3', 'f2'], reason: '공고 요구 기술을 앞에', needs_fact_confirmation: false },
    { operation: 'replace', block_id: duty.id, before: duty.text, after: 'React로 정산 화면 개발을 총괄했습니다.', fact_ids: ['f4'], reason: '범위', needs_fact_confirmation: false },
    { operation: 'insert', block_id: 'blk_stmt_1', before: null, after: ANSWER, fact_ids: [], reason: '사용자 진술', needs_fact_confirmation: true },
  ];
  const { deps, calls, snapshots } = harness({ chat: chatWith(changes), stages: createMockTailorStageProvider() });
  const result = await runTailorPipeline(deps, answerInput);
  assert.equal(result.kind, 'ok');
  assert.deepEqual(calls, ['respond', 'critic']);
  assert.deepEqual(result.changes.map(item => item.block_id), [skills.id, 'blk_stmt_1']);
  assert.deepEqual(result.turn.pipeline.dropped_changes.map(item => [item.by, item.text]), [['critic', 'React로 정산 화면 개발을 총괄했습니다.']]);
  assert.match(result.turn.pipeline.dropped_changes[0].reason, /총괄/);
  assert.deepEqual(stateOf(snapshots.at(-1)), { match: 'skipped', review: 'skipped', draft: 'done', critic: 'done' });
  // 품질 검증(2026-11-20): 답이 근거 검토에서 빠진 수정('총괄')까지 했다고 말했다 → 빠진 수정이 있으면 답에 알린다.
  assert.match(result.reply, /근거 검토에서 수정안 1개를 뺐어요/);
  assert.equal(result.turn.kind, 'answer');
  assert.equal(result.turn.pipeline.changes_reviewed, 2, 'only edits go to the critic; the user statement does not');

  // 근거 검토가 모두 keep이어도 근거에 없는 수치는 결정적 가드가 뺀다.
  const lenient = { ...createMockTailorStageProvider(), critic: async input => ({ verdicts: input.changes.map(change => ({ index: change.index, verdict: 'keep', reason: '좋아요' })) }) };
  const inflated = [{ operation: 'replace', block_id: duty.id, before: duty.text, after: 'React로 정산 화면을 개발해 속도를 3배 높였습니다.', fact_ids: ['f4'], reason: '수치', needs_fact_confirmation: false }];
  const guarded = await runTailorPipeline(harness({ chat: chatWith(inflated), stages: lenient }).deps, answerInput);
  assert.deepEqual(guarded.changes, []);
  assert.deepEqual(guarded.turn.pipeline.dropped_changes.map(item => item.by), ['guard']);
  assert.ok(guarded.questions.some(text => text.includes('근거')), 'the guard reason is still asked as a question');
});

test('답변 턴 닫힌 쪽 실패: 근거 검토가 거절·형식 오류·판정 누락이면 수정안을 보이지 않고, 사용자 문장 후보는 남는다', async () => {
  const changes = [
    { operation: 'replace', block_id: skills.id, before: skills.text, after: 'TypeScript · React', fact_ids: ['f3', 'f2'], reason: '기술', needs_fact_confirmation: false },
    { operation: 'reorder', block_id: duty.id, before: null, after: null, fact_ids: ['f4'], reason: '순서', needs_fact_confirmation: false },
    { operation: 'insert', block_id: 'blk_stmt_1', before: null, after: ANSWER, fact_ids: [], reason: '사용자 진술', needs_fact_confirmation: true },
  ];
  const refused = { mode: 'live', review: async () => ({}), critic: async () => { throw new ChatProviderError('LINER_CALL_LIMIT', '한도', 'not_dispatched'); } };
  const a = harness({ chat: { ...chatWith(changes), mode: 'live' }, stages: refused });
  const withheld = await runTailorPipeline(a.deps, answerInput);
  assert.equal(withheld.kind, 'ok');
  assert.deepEqual(withheld.changes.map(item => item.block_id), ['blk_stmt_1']);
  assert.equal(withheld.turn.pipeline.changes_withheld, true);
  assert.equal(stateOf(a.snapshots.at(-1)).critic, 'failed');
  assert.ok(withheld.questions.some(text => text.includes('근거 검토')));
  assert.equal(withheld.transmission, 'completed', 'the draft call went out; the refused critic did not');

  const invalid = await runTailorPipeline(harness({ chat: chatWith(changes), stages: { ...createMockTailorStageProvider(), critic: async () => ({ nope: true }) } }).deps, answerInput);
  assert.equal(invalid.turn.pipeline.changes_withheld, true);
  assert.deepEqual(invalid.changes.map(item => item.block_id), ['blk_stmt_1']);

  const partial = await runTailorPipeline(harness({ chat: chatWith(changes), stages: { ...createMockTailorStageProvider(), critic: async () => ({ verdicts: [{ index: 0, verdict: 'keep', reason: '근거와 맞아요' }] }) } }).deps, answerInput);
  assert.deepEqual(partial.changes.map(item => item.block_id), [skills.id, 'blk_stmt_1']);
  assert.deepEqual(partial.turn.pipeline.dropped_changes.map(item => item.by), ['critic'], 'a change without a verdict is dropped');

  const lost = { mode: 'live', review: async () => ({}), critic: async () => { throw new ChatProviderError('LINER_TRANSMISSION_UNKNOWN', '불명', 'unknown'); } };
  const unknown = await runTailorPipeline(harness({ chat: { ...chatWith(changes), mode: 'live' }, stages: lost }).deps, answerInput);
  assert.equal(unknown.transmission, 'unknown');
  assert.equal(unknown.turn.pipeline.changes_withheld, true);
});

test('답변 턴: 수정안 형식이 틀리거나 호출이 실패하면 턴이 실패한다. lease를 잃으면 멈춘다', async () => {
  const invalid = await runTailorPipeline(harness({ chat: { mode: 'mock', respond: async () => ({ nope: true }) }, stages: createMockTailorStageProvider() }).deps, answerInput);
  assert.deepEqual(invalid, { kind: 'failed', code: 'CHAT_OUTPUT_INVALID', transmission: 'completed' });
  const thrown = await runTailorPipeline(harness({ chat: { mode: 'mock', respond: async () => { throw new ChatProviderError('MOCK_CHAT_FAILURE', 'x'); } }, stages: createMockTailorStageProvider() }).deps, answerInput);
  assert.equal(thrown.kind, 'failed');
  assert.equal(thrown.code, 'MOCK_CHAT_FAILURE');

  const { deps } = harness({ chat: chatWith([]), stages: createMockTailorStageProvider() });
  let reports = 0;
  const lost = await runTailorPipeline({ ...deps, report: () => ++reports < 2 }, { ...answerInput, message: null, userMessages: [] });
  assert.deepEqual(lost, { kind: 'lease_lost' });
});

test('worker + API: JD 점검 요청 → 진행 기록·요구사항 점검표가 보이고, 답변 턴은 수정안 작성·근거 검토 단계로 끝난다', async () => {
  const { folder, cleanup } = tempFolder('tailor-pipeline-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, `jd-${randomUUID().slice(0, 8)}`));
    const started = await startTailoring(api, http);
    const sessionId = started.session.id;
    const { revision } = await current(http, sessionId);
    const asked = await http.post(`/api/v1/tailoring-sessions/${sessionId}/jd-checks`, { json: { expected_resume_revision_id: revision.id } });
    assert.equal(asked.status, 202);
    assert.equal(asked.body.resource_id, sessionId);
    const again = await http.post(`/api/v1/tailoring-sessions/${sessionId}/jd-checks`, { json: { expected_resume_revision_id: revision.id } });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'RESPONSE_PENDING');
    const stale = await http.post(`/api/v1/tailoring-sessions/${sessionId}/jd-checks`, { json: { expected_resume_revision_id: 'resume_other' } });
    assert.equal(stale.status, 409);
    assert.equal((await http.get(`/api/v1/tailoring-sessions/${sessionId}`)).body.progress, null, 'no progress before the worker runs');

    const stages = createMockTailorStageProvider();
    assert.equal(await runTailor(api, { stages }), 'succeeded');
    const checked = (await http.get(`/api/v1/tailoring-sessions/${sessionId}`)).body;
    assert.equal(checked.progress.task_id, asked.body.task.id);
    assert.deepEqual(checked.progress.stages.map(stage => [stage.key, stage.state]), [['match', 'done'], ['review', 'done'], ['draft', 'skipped'], ['critic', 'skipped']]);
    assert.ok(checked.progress.stages.every(stage => stage.state === 'skipped' || stage.finished_at));
    const messages = (await http.get(`/api/v1/tailoring-sessions/${sessionId}/messages`)).body.items;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'assistant');
    assert.equal(messages[0].turn.kind, 'jd_check');
    assert.ok(messages[0].turn.requirements.length > 0);
    assert.ok(messages[0].turn.requirements.every(item => ['met', 'weak', 'missing'].includes(item.status)));
    const task = (await http.get(`/api/v1/product-tasks/${asked.body.task.id}`)).body;
    assert.equal(task.state, 'succeeded');

    const sent = await http.post(`/api/v1/tailoring-sessions/${sessionId}/messages`, { json: { expected_resume_revision_id: revision.id, content: '이 공고에 맞춰 수정해줘' } });
    assert.equal(sent.status, 202);
    assert.equal(await runTailor(api, { stages }), 'succeeded');
    const answered = (await http.get(`/api/v1/tailoring-sessions/${sessionId}`)).body;
    assert.equal(answered.progress.task_id, sent.body.task.id);
    assert.deepEqual(answered.progress.stages.map(stage => stage.state).slice(0, 3), ['skipped', 'skipped', 'done']);
    const last = (await http.get(`/api/v1/tailoring-sessions/${sessionId}/messages`)).body.items.at(-1);
    assert.equal(last.turn.kind, 'answer');
    assert.equal(last.turn.pipeline.mode, 'staged');

    // 다른 사용자는 점검을 요청할 수 없다.
    const other = client(api, await login(api, `jd-other-${randomUUID().slice(0, 8)}`));
    assert.equal((await other.post(`/api/v1/tailoring-sessions/${sessionId}/jd-checks`, { json: { expected_resume_revision_id: revision.id } })).status, 404);
  } finally { await api.stop(); cleanup(); }
});

test('v0.7.6 migration: 기존 편집 세션·메시지를 지우지 않고 progress_json·result_json 열만 더한다(JSON 검사)', () => {
  const { folder, cleanup } = tempFolder('migrate-076-');
  const path = join(folder, 'app.sqlite');
  try {
    let db = openDatabase(path, readFileSync(contractSchemaUrl, 'utf8'), defaultMigrations().slice(0, 6));
    assert.equal(describeDatabase(db).contract_version, 'v0.7.5');
    db.close();
    db = openDatabase(path);
    const described = describeDatabase(db);
    assert.equal(described.contract_version, 'v0.7.6');
    assert.equal(described.domain_tables, 55);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const sessionColumns = db.prepare('PRAGMA table_info(ce7_tailoring_sessions)').all().map(row => row.name);
    const messageColumns = db.prepare('PRAGMA table_info(ce7_messages)').all().map(row => row.name);
    assert.ok(sessionColumns.includes('progress_json'));
    assert.ok(messageColumns.includes('result_json'));
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE name IN ('ce7_tailoring_sessions', 'ce7_messages')").all().map(row => row.sql).join('\n');
    assert.equal((ddl.match(/json_valid/g) ?? []).length, 2, 'both new columns only accept JSON');
    db.close();
  } finally { cleanup(); }
});

test('Liner 단계 요청(전송 없음): JD 점검은 요구사항 상태·기준일을, 근거 검토는 수정안 번호와 strict schema를 담고 연락처는 가린다. 원장 정보 없으면 보내지 않는다', async () => {
  const checks = checkRequirements(FACTS, JOB);
  const review = buildJdReviewRequest({ job: JOB, facts: [...FACTS, { id: 'f9', category: 'other', statement: '연락처 test@example.com' }], checks }, 'balanced', new Date('2026-11-19T00:00:00Z'));
  const reviewText = JSON.stringify(review);
  assert.ok(reviewText.includes('2026-11-19') && reviewText.includes('weak') && reviewText.includes('missing'));
  assert.ok(!reviewText.includes('test@example.com'));
  assert.equal(review.response_format.json_schema.strict, true);
  assert.match(review.messages[0].content, /경험 없음으로 단정하지/);
  const critic = buildTailorCriticRequest({ job: JOB, facts: FACTS, userMessages: [{ id: 'm1', content: '010-1234-5678로 연락 주세요. TypeScript를 썼어요.' }],
    changes: [{ index: 0, operation: 'replace', before: skills.text, after: 'TypeScript · React', fact_ids: ['f3', 'f2'] }] }, 'balanced', new Date('2026-11-19T00:00:00Z'));
  const criticText = JSON.stringify(critic);
  assert.ok(criticText.includes('TypeScript · React') && !criticText.includes('010-1234-5678'));
  assert.deepEqual(critic.response_format.json_schema.schema.properties.verdicts.items.properties.verdict.enum, ['keep', 'drop']);

  let fetched = 0;
  const provider = createLinerTailorStageProvider({ apiKey: 'k', fetch: async () => { fetched++; return new Response('{}'); }, ledger: { reserve: () => { throw new Error('no'); }, dispatch: () => false, settle: () => undefined } });
  await assert.rejects(provider.review({ job: JOB, facts: FACTS, checks }), { code: 'LINER_CALL_CONTEXT_REQUIRED', transmission: 'not_dispatched' });
  assert.equal(fetched, 0);
});

test('화면 진행 계산: JD 점검은 요구사항 대조·AI 점검, 답변 턴은 수정안 작성·근거 검토를 진행 단계로 센다', () => {
  const first = progressView(null, 'task_1', 'staged', true, TAILOR_PROGRESS);
  assert.deepEqual(first.stages.map(stage => [stage.label, stage.state]), [['요구사항 대조', 'pending'], ['HR 전문가 점검', 'pending'], ['수정안 작성', 'skipped'], ['근거 검토', 'skipped']]);
  assert.equal(first.total, 2);
  const answer = progressView(null, 'task_1', 'staged', false, TAILOR_PROGRESS);
  assert.deepEqual(answer.stages.map(stage => stage.state), ['skipped', 'skipped', 'pending', 'pending']);
  const running = progressView({ task_id: 'task_1', mode: 'staged', started_at: '2026-11-19T00:00:00.000Z', stages: [
    { key: 'match', label: '요구사항 대조', state: 'done', note: null, started_at: null, finished_at: null },
    { key: 'review', label: 'HR 전문가 점검', state: 'running', note: null, started_at: null, finished_at: null },
    { key: 'draft', label: '수정안 작성', state: 'skipped', note: null, started_at: null, finished_at: null },
    { key: 'critic', label: '근거 검토', state: 'skipped', note: null, started_at: null, finished_at: null },
  ] }, 'task_1', 'staged', true, TAILOR_PROGRESS);
  assert.equal(running.position, 2);
  assert.match(running.message, /공고 요구/);
  // 보완 대화 기본값은 그대로다.
  assert.equal(progressView(null, 't', 'staged', true).stages[0].label, '규칙 점검');
});

test('live(가짜 fetch): JD 점검 1건 + 답변 턴 2건(수정안 작성·근거 검토)이 원장에 각각 chat으로 예약되고, 근거 검토가 불명이면 작업도 불명으로 남는다', async () => {
  const { folder, cleanup } = tempFolder('tailor-live-');
  const api = await startApi(folder);
  try {
    api.config.chatMode = 'live';
    const http = client(api, await login(api, `jd-live-${randomUUID().slice(0, 8)}`));
    const started = await startTailoring(api, http);
    const sessionId = started.session.id;
    const names = [];
    let criticFails = false;
    const fetchFn = async (_url, init) => {
      const body = JSON.parse(init.body);
      const name = body.response_format.json_schema.name;
      names.push(name);
      if (name === 'tailor_change_critic' && criticFails) throw new TypeError('socket hang up');
      const context = body.messages.map(item => item.content).join('\n');
      const content = name === 'jd_check_review'
        ? { reply: '근거가 약한 요구를 물어볼게요.', findings: [], questions: ['어떤 화면을 만들었나요?'] }
        : name === 'tailor_change_critic'
          ? { verdicts: [{ index: 0, verdict: 'keep', reason: '순서만 바꿔요.' }] }
          : (() => { const blocks = JSON.parse(context.split('편집 자료(JSON):\n')[1].split('\n')[0]).blocks; const target = blocks.filter(block => block.section === '경력 내용').at(-1);
            return { reply: '순서를 바꿨어요.', questions: [], changes: [{ operation: 'reorder', block_id: target.id, before: null, after: null, fact_ids: target.fact_ids, reason: '공고 요구와 연결', needs_fact_confirmation: false }] }; })();
      return new Response(JSON.stringify({ model: 'claude-sonnet-5.5', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }), { status: 200 });
    };
    const owner = `tailor-${randomUUID()}`;
    const ledger = createLinerLedger({ db: api.db, owner, now: Date.now, maxCalls: 10, budgetMicroUsd: 5_000_000 });
    const linerDeps = { apiKey: 'test-key-tailor-stages', fetch: fetchFn, ledger };
    const overrides = { owner, provider: createLinerChatProvider(linerDeps), stages: createLinerTailorStageProvider(linerDeps) };

    const { revision } = await current(http, sessionId);
    const asked = await http.post(`/api/v1/tailoring-sessions/${sessionId}/jd-checks`, { json: { expected_resume_revision_id: revision.id } });
    assert.equal(await runTailor(api, overrides), 'succeeded');
    assert.deepEqual(names, ['jd_check_review']);
    const sent = await http.post(`/api/v1/tailoring-sessions/${sessionId}/messages`, { json: { expected_resume_revision_id: revision.id, content: '이 공고에 맞춰줘' } });
    assert.equal(await runTailor(api, overrides), 'succeeded');
    assert.deepEqual(names, ['jd_check_review', 'resume_edit', 'tailor_change_critic']);
    const usage = readLinerUsage(api.db, 'chat');
    assert.equal(usage.calls, 3, 'each stage call is reserved separately in the chat ledger');
    const rows = api.db.prepare('SELECT task_id FROM ce7_provider_calls WHERE purpose = ? ORDER BY created_at_ms, rowid').all('chat').map(row => row.task_id);
    assert.deepEqual(rows, [asked.body.task.id, sent.body.task.id, sent.body.task.id]);

    criticFails = true;
    const third = await http.post(`/api/v1/tailoring-sessions/${sessionId}/messages`, { json: { expected_resume_revision_id: revision.id, content: '한 번 더 맞춰줘' } });
    assert.equal(await runTailor(api, overrides), 'succeeded', 'the turn still ends; the edits are withheld');
    const task = api.db.prepare('SELECT state, provider_transmission FROM ce7_tasks WHERE id = ?').get(third.body.task.id);
    assert.deepEqual({ ...task }, { state: 'succeeded', provider_transmission: 'unknown' });
    const last = (await http.get(`/api/v1/tailoring-sessions/${sessionId}/messages`)).body.items.at(-1);
    assert.equal(last.turn.pipeline.changes_withheld, true);
    assert.equal(readLinerUsage(api.db, 'chat').unknown_calls, 1);
  } finally { await api.stop(); cleanup(); }
});
