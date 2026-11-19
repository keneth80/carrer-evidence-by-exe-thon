import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setIncluded, categorySummary, addLines, MAX_SAVED_FACTS } from '../apps/web/src/resume/bulk.ts';
import { FACT_LIMITS } from '../packages/resume/src/confirm.ts';

// 추출 확인 화면의 일괄 선택: 전체·분류별 포함/제외, 원문 줄 여러 개 추가(중복 제외).

const fact = (id, category, start) => ({
  fact: { id, category, statement: `문장 ${id}`, evidence: [{ kind: 'document', document_id: 'doc_1', page: null, start, end: start + 4, quote: `문장 ${id}` }] },
  original: `문장 ${id}`, included: true, origin: 'extracted',
});
const items = [fact('a', 'skill', 0), fact('b', 'other', 10), fact('c', 'skill', 20), fact('d', 'other', 30)];

test('전체·분류별 포함/제외는 새 배열을 만들고 다른 분류와 원본은 그대로 둔다', () => {
  const none = setIncluded(items, false);
  assert.deepEqual(none.map(item => item.included), [false, false, false, false]);
  assert.deepEqual(items.map(item => item.included), [true, true, true, true], 'input is not mutated');
  const noOther = setIncluded(items, false, 'other');
  assert.deepEqual(noOther.map(item => item.included), [true, false, true, false]);
  assert.equal(noOther[0], items[0], 'untouched items keep their identity');
  assert.deepEqual(setIncluded(noOther, true, 'other').map(item => item.included), [true, true, true, true]);
  assert.deepEqual(setIncluded([], true), []);
});

test('화면 저장 한도는 서버 확정 한도와 같고, 화면 모듈은 서버 전용(node:) 코드를 import하지 않는다', () => {
  assert.equal(MAX_SAVED_FACTS, FACT_LIMITS.maxFacts);
  for (const file of ['bulk.ts', 'FactBulkBar.tsx', 'WarningsPanel.tsx', 'ReviewPage.tsx']) {
    const code = readFileSync(new URL(`../apps/web/src/resume/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(code, /from '[^']*packages\/resume\/src\/confirm\.ts'|from 'node:/, file);
  }
});

test('분류 요약은 처음 나온 순서로 전체·포함 개수를 센다', () => {
  assert.deepEqual(categorySummary(setIncluded(items, false, 'other')), [
    { category: 'skill', total: 2, included: 2 },
    { category: 'other', total: 2, included: 0 },
  ]);
  assert.deepEqual(categorySummary([]), []);
});

test('원문 줄 여러 개 추가: 이미 있는 위치·빈 줄·같은 요청 안의 중복은 건너뛰고 id가 겹치지 않는다', () => {
  const lines = [
    { span: { page: null, start: 10, end: 14 }, quote: '문장 b' },
    { span: { page: null, start: 40, end: 45 }, quote: '새 줄 1' },
    { span: { page: null, start: 40, end: 45 }, quote: '새 줄 1' },
    { span: { page: null, start: 50, end: 50 }, quote: '' },
    { span: { page: null, start: 60, end: 65 }, quote: '새 줄 2' },
  ];
  const next = addLines(items, lines, 'doc_1', 'u1');
  const added = next.slice(items.length);
  assert.deepEqual(added.map(item => [item.fact.statement, item.origin, item.included, item.fact.category]), [
    ['새 줄 1', 'user_added', true, 'other'], ['새 줄 2', 'user_added', true, 'other'],
  ]);
  assert.deepEqual(added[0].fact.evidence, [{ kind: 'document', document_id: 'doc_1', page: null, start: 40, end: 45, quote: '새 줄 1' }]);
  assert.equal(new Set(next.map(item => item.fact.id)).size, next.length, 'ids are unique');
  assert.equal(addLines(next, lines, 'doc_1', 'u1').length, next.length, 'adding the same lines again adds nothing');
  assert.equal(items.length, 4, 'input is not mutated');
});
