import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyChanges, baseBlocks, blocksCanonical } from '../packages/tailor/src/blocks.ts';
import { checkBlocks, checkChange, checkSupported, factDrift } from '../packages/tailor/src/guard.ts';
import { createMockChatProvider, isChatOutput } from '../packages/tailor/src/provider.ts';
import { screenChanges } from '../apps/worker/src/tailor-task.ts';
import { artifactFilename } from '../apps/worker/src/render-task.ts';
import { missingGlyphs, renderResumePdf, renderableText } from '../packages/render/src/resume-pdf.ts';
import { extractPdfTextIsolated } from '../packages/resume/src/pdf.ts';
import { MOCK_JOBS } from '../packages/search/src/mock-catalog.ts';
import { glyphReport } from './helpers/pdf-glyphs.mjs';

const fact = (id, category, statement) => ({ id, category, statement });
const FACTS = [
  fact('f1', 'role', '프론트엔드 개발자'), fact('f2', 'other', 'React와 TypeScript를 사용하는 프론트엔드 개발자입니다.'),
  fact('f3', 'employer', '예시 프로덕트 A (가상 회사)'), fact('f4', 'period', '2021.03 - 2026.10'),
  fact('f5', 'responsibility', '운영 대시보드의 화면 구조와 상태 관리를 담당했습니다.'),
  fact('f6', 'responsibility', '공통 컴포넌트 구조와 코드 리뷰 기준을 정리했습니다.'),
  fact('f7', 'skill', 'React'), fact('f8', 'skill', 'TypeScript'), fact('f9', 'skill', 'Next.js'), fact('f10', 'skill', 'Storybook'),
];
const change = (operation, block_id, before, after, fact_ids = [], extra = {}) => ({ operation, block_id, before, after, fact_ids, reason: '테스트', needs_fact_confirmation: false, ...extra });

test('base resume keeps fact statements verbatim, groups skills and employer+period, orders sections', () => {
  const blocks = baseBlocks(FACTS);
  assert.deepEqual(blocks.map(block => block.section), ['요약', '직무', '기술', '경력', '경력 내용', '경력 내용']);
  assert.equal(blocks.find(block => block.id === 'blk_skills').text, 'React · TypeScript · Next.js · Storybook');
  assert.deepEqual(blocks.find(block => block.section === '경력').fact_ids, ['f3', 'f4']);
  assert.ok(blocks.every(block => block.fact_ids.length > 0));
  assert.deepEqual(checkBlocks(blocks, FACTS), [], 'base blocks are fully supported by facts');
});

