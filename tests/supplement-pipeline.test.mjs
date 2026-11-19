import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { openDatabase, describeDatabase, defaultMigrations, contractSchemaUrl } from '../packages/db/src/index.ts';
import { runSupplementPipeline } from '../packages/tailor/src/supplement-pipeline.ts';
import { createMockSupplementProvider } from '../packages/tailor/src/supplement.ts';
import { ChatProviderError } from '../packages/tailor/src/provider.ts';
import { buildCriticRequest, buildReviewStageRequest } from '../packages/liner/src/supplement.ts';
import { runSupplementTask } from '../apps/worker/src/supplement-task.ts';
import { runSupplementEval, loadEvalFixtures } from '../packages/tailor/src/supplement-eval.ts';
import { normalizeStatement, replaceTarget, replaceFact } from '../apps/web/src/resume/similar.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { confirmFixture } from './helpers/s02-harness.mjs';

// S1-17 보완 대화 오케스트레이션: ① 규칙 점검 → ② AI 점검(첫 턴) / ③ 초안 → ④ 근거 검토(답변 턴), 단계별 진행 기록.
// 네트워크 없이 mock·가짜 provider만 쓴다. 합성 자료만 쓴다.

const PATTERNS = { family: 'general', label: '공통', principles: [], examples: [] };
const FACTS = [
  { id: 'f1', category: 'role', statement: '프론트엔드 개발자' },
  { id: 'f2', category: 'responsibility', statement: '정산 화면 개발을 리딩했습니다.' },
  { id: 'f3', category: 'skill', statement: 'React' },
];
const MESSAGES = [{ id: 'm1', content: '정산 화면의 조회 속도를 개선했어요. 응답 시간을 2초에서 0.5초로 줄였어요.' }];

// 호출 순서와 단계 진행 기록을 모으는 가짜 provider·hook.
function harness(provider, mode = 'staged') {
  const calls = [];
  const snapshots = [];
  const wrapped = {
    mode: provider.mode,
    respond: input => { calls.push('respond'); return provider.respond(input); },
    review: input => { calls.push('review'); return provider.review(input); },
    critic: input => { calls.push('critic'); return provider.critic(input); },
  };
  const deps = { provider: wrapped, mode, taskId: 'task_1', now: () => 1_800_000_000_000, report: progress => { snapshots.push(structuredClone(progress)); return true; }, invoke: work => work(new AbortController().signal) };
  return { deps, calls, snapshots };
}
const stateOf = progress => Object.fromEntries(progress.stages.map(stage => [stage.key, stage.state]));

test('첫 턴(staged): ① 규칙 점검 결과를 ② AI 점검에 넘기고, 초안·근거 검토는 건너뛴다. 진행 기록은 단계 순서대로 바뀐다', async () => {
  const mock = createMockSupplementProvider();
  let reviewInput = null;
  const provider = { ...mock, review: async input => { reviewInput = input; return mock.review(input); } };
  const { deps, calls, snapshots } = harness(provider);
  const result = await runSupplementPipeline(deps, { facts: FACTS, patterns: PATTERNS, history: [], message: null, userMessages: [] });
  assert.equal(result.kind, 'ok');
  assert.deepEqual(calls, ['review']);
  assert.ok(Array.isArray(reviewInput.ruleFindings) && reviewInput.ruleFindings.length > 0, 'rule findings are handed to the AI reviewer');
  assert.deepEqual(stateOf(snapshots[0]), { rules: 'running', review: 'pending', draft: 'pending', critic: 'pending' });
  assert.deepEqual(stateOf(snapshots.at(-1)), { rules: 'done', review: 'done', draft: 'skipped', critic: 'skipped' });
  const order = snapshots.map(item => item.stages.find(stage => stage.state === 'running')?.key).filter(Boolean);
  assert.deepEqual([...new Set(order)], ['rules', 'review']);
  const { pipeline } = result.turn;
  assert.equal(pipeline.mode, 'staged');
  assert.ok(pipeline.rule_findings > 0);
  assert.ok(result.turn.findings.length >= pipeline.rule_findings, 'rule findings come first, AI findings after');
  assert.ok(result.turn.findings.some(item => item.question), 'questions the user can answer');
  assert.equal(result.transmission, 'completed');
});

