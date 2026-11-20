import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runSupplementTask } from '../apps/worker/src/supplement-task.ts';
import { createMockSupplementProvider } from '../packages/tailor/src/supplement.ts';
import { runSuggestPipeline, screenSuggestions, mockSuggestions } from '../packages/tailor/src/suggest.ts';
import { buildSuggestRequest, buildCriticRequest } from '../packages/liner/src/supplement.ts';
import { HR_PERSONA } from '../packages/liner/src/persona.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { confirmFixture } from './helpers/s02-harness.mjs';

// 사용자 요청(2026-11-20): 점검 항목마다 완성 문장을 골라 쓰고, 없으면 직접 쓰게(DECISIONS S1-24).
// '문장 추천받기'를 누를 때 ① 추천 문장 작성 → ② 근거 검토. 고른 문장은 모델 없이 내 진술로 기록하고 기존 확정 API로 반영한다.
// 네트워크 없이 mock·가짜 provider만 쓴다. 합성 이력서만 쓴다.

const FACTS = [
  { id: 'f1', category: 'responsibility', statement: '정산 화면을 React로 개발했습니다.' },
  { id: 'f2', category: 'achievement', statement: '조회 시간을 2초에서 0.5초로 줄였습니다.' },
];
const FINDING = { fact_ids: ['f1'], title: '맡은 범위가 드러나지 않아요', detail: 'd', question: '몇 명 팀이었나요?', example: null };

test('추천 문장 거르기: 근거 안 완성 문장·빈칸 문장은 남기고, 지어낸 수치·빈칸 안 숫자·없는 기술·중복·잘못된 style은 뺀다(최대 3개)', () => {
  const raw = { options: [
    { style: 'concise', text: '정산 화면을 React로 개발했습니다.', fact_ids: ['f1', 'zz'] },
    { style: 'scope', text: '[팀 인원]명 팀에서 정산 화면을 React로 개발했습니다.', fact_ids: ['f1'] },
    { style: 'result', text: '정산 화면 조회 시간을 70% 줄였습니다.', fact_ids: ['f1'] },
    { style: 'result', text: '[예: 5]명 팀에서 개발했습니다.', fact_ids: [] },
    { style: 'result', text: 'Vue로 정산 화면을 개발했습니다.', fact_ids: [] },
    { style: 'concise', text: '정산 화면을  React로 개발했습니다.', fact_ids: [] },
    { style: 'bold', text: '정산 화면을 개발했습니다.', fact_ids: [] },
    { style: 'result', text: '조회 시간을 2초에서 0.5초로 줄였습니다.', fact_ids: ['f2'] },
  ] };
  const kept = screenSuggestions(raw, FACTS);
  assert.deepEqual(kept.map(item => item.style), ['concise', 'scope', 'result']);
  assert.deepEqual(kept[0].fact_ids, ['f1'], 'unknown fact ids are dropped');
  assert.equal(kept[2].text, '조회 시간을 2초에서 0.5초로 줄였습니다.', 'numbers already in the facts are allowed');
  assert.equal(screenSuggestions({ nope: [] }, FACTS), null);
});

const pipelineDeps = (provider, calls = []) => ({
  provider: { mode: provider.mode, suggest: input => { calls.push('suggest'); return provider.suggest(input); }, critic: input => { calls.push('critic'); return provider.critic(input); } },
  taskId: 'task_1', now: () => 1_800_000_000_000, report: () => true, invoke: work => work(new AbortController().signal),
});
const pipelineInput = { facts: FACTS, finding: FINDING, patterns: { family: 'general', label: '공통', principles: [], examples: [] }, userMessages: [], sourceMessageId: 'smsg_1', findingIndex: 2 };