test('applyChanges enforces operation shapes, block ids and never mutates its input', () => {
  const blocks = baseBlocks(FACTS);
  const before = blocksCanonical(blocks);
  const skills = blocks.find(block => block.id === 'blk_skills');
  const ok = applyChanges(blocks, [
    change('replace', 'blk_skills', skills.text, 'Storybook · React · TypeScript · Next.js', ['f10', 'f7', 'f8', 'f9']),
    change('insert', 'blk_new', null, '프론트엔드 개발자 · React', ['f1', 'f7']),
    change('reorder', 'blk_f6', null, null, ['f6']),
    change('remove', 'blk_f2', 'React와 TypeScript를 사용하는 프론트엔드 개발자입니다.', null),
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.blocks[0].section, '맞춤 요약');
  assert.equal(ok.blocks.find(block => block.section === '경력 내용').id, 'blk_f6');
  assert.ok(!ok.blocks.some(block => block.id === 'blk_f2'));
  assert.equal(blocksCanonical(blocks), before, 'input blocks are unchanged');
  const bad = [
    [change('replace', 'blk_skills', '다른 문장', 'x', ['f7']), 'CHANGE_BEFORE_MISMATCH'],
    [change('replace', 'blk_missing', 'a', 'b', ['f7']), 'CHANGE_BLOCK_NOT_FOUND'],
    [change('insert', 'blk_skills', null, 'x', ['f7']), 'CHANGE_BLOCK_EXISTS'],
    [change('insert', 'blk_x', null, 'x', []), 'CHANGE_FACTS_REQUIRED'],
    [change('replace', 'blk_skills', skills.text, 'x', []), 'CHANGE_FACTS_REQUIRED'],
    [change('remove', 'blk_skills', skills.text, 'x'), 'CHANGE_SHAPE_INVALID'],
    [change('reorder', 'blk_f5', 'a', null, ['f5']), 'CHANGE_SHAPE_INVALID'],
    [change('replace', 'bad id!', 'a', 'b', ['f7']), 'CHANGE_BLOCK_INVALID'],
    [change('replace', 'blk_skills', skills.text, 'x'.repeat(1001), ['f7']), 'CHANGE_TEXT_TOO_LONG'],
    [{ ...change('replace', 'blk_skills', skills.text, 'x', ['f7']), operation: 'rewrite' }, 'CHANGE_OPERATION_INVALID'],
  ];
  for (const [item, code] of bad) assert.equal(applyChanges(blocks, [item]).code, code, code);
  const all = blocks.map(block => change('remove', block.id, block.text, null));
  assert.equal(applyChanges(blocks, all).code, 'RESUME_EMPTY');
});

test('guard blocks new numbers, unknown tech terms and inflated scope, but allows rewording', () => {
  assert.deepEqual(checkSupported('React · TypeScript 기반 프론트엔드 개발자', ['f1', 'f7', 'f8'], FACTS), []);
  assert.deepEqual(checkSupported('예시 프로덕트 A에서 2021.03 - 2026.10 근무', ['f3', 'f4'], FACTS), []);
  const codes = text => checkSupported(text, ['f5', 'f7'], FACTS).map(issue => issue.code);
  assert.deepEqual(codes('React로 대시보드 성능을 30% 개선했습니다.'), ['UNSUPPORTED_NUMBER']);
  assert.deepEqual(codes('React와 Kubernetes로 화면 구조를 담당했습니다.'), ['UNSUPPORTED_TERM']);
  assert.deepEqual(codes('React 팀을 리딩하며 화면 구조를 총괄했습니다.'), ['UNSUPPORTED_SCOPE', 'UNSUPPORTED_SCOPE']);
  assert.deepEqual(checkSupported('React', ['nope'], FACTS).map(issue => issue.code), ['FACT_NOT_IN_REVISION', 'UNSUPPORTED_TERM'], 'a missing fact supports nothing');
  assert.deepEqual(checkChange(change('remove', 'b', 'x', null), FACTS), [], 'removal cannot add facts');
  assert.deepEqual(checkChange(change('insert', 'b', null, '5명 리딩', [], { needs_fact_confirmation: true }), FACTS), [], 'pending confirmations are checked after confirmation');
});

const JOB = MOCK_JOBS.find(job => job.job_key.endsWith('lumino-frontend'));
const input = (message, blocks = baseBlocks(FACTS)) => ({ job: JOB, facts: FACTS, blocks, history: [], message });

test('mock chat: tailoring proposal only recombines confirmed facts', async () => {
  const provider = createMockChatProvider();
  const output = await provider.respond(input('이 공고에 맞춰 수정해줘'));
  assert.ok(output.changes.length >= 2);
  assert.deepEqual(output.changes.map(item => item.operation).slice(0, 2), ['replace', 'insert']);
  for (const item of output.changes) assert.deepEqual(checkChange(item, FACTS), [], JSON.stringify(item));
  assert.equal(applyChanges(baseBlocks(FACTS), output.changes).ok, true);
  assert.match(output.reply, /새로운 경력 사실은 추가하지 않았습니다/);
  const storybook = await provider.respond(input('Storybook 경험을 강조해줘'));
  assert.match(storybook.changes[0].after, /^Storybook/);
});

test('mock chat: asks instead of inventing, turns user statements into confirmation candidates, fails and waits on demand', async () => {
  const provider = createMockChatProvider({ slowMs: 30 });
  const asked = await provider.respond(input('리딩 경험을 더 드러내줘'));
  assert.deepEqual(asked.changes, []);
  assert.match(asked.reply, /리딩.*찾지 못했어요/);
  const statement = await provider.respond(input('4명 팀의 프론트엔드 코드 리뷰를 리딩했어요.'));
  assert.equal(statement.changes[0].needs_fact_confirmation, true);
  assert.deepEqual(statement.changes[0].fact_ids, []);
  await assert.rejects(provider.respond(input('[mock:fail] 맞춰줘')), { code: 'MOCK_CHAT_FAILURE' });
  const started = Date.now();
  await provider.respond(input('[mock:slow] 맞춰줘'));
  assert.ok(Date.now() - started >= 25);
  const controller = new AbortController();
  const pending = provider.respond({ ...input('[mock:slow] 맞춰줘'), signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'ABORTED' });
});

test('screenChanges drops unsupported or invented proposals and keeps user-statement candidates only from the user message', () => {
  const blocks = baseBlocks(FACTS);
  const skills = blocks.find(block => block.id === 'blk_skills');
  const screened = screenChanges({ reply: 'x', questions: [], changes: [
    change('replace', 'blk_skills', skills.text, 'React · TypeScript · Next.js · Storybook · Kubernetes', ['f7', 'f8', 'f9', 'f10']),
    change('insert', 'blk_ok', null, '프론트엔드 개발자 · React', ['f1', 'f7']),
    change('insert', 'blk_claim', null, '팀 4명을 리딩했습니다', [], { needs_fact_confirmation: true }),
    change('insert', 'blk_user', null, '4명 팀의 코드 리뷰를 리딩했어요.', [], { needs_fact_confirmation: true }),
    change('replace', 'blk_skills', 'stale before', 'React', ['f7']),
  ] }, { blocks, facts: FACTS, userMessage: '저는 4명 팀의   코드 리뷰를 리딩했어요.' });
  assert.deepEqual(screened.changes.map(item => item.block_id), ['blk_ok', 'blk_user']);
  assert.equal(screened.questions.length, 3);
  assert.ok(screened.questions.some(text => text.includes('kubernetes')));
});

test('PDF renderer: Korean text, wrapping, page breaks, deterministic bytes; filenames are sanitized', async () => {
  const blocks = baseBlocks(FACTS);
  const long = [...blocks, ...Array.from({ length: 45 }, (_, i) => ({ id: `d${i}`, section: '경력 내용', text: `${i + 1}번째 문장: 공통 컴포넌트 구조와 코드 리뷰 기준을 정리했습니다. 띄어쓰기없이아주길게이어지는한글문장도페이지폭에맞춰줄바꿈되어야합니다`, fact_ids: ['f6'] }))];
  const at = new Date('2026-11-17T00:00:00Z');
  const first = await renderResumePdf({ blocks: long, title: '이력서', finalizedAt: at });
  const second = await renderResumePdf({ blocks: long, title: '이력서', finalizedAt: at });
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(first.bytes), hash(second.bytes), 'same input renders identical bytes');
  assert.ok(first.pageCount >= 2, 'long resume spans pages');
  assert.match(first.renderVersion, /^resume-pdf\.v2/);
  // 텍스트 추출과 별개로, 그린 글리프마다 임베딩 글꼴에 윤곽선이 있어야 화면에 보인다(서브셋 결함 회귀 방지).
  const glyphs = glyphReport(first.bytes);
  assert.equal(glyphs.fonts, 1);
  assert.ok(glyphs.usedGlyphs > 50);
  assert.deepEqual(glyphs.missing, [], 'every drawn glyph has an outline');
  const text = await extractPdfTextIsolated(Buffer.from(first.bytes));
  assert.equal(text.pages.length, first.pageCount);
  const joined = text.pages.map(page => page.text.replace(/\d+ \/ \d+\s*$/, '')).join('\n').replace(/\s+/g, '');
  for (const block of long) assert.ok(joined.includes(block.text.replace(/\s+/g, '')), `missing: ${block.text.slice(0, 20)}`);
  assert.match(text.pages[0].text, /핵심 요약|요약/);
  assert.equal(artifactFilename('루미노랩 (합성)', '프론트엔드/개발자:*', 3), '이력서_루미노랩_프론트엔드개발자_v3.pdf');
});

