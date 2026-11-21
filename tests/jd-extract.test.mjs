import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockTailorStageProvider, screenExtractedRequirements, JD_LIMITS } from '../packages/tailor/src/jd-check.ts';
import { runTailorPipeline } from '../packages/tailor/src/tailor-pipeline.ts';
import { buildJdExtractRequest } from '../packages/liner/src/tailor-stages.ts';
import { HR_PERSONA } from '../packages/liner/src/persona.ts';
import { baseBlocks } from '../packages/tailor/src/blocks.ts';

// 품질 검증(2026-11-20): 실시간 검색 공고는 요약만 있어 requirements=[] → JD 점검표가 비었다.
// JD 점검 ① 단계에서 공고 글의 요구를 추출하되, 서버가 원문 인용(source_quote)이 공고 글에 그대로 있는지 확인한다.
// 합성 공고·합성 경력만 쓴다(전송 없음).

const SUMMARY = '[합성랩] 프론트엔드 개발자 채용 ✓ TypeScript 실무 경험 필수 ✓ 요건정의부터 구현까지 개발 경험 필수 ✓ Next.js·React 개발 경험 우대 #합성 마감 D-7';
const JOB = { company_name: '합성랩', title: '프론트엔드 개발자', content_text: SUMMARY, requirements: [] };
const FACTS = [
  { id: 'f1', category: 'skill', statement: 'TypeScript' },
  { id: 'f2', category: 'responsibility', statement: 'TypeScript로 정산 화면을 개발했습니다.' },
  { id: 'f3', category: 'skill', statement: 'React' },
];

test('추출 응답 거르기: 공고 글에 그대로 있는 인용만 남기고, 지어낸 인용·인용에 없는 기술·숫자는 뺀다', () => {
  const raw = { requirements: [
    { text: 'TypeScript 실무 경험', importance: 'required', source_quote: 'TypeScript 실무 경험 필수' },
    { text: 'Next.js·React 개발 경험', importance: 'unknown', source_quote: 'Next.js·React  개발 경험 우대' }, // 띄어쓰기 차이는 허용, 우대 → preferred
    { text: 'Kubernetes 운영 경험', importance: 'required', source_quote: 'Kubernetes 운영 경험 필수' }, // 공고 글에 없음
    { text: 'TypeScript 5년 이상', importance: 'required', source_quote: 'TypeScript 실무 경험 필수' }, // 인용에 없는 숫자
    { text: 'TypeScript 실무 경험', importance: 'required', source_quote: 'TypeScript 실무 경험 필수' }, // 중복
    { text: '', importance: 'required', source_quote: '요건정의부터 구현까지' },
  ] };
  const kept = screenExtractedRequirements(raw, SUMMARY);
  assert.deepEqual(kept.map(item => [item.text, item.importance]), [['TypeScript 실무 경험', 'required'], ['Next.js·React 개발 경험', 'preferred']]);
  assert.ok(kept.every(item => item.id.startsWith('req_x')), 'server-assigned ids');
  assert.equal(screenExtractedRequirements({ nope: true }, SUMMARY), null, 'malformed output fails closed');
  assert.deepEqual(screenExtractedRequirements({ requirements: [] }, SUMMARY), []);
});

test('추출 개수는 상한까지만', () => {
  const text = Array.from({ length: 20 }, (_, i) => `기술${i} 경험`).join(' / ');
  const raw = { requirements: Array.from({ length: 20 }, (_, i) => ({ text: `기술${i} 경험`, importance: 'unknown', source_quote: `기술${i} 경험` })) };
  assert.equal(screenExtractedRequirements(raw, text).length, JD_LIMITS.requirements);
});

function deps(stages, calls = []) {
  const wrap = (name, fn) => input => { calls.push(name); return fn(input); };
  return {
    chat: { mode: 'mock', respond: async () => { throw new Error('not used'); } },
    stages: { mode: stages.mode, review: wrap('review', stages.review), critic: wrap('critic', stages.critic), ...(stages.extract ? { extract: wrap('extract', stages.extract) } : {}) },
    taskId: 'task_1', now: () => 1_800_000_000_000, report: () => true, invoke: work => work(new AbortController().signal),
  };
}
const input = job => ({ job, facts: FACTS, blocks: baseBlocks(FACTS), history: [], message: null, userMessages: [] });