test('추천 파이프라인: 작성 → 근거 검토. 검토가 drop한 문장은 빠지고, 검토가 실패하면 하나도 보여 주지 않는다(닫힌 쪽)', async () => {
  const mock = createMockSupplementProvider();
  const calls = [];
  const ok = await runSuggestPipeline(pipelineDeps(mock, calls), pipelineInput);
  assert.equal(ok.kind, 'ok');
  assert.deepEqual(calls, ['suggest', 'critic']);
  assert.ok(ok.set.options.length >= 2);
  assert.deepEqual([ok.set.source_message_id, ok.set.finding_index, ok.set.target_fact_ids], ['smsg_1', 2, ['f1']]);
  assert.deepEqual(ok.pipeline.stages.map(stage => [stage.key, stage.state]), [['draft', 'done'], ['critic', 'done']]);

  const strict = { ...mock, critic: async input => ({ verdicts: input.drafts.map(draft => ({ index: draft.index, verdict: draft.index === 0 ? 'drop' : 'keep', reason: '범위를 키웠어요' })) }) };
  const partial = await runSuggestPipeline(pipelineDeps(strict), pipelineInput);
  assert.equal(partial.set.options.length, ok.set.options.length - 1);
  assert.equal(partial.pipeline.dropped_drafts[0].reason, '범위를 키웠어요');

  const broken = { ...mock, critic: async () => ({ nope: true }) };
  const withheld = await runSuggestPipeline(pipelineDeps(broken), pipelineInput);
  assert.equal(withheld.kind, 'ok');
  assert.deepEqual(withheld.set.options, []);
  assert.equal(withheld.pipeline.drafts_withheld, true);
  assert.match(withheld.reply, /직접 쓰기/);

  const invalid = await runSuggestPipeline(pipelineDeps({ ...mock, suggest: async () => ({ options: 'x' }) }), pipelineInput);
  assert.deepEqual([invalid.kind, invalid.code], ['failed', 'SUPPLEMENT_OUTPUT_INVALID']);
});

test('근거 범위: 대상 문장이 속한 회사 구간만 쓴다(다른 회사의 수치를 붙이지 않게)', async () => {
  const { employerScope } = await import('../packages/tailor/src/suggest.ts');
  const facts = [
    { id: 's0', category: 'other', statement: '소개 문장입니다.' },
    { id: 'e1', category: 'employer', statement: '예시회사A' }, { id: 'a1', category: 'responsibility', statement: 'A에서 리드를 맡았습니다.' },
    { id: 'e2', category: 'employer', statement: '예시회사B' }, { id: 'b1', category: 'responsibility', statement: 'B에서 5명과 협업했습니다.' },
  ];
  assert.deepEqual(employerScope(facts, 'a1').map(fact => fact.id), ['e1', 'a1']);
  assert.deepEqual(employerScope(facts, 'b1').map(fact => fact.id), ['e2', 'b1']);
  assert.deepEqual(employerScope(facts, 's0').map(fact => fact.id), ['s0'], 'before any company: only the lines before the first company');
  assert.equal(employerScope(facts, undefined).length, facts.length);
  // A 문장 추천에 B의 '5명'을 붙이면 결정적 검사에서 빠진다.
  const raw = { options: [{ style: 'scope', text: 'A에서 5명 팀의 리드를 맡았습니다.', fact_ids: ['a1'] }, { style: 'concise', text: 'A에서 리드를 맡았습니다.', fact_ids: ['a1'] }] };
  assert.deepEqual(screenSuggestions(raw, employerScope(facts, 'a1')).map(item => item.style), ['concise']);
});

test('mock 추천: 대상 문장 그대로(간결형) + 범위·결과 빈칸', () => {
  const { options } = mockSuggestions({ facts: FACTS, finding: FINDING });
  assert.equal(options[0].text, '정산 화면을 React로 개발했습니다.');
  assert.match(options[1].text, /\[팀 인원\]/);
});

test('Liner 추천 요청: 페르소나로 시작, 세 가지 style·빈칸·완성 문장 규칙, strict schema. 근거 검토는 빈칸을 위반으로 보지 않는다', () => {
  const request = buildSuggestRequest({ facts: FACTS, finding: FINDING, patterns: { family: 'general', label: '공통', principles: [], examples: [] } }, 'quality');
  const system = request.messages[0].content;
  assert.ok(system.startsWith(HR_PERSONA));
  for (const rule of [/concise/, /scope/, /result/, /대괄호 빈칸/, /숫자를 넣지 않는다/, /빈칸 없는 문장을 적어도 하나/, /다른 회사·다른 경력/, /60자/, /주어/, /맥락 → 행동 → 결과/, /설명 문장을 덧붙이지 않는다/]) assert.match(system, rule);
  assert.equal(request.response_format.json_schema.strict, true);
  assert.match(request.messages[1].content, /정산 화면을 React로 개발했습니다/);
  const critic = buildCriticRequest({ facts: FACTS, userMessages: [], drafts: [] }, 'quality');
  assert.match(critic.messages[0].content, /빈칸은 사용자가 나중에 채울 자리/);
});