test('답변 턴(staged): ③ 초안 → ④ 근거 검토 순서, 비판자가 뺀 초안은 이유와 함께 기록되고 통과한 초안에도 결정적 가드가 다시 돈다', async () => {
  const provider = {
    mode: 'mock',
    respond: async () => ({ reply: '정리했어요.', findings: [], questions: [],
      candidates: [{ statement: '정산 화면의 조회 속도를 개선했어요.', category: 'achievement', supplements_fact_id: 'f2' }],
      drafts: [
        { text: '정산 화면 조회 응답 시간을 2초에서 0.5초로 줄였습니다.', fact_ids: ['f2'], note: '어미' },
        { text: '정산 화면 개발을 총괄하며 조회 속도를 개선했습니다.', fact_ids: ['f2'], note: '범위' },
        { text: '정산 화면 조회 속도를 70% 개선했습니다.', fact_ids: ['f2'], note: '수치' },
      ] }),
    review: async () => { throw new Error('not used'); },
    critic: async input => ({ verdicts: input.drafts.map(draft => draft.index === 1 ? { index: 1, verdict: 'drop', reason: '사용자는 총괄했다고 말하지 않았어요.' } : { index: draft.index, verdict: 'keep', reason: '답변에 있는 내용이에요.' }) }),
  };
  const { deps, calls, snapshots } = harness(provider);
  const result = await runSupplementPipeline(deps, { facts: FACTS, patterns: PATTERNS, history: [], message: MESSAGES[0].content, userMessages: MESSAGES });
  assert.equal(result.kind, 'ok');
  assert.deepEqual(calls, ['respond', 'critic']);
  assert.deepEqual(stateOf(snapshots.at(-1)), { rules: 'skipped', review: 'skipped', draft: 'done', critic: 'done' });
  const order = snapshots.map(item => item.stages.find(stage => stage.state === 'running')?.key).filter(Boolean);
  assert.deepEqual([...new Set(order)], ['draft', 'critic']);
  assert.deepEqual(result.turn.candidates.map(item => item.statement), ['정산 화면의 조회 속도를 개선했어요.']);
  assert.deepEqual(result.turn.drafts.map(item => item.text), ['정산 화면 조회 응답 시간을 2초에서 0.5초로 줄였습니다.']);
  const dropped = result.turn.pipeline.dropped_drafts;
  assert.deepEqual(dropped.map(item => [item.by, item.text]), [
    ['critic', '정산 화면 개발을 총괄하며 조회 속도를 개선했습니다.'],
    ['guard', '정산 화면 조회 속도를 70% 개선했습니다.'],
  ], 'the critic kept the 70% draft but the deterministic guard still removed it');
  assert.match(dropped[0].reason, /총괄/);
  assert.equal(result.turn.pipeline.drafts_reviewed, 3);
  assert.equal(result.turn.pipeline.drafts_withheld, false);
});