test('요구사항이 없는 공고: ① 단계에서 공고 글로 요구를 뽑아 대조하고, 점검표·질문이 채워진다', async () => {
  const calls = [];
  const result = await runTailorPipeline(deps(createMockTailorStageProvider(), calls), input(JOB));
  assert.equal(result.kind, 'ok');
  assert.deepEqual(calls, ['extract', 'review']);
  assert.ok(result.turn.requirements.length >= 2, 'requirements extracted from the summary');
  assert.ok(result.turn.requirements.some(check => check.status === 'met'), 'TypeScript requirement is backed by a work sentence');
  assert.ok(!result.turn.requirements.some(check => /D-7|#합성/.test(check.requirement)), 'deadline/hashtag text is not a requirement');
  // 계약(TailoringPipeline)은 그대로 두고, 추출 사실은 ① 단계 기록과 답에 남긴다.
  const note = result.turn.pipeline.stages.find(stage => stage.key === 'match').note;
  assert.equal(Number(note.match(/공고 글에서 요구사항 (\d+)개 추출/)?.[1]), result.turn.requirements.length);
  assert.ok(!('requirements_extracted' in result.turn.pipeline), 'no new contract field');
  assert.match(result.reply, /원문/, 'tells the user the list came from the posting summary');
});

test('요구사항이 이미 있는 공고는 추출하지 않는다(호출 없음)', async () => {
  const calls = [];
  const job = { ...JOB, requirements: [{ id: 'r1', text: 'TypeScript 실무 경험', importance: 'required', source_quote: 'TypeScript 실무 경험 필수' }] };
  const result = await runTailorPipeline(deps(createMockTailorStageProvider(), calls), input(job));
  assert.deepEqual(calls, ['review']);
  assert.doesNotMatch(result.turn.pipeline.stages.find(stage => stage.key === 'match').note, /추출/);
});

test('뽑을 요구가 없으면 HR 전문가 점검 호출을 하지 않고, 원문 확인을 안내한다', async () => {
  const calls = [];
  const stages = { ...createMockTailorStageProvider(), extract: async () => ({ requirements: [] }) };
  const result = await runTailorPipeline(deps(stages, calls), input({ ...JOB, content_text: '합성랩 채용 홈페이지' }));
  assert.deepEqual(calls, ['extract'], 'no paid review call for an empty table');
  assert.equal(result.turn.requirements.length, 0);
  assert.equal(result.turn.pipeline.stages.find(stage => stage.key === 'review').state, 'skipped');
  assert.match(result.reply, /공고 원문/);
});

test('추출 형식이 틀리면 ① 단계 실패로 남기고 점검 호출을 하지 않는다(닫힌 쪽)', async () => {
  const calls = [];
  const stages = { ...createMockTailorStageProvider(), extract: async () => ({ nope: true }) };
  const result = await runTailorPipeline(deps(stages, calls), input(JOB));
  assert.deepEqual(calls, ['extract']);
  const match = result.turn.pipeline.stages.find(stage => stage.key === 'match');
  assert.equal(match.state, 'failed');
  assert.match(match.note, /CHAT_OUTPUT_INVALID/);
  assert.match(result.reply, /읽지 못했어요/);
});

test('Liner 추출 요청: 페르소나로 시작하고, 원문 그대로 인용·다른 공고 문구 제외·지어내기 금지를 요구한다', () => {
  const request = buildJdExtractRequest({ job: JOB }, 'quality');
  const system = request.messages[0].content;
  assert.ok(system.startsWith(HR_PERSONA));
  for (const rule of [/그대로 복사/, /다른 공고/, /짐작/, /source_quote/]) assert.match(system, rule);
  assert.equal(request.response_format.json_schema.strict, true);
  assert.match(request.messages[1].content, /TypeScript 실무 경험 필수/);
});