const workerDeps = api => ({ db: api.db, owner: `supp-${randomUUID()}`, leaseMs: 30_000, now: Date.now, provider: createMockSupplementProvider() });

test('API: 문장 추천받기 → 작업 → 추천 문장 / 고른 문장 기록(모델 없음, 빈칸 거절) → 기존 확정 API로 기존 항목 바꾸기 / 검증·소유권', async () => {
  const { folder, cleanup } = tempFolder('suggest-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'suggester'));
    const { revision, documentId, draft } = await confirmFixture(api, http, 'frontend');
    const sessionId = (await http.post(`/api/v1/resume-fact-revisions/${revision.id}/supplement-sessions`, { json: {} })).body.resource_id;
    assert.equal(await runSupplementTask(workerDeps(api)), 'succeeded');
    const opening = (await http.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).body.messages[0];
    // 합성 fixture의 점검 항목은 대상 문장이 없는 것(결과 문장 없음 등)일 수 있다. 추천은 어느 항목이든 받을 수 있다.
    const index = Math.max(0, opening.turn.findings.findIndex(item => item.fact_ids.length > 0));
    const target = opening.turn.findings[index].fact_ids[0] ?? revision.facts.find(fact => fact.category === 'responsibility').id;

    const path = `/api/v1/resume-supplement-sessions/${sessionId}/suggestions`;
    assert.equal((await http.post(path, { json: { message_id: opening.id } })).status, 400);
    assert.equal((await http.post(path, { json: { message_id: opening.id, finding_index: 99 } })).status, 404);
    const accepted = await http.post(path, { json: { message_id: opening.id, finding_index: index } });
    assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
    assert.deepEqual([(await http.post(path, { json: { message_id: opening.id, finding_index: index } })).body.code], ['RESPONSE_PENDING']);
    assert.equal(await runSupplementTask(workerDeps(api)), 'succeeded');
    const last = (await http.get(`/api/v1/resume-supplement-sessions/${sessionId}`)).body.messages.at(-1);
    assert.equal(last.role, 'assistant');
    assert.deepEqual([last.turn.suggestion.source_message_id, last.turn.suggestion.finding_index], [opening.id, index]);
    assert.ok(last.turn.suggestion.options.length > 0);
    // 실호출 관찰(2026-11-20): 대상이 여러 회사 문장이면 후보가 서로 다른 경력을 섞었다 → 대상 문장 하나만 고쳐 쓴다.
    assert.ok(last.turn.suggestion.target_fact_ids.length <= 1);

    const statements = `/api/v1/resume-supplement-sessions/${sessionId}/statements`;
    const blank = await http.post(statements, { json: { content: '[팀 인원]명 팀에서 개발했습니다.' } });
    assert.deepEqual([blank.status, blank.body.code], [400, 'STATEMENT_HAS_BLANK']);
    const chosen = '4명 팀에서 결제 화면 개발을 맡았습니다.';
    const recorded = await http.post(statements, { json: { content: chosen } });
    assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
    assert.equal(recorded.body.role, 'user');

    const replaced = revision.facts.map(fact => fact.id === target ? { id: 'fact_pick1', category: fact.category, statement: chosen, evidence: [{ kind: 'user_statement', message_id: recorded.body.id, confirmed_at: new Date().toISOString(), quote: chosen }] } : fact);
    const saved = await http.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: revision.id, facts: replaced } });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.ok(saved.body.facts.some(fact => fact.id === 'fact_pick1' && fact.statement === chosen));
    assert.ok(!saved.body.facts.some(fact => fact.id === target), 'the old sentence was replaced in place');

    const intruder = client(api, await login(api, 'intruder2'));
    assert.equal((await intruder.post(path, { json: { message_id: opening.id, finding_index: index } })).status, 404);
    assert.equal((await intruder.post(statements, { json: { content: chosen } })).status, 404);
  } finally { await api.stop(); cleanup(); }
});