test('근거 검토 실패는 닫힌 쪽으로: 초안은 보이지 않고 후보는 남는다. 판정이 빠진 초안도 뺀다', async () => {
  const drafting = { reply: '정리했어요.', findings: [], questions: [],
    candidates: [{ statement: '정산 화면의 조회 속도를 개선했어요.', category: 'achievement', supplements_fact_id: null }],
    drafts: [{ text: '정산 화면의 조회 속도를 개선했습니다.', fact_ids: [], note: '어미' }, { text: '응답 시간을 2초에서 0.5초로 줄였습니다.', fact_ids: [], note: '어미' }] };
  const refused = { mode: 'live', respond: async () => drafting, review: async () => ({}), critic: async () => { throw new ChatProviderError('LINER_CALL_LIMIT', '한도', 'not_dispatched'); } };
  const first = await runSupplementPipeline(harness(refused).deps, { facts: FACTS, patterns: PATTERNS, history: [], message: MESSAGES[0].content, userMessages: MESSAGES });
  assert.equal(first.kind, 'ok');
  assert.deepEqual(first.turn.drafts, []);
  assert.equal(first.turn.pipeline.drafts_withheld, true);
  assert.equal(first.turn.candidates.length, 1, 'candidates are the user\'s own sentences and stay');
  assert.equal(first.turn.pipeline.stages.find(stage => stage.key === 'critic').state, 'failed');
  assert.equal(first.transmission, 'completed', 'the draft call completed; the refused critic call never left');

  const unknown = { ...refused, critic: async () => { throw new ChatProviderError('LINER_TIMEOUT', '응답 없음', 'unknown'); } };
  const second = await runSupplementPipeline(harness(unknown).deps, { facts: FACTS, patterns: PATTERNS, history: [], message: MESSAGES[0].content, userMessages: MESSAGES });
  assert.equal(second.transmission, 'unknown', 'an unknown critic call is recorded, never retried');
  assert.deepEqual(second.turn.drafts, []);

  const partial = { ...refused, critic: async () => ({ verdicts: [{ index: 0, verdict: 'keep', reason: '그대로예요.' }] }) };
  const third = await runSupplementPipeline(harness(partial).deps, { facts: FACTS, patterns: PATTERNS, history: [], message: MESSAGES[0].content, userMessages: MESSAGES });
  assert.deepEqual(third.turn.drafts.map(item => item.text), ['정산 화면의 조회 속도를 개선했습니다.']);
  assert.deepEqual(third.turn.pipeline.dropped_drafts.map(item => item.by), ['critic'], 'a draft without a verdict is dropped');
});

test('AI 점검 실패는 숨기지 않는다: 규칙 점검 결과는 보여 주고 단계는 실패로 표시한다. single 모드는 호출 1번', async () => {
  const mock = createMockSupplementProvider();
  const broken = { ...mock, mode: 'live', review: async () => { throw new ChatProviderError('LINER_HTTP_ERROR', '오류', 'completed'); } };
  const failed = await runSupplementPipeline(harness(broken).deps, { facts: FACTS, patterns: PATTERNS, history: [], message: null, userMessages: [] });
  assert.equal(failed.kind, 'ok');
  assert.equal(failed.turn.pipeline.stages.find(stage => stage.key === 'review').state, 'failed');
  assert.match(failed.turn.reply, /AI 점검/);
  assert.equal(failed.turn.findings.length, failed.turn.pipeline.rule_findings);

  const { deps, calls, snapshots } = harness(mock, 'single');
  const single = await runSupplementPipeline(deps, { facts: FACTS, patterns: PATTERNS, history: [], message: MESSAGES[0].content, userMessages: MESSAGES });
  assert.equal(single.kind, 'ok');
  assert.deepEqual(calls, ['respond']);
  assert.deepEqual(snapshots.at(-1).stages.map(stage => [stage.key, stage.state]), [['single', 'done']]);
  assert.equal(single.turn.pipeline.mode, 'single');

  const invalid = await runSupplementPipeline(harness({ ...mock, respond: async () => ({ nope: true }) }).deps, { facts: FACTS, patterns: PATTERNS, history: [], message: MESSAGES[0].content, userMessages: MESSAGES });
  assert.deepEqual([invalid.kind, invalid.code], ['failed', 'SUPPLEMENT_OUTPUT_INVALID']);
  const lost = await runSupplementPipeline({ ...harness(mock).deps, report: () => false }, { facts: FACTS, patterns: PATTERNS, history: [], message: null, userMessages: [] });
  assert.equal(lost.kind, 'lease_lost', 'a progress write that loses the lease stops the pipeline');
});