test('guard (review fixes): number+unit pairs, full-width digits, Korean counts, single letters, more scope words', () => {
  const evidence = [fact('a', 'skill', 'React'), fact('b', 'responsibility', '30명 규모 고객 대상 결제 화면 개발')];
  const codes = text => [...new Set(checkSupported(text, ['a', 'b'], evidence).map(issue => issue.code))];
  assert.deepEqual(codes('결제 전환율을 30% 개선'), ['UNSUPPORTED_NUMBER'], '30명 evidence does not support 30%');
  assert.deepEqual(codes('１００명 사용자'), ['UNSUPPORTED_NUMBER'], 'full-width digits are normalized');
  assert.deepEqual(codes('세 명의 개발자와 결제 화면 개발'), ['UNSUPPORTED_NUMBER']);
  assert.deepEqual(codes('두 배 성장시킨 프로젝트를 주관'), ['UNSUPPORTED_NUMBER', 'UNSUPPORTED_SCOPE']);
  assert.deepEqual(codes('C 언어와 R 분석'), ['UNSUPPORTED_TERM']);
  assert.deepEqual(codes('결제 화면 개발팀을 이끌었습니다'), ['UNSUPPORTED_SCOPE']);
  assert.deepEqual(codes('가나다 주식회사 최고기술책임'), ['UNSUPPORTED_SCOPE']);
  assert.deepEqual(codes('React로 30명 규모 고객 대상 결제 화면 개발'), [], 'faithful rewording passes');
});

