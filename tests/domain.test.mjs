import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConditions, evaluateRemoteAvailability, normalizeAnswerText, validateAnswerText } from '../packages/domain/src/index.ts';

const item = (state, priority = 'required') => ({
  condition: '원격 근무', priority, state, reason: '테스트 근거',
  reason_code: ({ satisfied: 'REQUIREMENT_MET', gap: 'REQUIREMENT_GAP', unknown: 'SOURCE_MISSING', conflict: 'SOURCES_CONFLICT' })[state],
  claim_ids: ['claim_001'], experience_ids: [],
});

test('필수 조건의 명시된 차이는 미확인 조건과 함께 있어도 hold다', () => {
  assert.equal(evaluateConditions([item('unknown'), item('gap')]).decision, 'hold');
});

test('필수 정보 미확인과 자료 충돌은 조건 미충족으로 바꾸지 않는다', () => {
  for (const state of ['unknown', 'conflict']) {
    const result = evaluateConditions([item('satisfied'), item(state)]);
    assert.equal(result.decision, 'needs_information');
    assert.equal(result.evaluations[1].state, state);
  }
});

test('선호 조건의 차이·미확인은 검토를 막지 않으며 이유는 남긴다', () => {
  const result = evaluateConditions([item('satisfied'), item('gap', 'preferred'), item('unknown', 'preferred')]);
  assert.equal(result.decision, 'review');
  assert.equal(result.rule_version, 'match.v1');
  assert.deepEqual(result.evaluations.map((value) => value.state), ['satisfied', 'gap', 'unknown']);
});

test('재평가 결과 수정이 이전 평가 입력을 바꾸지 않는다', () => {
  const original = Object.freeze({ ...item('unknown'), claim_ids: Object.freeze(['claim_001']), experience_ids: Object.freeze([]) });
  const result = evaluateConditions(Object.freeze([original]));
  result.evaluations[0].claim_ids.push('changed');
  result.evaluations[0].reason = '수정';
  assert.deepEqual(original.claim_ids, ['claim_001']);
  assert.equal(original.reason, '테스트 근거');
});

test('원격 정보 없음과 명시적인 원격 불가를 구분한다', () => {
  const falseClaim = { id: 'remote_false', field: 'remote_policy', state: 'known', value: false, reason: null, evidence: [{ source_id: 'source_1', quote: '원격 근무 불가', link_check: 'matched_to_chunk' }] };
  assert.equal(evaluateRemoteAvailability(undefined, 'required').state, 'unknown');
  assert.equal(evaluateRemoteAvailability(falseClaim, 'required').state, 'gap');
  assert.equal(evaluateRemoteAvailability({ ...falseClaim, value: '불명확한 안내' }, 'required').state, 'unknown');
});

test('원격 충돌은 conflict를 유지하고 선호 조건으로 바꾸면 review가 된다', () => {
  const claim = { id: 'remote_conflict', field: 'remote_policy', state: 'conflicting', value: null, reason: 'sources_conflict', evidence: [
    { source_id: 'source_1', quote: '원격 근무 가능', link_check: 'matched_to_chunk' },
    { source_id: 'source_2', quote: '원격 근무 불가', link_check: 'matched_to_chunk' },
  ] };
  assert.equal(evaluateConditions([evaluateRemoteAvailability(claim, 'required')]).decision, 'needs_information');
  assert.equal(evaluateConditions([evaluateRemoteAvailability(claim, 'preferred')]).decision, 'review');
});

test('답변은 줄바꿈만 정규화하고 공백·Unicode 조합은 보존한다', () => {
  const original = '  첫째\r\n둘째\r끝 e\u0301  ';
  assert.equal(normalizeAnswerText(original), '  첫째\n둘째\n끝 e\u0301  ');
  assert.equal(validateAnswerText(original).value, '  첫째\n둘째\n끝 e\u0301  ');
});

test('답변은 Unicode code point 500자 경계와 공백 답변을 검사한다', () => {
  assert.equal(validateAnswerText('😀'.repeat(500)).ok, true);
  assert.equal(validateAnswerText('😀'.repeat(500)).code_points, 500);
  assert.equal(validateAnswerText('😀'.repeat(501)).error, 'ANSWER_TOO_LONG');
  assert.equal(validateAnswerText(' \r\n\t ').error, 'ANSWER_BLANK');
});