test('worker + API: 진행 기록이 세션에 저장되어 GET으로 보이고, 끝난 턴에는 단계 요약이 남는다', async () => {
  const { folder, cleanup } = tempFolder('supplement-progress-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'progress'));
    const { revision } = await confirmFixture(api, http, 'frontend');
    const sessionId = (await http.post(`/api/v1/resume-fact-revisions/${revision.id}/supplement-sessions`, { json: {} })).body.resource_id;
    const queued = (await http.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).body;
    assert.equal(queued.progress, null, 'no progress before the worker starts');
    const deps = { db: api.db, owner: `w-${randomUUID()}`, leaseMs: 30_000, now: Date.now, provider: createMockSupplementProvider(), pipeline: 'staged' };
    assert.equal(await runSupplementTask(deps), 'succeeded');
    const done = (await http.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).body;
    assert.equal(done.progress.task_id, done.latest_task.id);
    assert.equal(done.progress.mode, 'staged');
    assert.deepEqual(done.progress.stages.map(stage => [stage.key, stage.state]), [['rules', 'done'], ['review', 'done'], ['draft', 'skipped'], ['critic', 'skipped']]);
    assert.ok(done.progress.stages.every(stage => stage.state === 'skipped' || stage.finished_at), 'finished stages carry timestamps');
    assert.equal(done.messages[0].turn.pipeline.mode, 'staged');

    await http.post(`/api/v1/resume-supplement-sessions/${sessionId}/messages`, { json: { content: '디자인 시스템 문서를 정리했어요.' } });
    assert.equal(await runSupplementTask(deps), 'succeeded');
    const answered = (await http.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).body;
    assert.deepEqual(answered.progress.stages.map(stage => stage.state), ['skipped', 'skipped', 'done', 'done']);
    assert.ok(answered.messages.at(-1).turn.pipeline.drafts_reviewed >= 1);
  } finally { await api.stop(); cleanup(); }
});

test('v0.7.5 migration: 기존 보완 대화 행을 지우지 않고 progress_json 열만 더한다(JSON 검사)', () => {
  const { folder, cleanup } = tempFolder('migrate-075-');
  const path = join(folder, 'app.sqlite');
  const H = 'a'.repeat(64);
  try {
    let db = openDatabase(path, readFileSync(contractSchemaUrl, 'utf8'), defaultMigrations().slice(0, 5));
    const insert = (table, values) => db.prepare(`INSERT INTO ${table} (${Object.keys(values)}) VALUES (${Object.keys(values).map(() => '?')})`).run(...Object.values(values));
    db.exec('BEGIN');
    insert('workspaces', { id: 'w1', session_token_hash: 'b'.repeat(64), csrf_token_hash: H, revision: 0, created_at_ms: 0, expires_at_ms: 9, updated_at_ms: 0 });
    insert('ce7_principals', { id: 'p1', auth_subject: 'test:w1', mode: 'synthetic_local', created_at_ms: 0 });
    insert('ce7_workspace_owners', { workspace_id: 'w1', principal_id: 'p1', created_at_ms: 0 });
    insert('ce7_documents', { id: 'd1', workspace_id: 'w1', input_kind: 'pasted_text', filename: 'a.txt', mime_type: 'text/plain', byte_size: 1, sha256: H, object_key: 'o1', data_origin: 'synthetic', extraction_status: 'extracted', created_at_ms: 0 });
    insert('ce7_fact_revisions', { id: 'f1', workspace_id: 'w1', document_id: 'd1', revision: 1, facts_json: '[]', content_hash: H, confirmed_at_ms: 1, created_at_ms: 1 });
    db.exec("UPDATE ce7_documents SET current_fact_revision_id = 'f1' WHERE id = 'd1'");
    insert('ce8_supplement_sessions', { id: 's1', workspace_id: 'w1', document_id: 'd1', fact_revision_id: 'f1', provider_mode: 'mock', state: 'open', created_at_ms: 0, updated_at_ms: 0 });
    db.exec('COMMIT');
    assert.equal(describeDatabase(db).contract_version, 'v0.7.4');
    db.close();

    // v0.7.5만 적용해 이 migration을 따로 확인한다(v0.7.6은 tests/tailor-pipeline.test.mjs).
    db = openDatabase(path, readFileSync(contractSchemaUrl, 'utf8'), defaultMigrations().slice(0, 6));
    const described = describeDatabase(db);
    assert.equal(described.contract_version, 'v0.7.5');
    assert.equal(described.domain_tables, 55);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare("SELECT progress_json FROM ce8_supplement_sessions WHERE id = 's1'").get().progress_json, null, 'existing rows keep NULL progress');
    assert.throws(() => db.exec("UPDATE ce8_supplement_sessions SET progress_json = 'not json' WHERE id = 's1'"), /CHECK constraint failed/);
    db.exec(`UPDATE ce8_supplement_sessions SET progress_json = '{"stages":[]}' WHERE id = 's1'`);
    assert.throws(() => db.exec("UPDATE ce8_supplement_sessions SET fact_revision_id = 'x' WHERE id = 's1'"), /SUPPLEMENT_SESSION_IDENTITY/, 'identity trigger survives');
    db.close();
  } finally { cleanup(); }
});

