import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionReason, applicableWording, groupNeedsAttention, attentionSummary } from '../apps/web/src/resume/attention.ts';

// 확정 화면 확인 부담 줄이기(S1-33). 원문 그대로인 항목은 확인할 것이 없으므로 묶음을 접고,
// 사용자가 판단해야 하는 항목만 '확인할 것'으로 앞에 둔다. 화면에 보이는 문장은 저장되는 문장과 같아야 한다.

const QUOTE = '결제 시스템을 설계하고 운영했다.';
const fact = (id, statement, quote = QUOTE) => ({ id, category: 'responsibility', statement,
  evidence: [{ kind: 'document', document_id: 'doc', page: 1, start: 0, end: quote.length, quote }] });
const item = (id, overrides = {}) => ({ fact: fact(id, QUOTE), original: QUOTE, included: true, origin: 'extracted', ...overrides });

test('an included sentence copied from the source needs no attention', () => {
  assert.equal(attentionReason(item('a'), { section: 'career', wording: '결제 시스템 설계·운영', primary: true }), null);
  assert.equal(attentionReason(item('a'), undefined), null);
});

test('sensitive lines are flagged whether or not they are currently included', () => {
  assert.equal(attentionReason(item('a', { included: false }), { section: 'sensitive', wording: null, primary: true }), 'sensitive_excluded');
  assert.equal(attentionReason(item('a'), { section: 'sensitive', wording: null }), 'sensitive_excluded');
});

test('an included sentence outside its source cannot be saved and is flagged first', () => {
  const edited = item('a', { fact: fact('a', '결제 시스템을 처음부터 혼자 만들었다.') });
  assert.equal(attentionReason(edited, { section: 'sensitive', wording: null }), 'not_in_source');
  assert.equal(attentionReason({ ...edited, included: false }, undefined), null);
});

test('lines the user added from the source are flagged for category check, user edits inside the source are not', () => {
  assert.equal(attentionReason(item('a', { origin: 'user_added' }), undefined), 'user_added');
  assert.equal(attentionReason(item('a', { fact: fact('a', '결제 시스템을 설계') }), undefined), null);
});

test('a wording suggestion is shown only when saving it would stay inside the source', () => {
  assert.equal(applicableWording(item('a'), { section: 'career', wording: '결제 시스템을 설계', primary: true }), '결제 시스템을 설계');
  assert.equal(applicableWording(item('a'), { section: 'career', wording: '결제 시스템 설계·운영 경험', primary: true }), null);
  assert.equal(applicableWording(item('a'), { section: 'career', wording: QUOTE }), null);
  assert.equal(applicableWording(item('a', { origin: 'user_added' }), { section: 'career', wording: '결제 시스템을 설계' }), null);
  assert.equal(applicableWording(item('a'), undefined), null);
});

test('a group stays open when any of its items, including nested ones, needs attention', () => {
  const reasons = [null, 'sensitive_excluded', null];
  assert.equal(groupNeedsAttention({ indexes: [0, 1] }, reasons), true);
  assert.equal(groupNeedsAttention({ indexes: [0, 2] }, reasons), false);
  assert.equal(groupNeedsAttention({ indexes: [] }, reasons), false);
});

test('summary counts flagged items and source lines still waiting for the user', () => {
  const items = [item('a'), item('b', { included: false }), item('c', { origin: 'user_added' })];
  const review = { b: { section: 'sensitive', wording: null, primary: true } };
  const warnings = ['UNCLASSIFIED_LINE@1:0-14 분류하지 못함', 'NEGATED_OR_UNVERIFIED@1:20-30 미확인', 'PERSONAL_INFO_EXCLUDED@1:47-120 연락처', 'UNCLASSIFIED_LINE@- 위치 없음', 'broken'];
  assert.deepEqual(attentionSummary(items, review, warnings), { sensitive_excluded: 1, not_in_source: 0, user_added: 1, source_lines: 2, total: 4 });
  assert.deepEqual(attentionSummary([], undefined, []), { sensitive_excluded: 0, not_in_source: 0, user_added: 0, source_lines: 0, total: 0 });
});