test('factDrift finds blocks whose facts were removed or reworded after the document was pinned', () => {
  const blocks = baseBlocks(FACTS);
  assert.deepEqual(factDrift(blocks, FACTS, [...FACTS, fact('new', 'achievement', '추가 사실')]), [], 'adding a fact is not drift');
  const removed = FACTS.filter(item => item.id !== 'f5');
  assert.deepEqual(factDrift(blocks, FACTS, removed), ['blk_f5']);
  const reworded = FACTS.map(item => item.id === 'f3' ? { ...item, statement: '다른 회사 (가상)' } : item);
  assert.deepEqual(factDrift(blocks, FACTS, reworded), ['blk_f3']);
});

test('renderer refuses characters missing from the font instead of dropping them silently', async () => {
  assert.deepEqual(missingGlyphs(['Société Müller ✓ 😀 프론트엔드 React']), ['é', 'ü', '✓', '😀']);
  assert.deepEqual(missingGlyphs(['탭\t공백', '가'.normalize('NFD')]), [], 'tabs become spaces and decomposed Hangul is composed');
  assert.equal(renderableText('a\tb'), 'a b');
  await assert.rejects(renderResumePdf({ blocks: [{ id: 'b', section: '경력', text: 'Société', fact_ids: ['x'] }], title: '이력서', finalizedAt: new Date(0) }), { name: 'RenderGlyphError' });
});

test('chat output shape is validated before anything is stored', () => {
  assert.equal(isChatOutput({ reply: 'ok', changes: [], questions: [] }), true);
  for (const bad of [null, { reply: 5, changes: [], questions: [] }, { reply: 'x', changes: null, questions: [] }, { reply: 'x', changes: [{ operation: 'rewrite' }], questions: [] },
    { reply: 'x', changes: [{ operation: 'insert', block_id: 'b', before: null, after: 'a', reason: 'r', needs_fact_confirmation: false }], questions: [] }, { reply: 'x', changes: [], questions: [3] }]) {
    assert.equal(isChatOutput(bad), false, JSON.stringify(bad));
  }
});

test('mock statement candidates get content-based ids; a repeated statement is not inserted twice', async () => {
  const provider = createMockChatProvider();
  const first = await provider.respond(input('4명 팀의 코드 리뷰를 리딩했어요.'));
  const second = await provider.respond(input('주간 배포 일정을 관리했어요.'));
  assert.notEqual(first.changes[0].block_id, second.changes[0].block_id);
  const blocks = [...baseBlocks(FACTS), { id: first.changes[0].block_id, section: '맞춤 요약', text: '4명 팀의 코드 리뷰를 리딩했어요.', fact_ids: ['f1'] }];
  const screened = screenChanges(first, { blocks, facts: FACTS, userMessage: '4명 팀의 코드 리뷰를 리딩했어요.' });
  assert.deepEqual(screened.changes, []);
  assert.ok(screened.questions.some(text => text.includes('이미 문서')));
});