test('Liner 단계 요청(전송 없음): AI 점검은 규칙 결과와 기준일을, 근거 검토는 초안 번호와 strict schema를 담고 연락처는 가린다', () => {
  const review = buildReviewStageRequest({ facts: [{ id: 'f1', category: 'other', statement: '연락처 test@example.com' }], patterns: PATTERNS, ruleFindings: [{ fact_ids: ['f1'], title: '결과 문장 없음', detail: 'd', question: null }] }, 'balanced', new Date('2026-11-19T00:00:00Z'));
  const reviewText = JSON.stringify(review);
  assert.ok(reviewText.includes('2026-11-19') && reviewText.includes('결과 문장 없음'));
  assert.ok(!reviewText.includes('test@example.com'));
  assert.equal(review.response_format.json_schema.strict, true);
  const critic = buildCriticRequest({ facts: [{ id: 'f1', category: 'other', statement: '정산 화면을 개발했습니다.' }], userMessages: [{ id: 'm1', content: '010-1234-5678로 연락 주세요. 속도를 개선했어요.' }], drafts: [{ index: 0, text: '속도를 개선했습니다.', fact_ids: ['f1'] }] }, 'balanced', new Date('2026-11-19T00:00:00Z'));
  const criticText = JSON.stringify(critic);
  assert.ok(criticText.includes('속도를 개선했습니다.') && !criticText.includes('010-1234-5678'));
  const verdict = critic.response_format.json_schema.schema.properties.verdicts.items.properties.verdict;
  assert.deepEqual(verdict.enum, ['keep', 'drop']);
});

test('평가 스크립트(mock): 합성 이력서 3개로 single·staged를 같은 결과로 두 번 재현한다', async () => {
  const fixtures = loadEvalFixtures();
  assert.equal(fixtures.length, 3);
  assert.ok(fixtures.every(item => item.answers.some(answer => answer.adversarial)), 'each resume has an answer that tempts inflation');
  const first = await runSupplementEval({ fixtures, provider: createMockSupplementProvider(), modes: ['single', 'staged'] });
  const second = await runSupplementEval({ fixtures, provider: createMockSupplementProvider(), modes: ['single', 'staged'] });
  assert.deepEqual(first, second, 'mock evaluation is deterministic');
  for (const mode of ['single', 'staged']) {
    const summary = first.summary[mode];
    assert.ok(summary.seeded_issues > 0 && summary.found >= 0 && summary.found <= summary.seeded_issues);
    assert.equal(typeof summary.recall, 'number');
    assert.equal(typeof summary.inflated_drafts_shown, 'number');
    assert.ok(summary.calls > 0);
  }
  assert.ok(first.summary.staged.calls > first.summary.single.calls, 'staged spends more calls');
});

