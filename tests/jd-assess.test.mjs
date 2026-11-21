import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { checkRequirements, createMockTailorStageProvider, screenAssessments } from '../packages/tailor/src/jd-check.ts';
import { runTailorPipeline } from '../packages/tailor/src/tailor-pipeline.ts';
import { buildJdAssessRequest } from '../packages/liner/src/tailor-stages.ts';
import { buildChatRequest } from '../packages/liner/src/chat.ts';
import { baseBlocks } from '../packages/tailor/src/blocks.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { startTailoring, current, runTailor } from './helpers/s04-harness.mjs';

// 실제 이력서 테스트(2026-11-21, DECISIONS S1-28): 실시간 검색 공고는 요약만 있어 요구가 2개만 잡혔고,
// 규칙 대조는 단어가 같을 때만 연결해 기간으로 알 수 있는 '7년 이상'도 미기재로 냈다.
// ① 사용자가 공고 본문을 붙여넣는다 ② 요구마다 HR 근거 판정을 받되 인용·근거 id는 서버가 대조한다. 합성 자료만 쓴다.

const FACTS = [
  { id: 'f1', category: 'employer', statement: '합성페이' },
  { id: 'f2', category: 'period', statement: '2015.03 ~ 재직 중' },
  { id: 'f3', category: 'responsibility', statement: 'TypeScript로 정산 화면을 개발했습니다.' },
  { id: 'f4', category: 'skill', statement: 'React' },
];
const JOB = { company_name: '합성랩', title: '프로덕트 엔지니어', content_text: '합성 공고', requirements: [
  { id: 'r1', text: '소프트웨어 엔지니어링 실무 경험 7년 이상', importance: 'required', source_quote: '7년 이상' },
  { id: 'r2', text: 'TypeScript 개발 경험', importance: 'required', source_quote: 'TypeScript' },
  { id: 'r3', text: '대규모 트래픽 운영 경험', importance: 'preferred', source_quote: '대규모 트래픽' },
] };
const BLOCKS = baseBlocks(FACTS);

test('근거 판정 거르기: 인용이 이력서에 그대로 있고 근거 id가 확정 경력에 있을 때만 판정을 받아들인다', () => {
  const rule = checkRequirements(FACTS, JOB);
  assert.equal(rule[0].status, 'missing', 'rule matching cannot see years of experience');
  const judged = screenAssessments({ assessments: [
    { requirement_id: 'r1', status: 'met', fact_ids: ['f2', 'nope'], evidence_quote: '2015.03 ~  재직 중', note: '2015년부터 근무 기간이 이어져 7년 이상으로 읽혀요.' },
    { requirement_id: 'r2', status: 'weak', fact_ids: ['f3'], evidence_quote: 'TypeScript로 결제 서버를 개발했습니다.', note: '지어낸 인용' },
    { requirement_id: 'r3', status: 'missing', fact_ids: ['f3'], evidence_quote: null, note: 'fact_003에 없어요.' },
    { requirement_id: 'r1', status: 'missing', fact_ids: [], evidence_quote: null, note: '중복 판정' },
  ] }, rule, FACTS, BLOCKS);
  assert.deepEqual(judged.map(item => [item.requirement_id, item.status, item.judged_by]), [['r1', 'met', 'ai'], ['r2', rule[1].status, 'rule'], ['r3', 'missing', 'ai']]);
  assert.deepEqual(judged[0].fact_ids, ['f2'], 'unknown fact ids are dropped');
  assert.equal(judged[0].evidence, '2015.03 ~ 재직 중');
  assert.equal(judged[1].note, rule[1].note, 'an invented quote keeps the rule result');
  assert.doesNotMatch(judged[2].note, /fact_/, 'internal ids never reach the note');
  assert.deepEqual(judged[2].fact_ids, []);
  assert.equal(screenAssessments({ nope: 1 }, rule, FACTS, BLOCKS), null, 'malformed output fails closed');
  assert.ok(screenAssessments({ assessments: [] }, rule, FACTS, BLOCKS).every(item => item.judged_by === 'rule'));
});

function deps(stages, calls) {
  const wrap = (name, fn) => input => { calls.push(name); return fn(input); };
  return {
    chat: { mode: 'mock', respond: async input => { calls.push(['respond', input.checks?.length ?? 0]); return { reply: 'x', changes: [], questions: [] }; } },
    stages: Object.fromEntries([['mode', stages.mode], ...['extract', 'assess', 'review', 'critic'].filter(key => stages[key]).map(key => [key, wrap(key, stages[key])])]),
    taskId: 'task_1', now: () => 1_800_000_000_000, report: () => true, invoke: work => work(new AbortController().signal),
  };
}

test('JD 점검: 규칙 대조 뒤 근거 판정을 거쳐 점검표가 바뀌고, 판정 실패는 규칙 대조로 돌아가며 단계 기록에 남는다', async () => {
  const mock = createMockTailorStageProvider();
  const calls = [];
  const assess = async () => ({ assessments: [{ requirement_id: 'r1', status: 'met', fact_ids: ['f2'], evidence_quote: '2015.03 ~ 재직 중', note: '근무 기간으로 7년 이상이 확인돼요.' }] });
  const ok = await runTailorPipeline(deps({ ...mock, assess }, calls), { job: JOB, facts: FACTS, blocks: BLOCKS, history: [], message: null, userMessages: [] });
  assert.deepEqual(calls, ['assess', 'review']);
  assert.equal(ok.turn.requirements[0].status, 'met');
  assert.match(ok.turn.pipeline.stages[0].note, /HR 근거 판정 1개/);
  assert.ok(!ok.turn.findings.some(item => item.requirement_id === 'r1'), 'no question for a requirement judged met');

  const failed = await runTailorPipeline(deps({ ...mock, assess: async () => ({ wrong: true }) }, []), { job: JOB, facts: FACTS, blocks: BLOCKS, history: [], message: null, userMessages: [] });
  assert.equal(failed.kind, 'ok');
  assert.equal(failed.turn.requirements[0].status, 'missing');
  assert.match(failed.turn.pipeline.stages[0].note, /HR 근거 판정 실패\(CHAT_OUTPUT_INVALID\), 규칙 대조만/);
});

test('붙여넣은 본문은 답에 출처로 밝히고, 답변 턴의 수정안 작성에는 직전 판정이 자료로 간다', async () => {
  const mock = createMockTailorStageProvider();
  const pasted = { company_name: '합성랩', title: '프로덕트 엔지니어', requirements: [], content_source: 'pasted', content_text: '자격 요건\n- TypeScript 개발 경험 필수\n우대 사항\n- 대규모 트래픽 운영 경험 우대' };
  const first = await runTailorPipeline(deps(mock, []), { job: pasted, facts: FACTS, blocks: BLOCKS, history: [], message: null, userMessages: [] });
  assert.match(first.turn.pipeline.stages[0].note, /붙여넣은 공고 본문에서 요구사항 2개 추출/);
  assert.match(first.reply, /붙여넣은 공고 본문/);
  assert.doesNotMatch(first.reply, /검색 요약/);
  const calls = [];
  const checks = first.turn.requirements.map(item => ({ requirement: item.requirement, importance: item.importance, status: item.status, note: item.note }));
  await runTailorPipeline(deps(mock, calls), { job: pasted, facts: FACTS, blocks: BLOCKS, history: [], message: '이 공고에 맞춰 수정해줘', userMessages: [], checks });
  assert.deepEqual(calls[0], ['respond', 2]);
});