test('비슷한 문장은 기존 항목 바꾸기 대상: 어미·공백·문장부호만 다르면 같은 문장으로 본다', () => {
  assert.equal(normalizeStatement('유실을 월 30건에서 0건으로 줄였어요.'), normalizeStatement('유실을 월 30건에서  0건으로 줄였습니다'));
  assert.notEqual(normalizeStatement('유실을 줄였습니다.'), normalizeStatement('유실을 늘렸습니다.'));
  const facts = [{ id: 'a', category: 'achievement', statement: '유실을 월 30건에서 0건으로 줄였어요.', evidence: [] }, { id: 'b', category: 'skill', statement: 'React', evidence: [] }];
  assert.equal(replaceTarget({ statement: '유실을 월 30건에서 0건으로 줄였습니다.', supplements_fact_id: null }, facts)?.id, 'a');
  assert.equal(replaceTarget({ statement: '유실을 월 30건에서 0건으로 줄였어요.', supplements_fact_id: null }, facts), null, 'an identical statement is already added, not a replacement');
  assert.equal(replaceTarget({ statement: '새 문장입니다.', supplements_fact_id: 'b' }, facts)?.id, 'b', 'the agent-named target counts too');
  const next = { id: 'n', category: 'achievement', statement: '유실을 월 30건에서 0건으로 줄였습니다.', evidence: [] };
  const replaced = replaceFact(facts, 'a', next);
  assert.deepEqual(replaced.map(item => item.id), ['n', 'b'], 'the new fact takes the old position');
  assert.deepEqual(facts.map(item => item.id), ['a', 'b'], 'input is not mutated');
});

test('진행 표시 계산: 건너뛴 단계는 세지 않고, 지금 단계·퍼센트·문구를 낸다. 이전 턴 기록은 쓰지 않는다. 화면 이름은 서버와 같다', async () => {
  const { progressView, stageSummary, STAGE_LABELS: webLabels } = await import('../apps/web/src/resume/progress.ts');
  const { STAGE_LABELS } = await import('../packages/tailor/src/supplement-pipeline.ts');
  assert.deepEqual(webLabels, STAGE_LABELS);
  const stage = (key, state, note = null) => ({ key, label: STAGE_LABELS[key], state, note, started_at: null, finished_at: null });
  const progress = { task_id: 't2', mode: 'staged', started_at: '2026-11-19T00:00:00.000Z', stages: [stage('rules', 'skipped'), stage('review', 'skipped'), stage('draft', 'done', '후보 1개'), stage('critic', 'running')] };
  const view = progressView(progress, 't2', 'staged', false);
  assert.deepEqual([view.position, view.total, view.currentKey], [2, 2, 'critic']);
  assert.equal(view.percent, 75);
  assert.match(view.message, /검토/);
  const stale = progressView(progress, 't3', 'staged', true);
  assert.deepEqual(stale.stages.map(item => item.state), ['pending', 'pending', 'skipped', 'skipped'], 'another task\'s record is ignored');
  assert.equal(stale.percent, 0);
  assert.equal(progressView(null, null, 'single', false).total, 1);
  assert.equal(stageSummary([stage('rules', 'done', '3개'), stage('review', 'failed', '실패(X)'), stage('draft', 'skipped')]), '규칙 점검 ✓ 3개 · AI 점검 ✕ 실패(X)');
  for (const file of ['progress.ts', 'similar.ts', 'AgentProgress.tsx', 'SupplementSection.tsx', 'SupplementTurnView.tsx']) {
    const code = readFileSync(new URL(`../apps/web/src/resume/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(code, /from 'node:|packages\/tailor\/src\/supplement-pipeline\.ts'/, `${file} stays browser-safe`);
  }
});