test('Liner 요청: 근거 판정은 기준일·지금 이력서·확정 경력·요구를 보내고, 수정안 작성은 판정과 전체 맞춤 규칙을 받는다', () => {
  const rule = checkRequirements(FACTS, JOB);
  const assess = buildJdAssessRequest({ job: JOB, facts: FACTS, blocks: BLOCKS, checks: rule }, 'quality', new Date('2026-11-21T00:00:00Z'));
  assert.equal(assess.response_format.json_schema.name, 'jd_requirement_assessment');
  assert.match(assess.messages[0].content, /글자 그대로 복사한 연속 구절/);
  assert.match(assess.messages[0].content, /경험 없음으로 단정하지 않는다/);
  assert.match(assess.messages[1].content, /기준일\): 2026-11-21/);
  assert.match(assess.messages[1].content, /"rule_status":"missing"/);
  const draft = buildChatRequest({ job: JOB, facts: FACTS, blocks: BLOCKS, history: [], message: '이 공고에 맞춰 수정해줘', checks: [{ requirement: 'TypeScript 개발 경험', importance: 'required', status: 'met', note: 'n' }] }, 'quality');
  assert.match(draft.messages[0].content, /공고 전체 맞춤/);
  assert.match(draft.messages[0].content, /checks는 근거가 아니다/);
  assert.match(draft.messages[1].content, /"checks":\[\{"requirement":"TypeScript 개발 경험"/);
  assert.doesNotMatch(buildChatRequest({ job: JOB, facts: FACTS, blocks: BLOCKS, history: [], message: 'x' }, 'quality').messages[1].content, /"checks"/);
});

test('API: 공고 본문 붙여넣기는 세션에만 저장하고(스냅샷 그대로), 길이·응답 대기 중·소유권을 검사한다. 다음 JD 점검이 그 본문을 쓴다', async () => {
  const { folder, cleanup } = tempFolder('job-text-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, `jt-${randomUUID().slice(0, 8)}`));
    const { session } = await startTailoring(api, http);
    const path = `/api/v1/tailoring-sessions/${session.id}/job-text`;
    assert.equal((await http.get(`/api/v1/tailoring-sessions/${session.id}`)).body.job_text, null);
    assert.equal((await http.post(path, { json: { content_text: '짧음' } })).body.code, 'JOB_TEXT_LENGTH');
    assert.equal((await http.post(path, { json: { content_text: 'x'.repeat(20001) } })).status, 400);
    assert.equal((await http.post(path, { json: { content_text: 1 } })).status, 400);
    const text = `자격 요건\r\n- 합성 결제 도메인에서 Rust 개발 경험 필수   \r\n\r\n\r\n\r\n우대 사항\n- 합성 물류 시스템 운영 경험 우대\n${'회사 소개 문장입니다. '.repeat(5)}`;
    const snapshotBefore = api.db.prepare('SELECT content_text, content_hash FROM ce7_job_snapshots WHERE id = ?').get(session.job_snapshot_id);
    const saved = await http.post(path, { json: { content_text: text } });
    assert.equal(saved.status, 200);
    assert.match(saved.body.job_text, /^자격 요건\n- 합성 결제 도메인에서 Rust 개발 경험 필수\n\n우대 사항/, 'line breaks kept, trailing spaces and blank runs trimmed');
    assert.deepEqual({ ...api.db.prepare('SELECT content_text, content_hash FROM ce7_job_snapshots WHERE id = ?').get(session.job_snapshot_id) }, { ...snapshotBefore }, 'the observed job snapshot is not rewritten');
    const other = client(api, await login(api, `jt-other-${randomUUID().slice(0, 8)}`));
    assert.equal((await other.post(path, { json: { content_text: text } })).status, 404);

    const { revision } = await current(http, session.id);
    await http.post(`/api/v1/tailoring-sessions/${session.id}/jd-checks`, { json: { expected_resume_revision_id: revision.id } });
    assert.equal((await http.post(path, { json: { content_text: text } })).body.code, 'RESPONSE_PENDING');
    assert.equal(await runTailor(api, { stages: createMockTailorStageProvider() }), 'succeeded');
    const last = (await http.get(`/api/v1/tailoring-sessions/${session.id}/messages`)).body.items.at(-1);
    assert.ok(last.turn.requirements.some(item => /Rust/.test(item.requirement)), 'requirements come from the pasted text');
    assert.match(last.turn.pipeline.stages[0].note, /붙여넣은 공고 본문/);
    // 답변 턴: 직전 JD 점검이 본문에서 읽은 요구가 수정안 작성(대화 provider)에 전달된다.
    const seen = [];
    const provider = { mode: 'mock', respond: async input => { seen.push(input.job.requirements.map(item => item.text), input.checks.length); return { reply: '확인했어요.', changes: [], questions: [] }; } };
    await http.post(`/api/v1/tailoring-sessions/${session.id}/messages`, { json: { expected_resume_revision_id: revision.id, content: '이 공고에 맞춰 수정해줘' } });
    assert.equal(await runTailor(api, { provider, stages: createMockTailorStageProvider() }), 'succeeded');
    assert.ok(seen[0].some(text => /Rust/.test(text)), 'carried requirements');
    assert.equal(seen[1], last.turn.requirements.length);
  } finally { await api.stop(); cleanup(); }
});

test('맞춤 요약 중복 방지: 이미 이력서에 있는 문장과 같은 insert는 넣지 않고 이유를 알린다', async () => {
  const { screenChanges, guardReason } = await import('../packages/tailor/src/screen-changes.ts');
  const copy = { operation: 'insert', block_id: 'blk_new_1', before: null, after: 'TypeScript로  정산 화면을 개발했습니다.', fact_ids: ['f3'], reason: 'x', needs_fact_confirmation: false };
  const fresh = { ...copy, block_id: 'blk_new_2', after: '합성페이에서 TypeScript로 정산 화면을 개발했습니다.', fact_ids: ['f1', 'f3'] };
  const screened = screenChanges({ reply: 'x', questions: [], changes: [copy, fresh] }, { blocks: BLOCKS, facts: FACTS, userMessage: '' });
  assert.deepEqual(screened.changes.map(item => item.block_id), ['blk_new_2']);
  assert.ok(screened.questions.some(text => /이미 이력서에 있는 문장/.test(text)));
  assert.match(guardReason(copy, FACTS), /이미 이력서에 있는 문장/);
  assert.equal(guardReason(fresh, FACTS), null);
});
