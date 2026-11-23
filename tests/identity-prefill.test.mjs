import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_QUESTIONS, identityPrefill } from '../packages/apply/src/identity.ts';

// 직접 지원할 때 이름·이메일을 매번 다시 쓰지 않게, 비어 있는 칸만 최근 다른 지원 건의 사용자 답변으로 채운다.
// 지원 동기·동의처럼 공고마다 답할 문항은 가져오지 않는다. 채운 값은 화면에서 확인하고 저장해야 지원 내용이 된다.

const answer = (question_id, value) => ({ question_id, answer: value });
const app = (id, updated_at, answers) => ({ id, updated_at, current: { answers } });

test('identity questions are name and email only', () => {
  assert.deepEqual([...IDENTITY_QUESTIONS], ['applicant_name', 'applicant_email']);
});

test('empty name and email come from the most recently updated other application', () => {
  const others = [
    app('application_old', '2026-11-20T00:00:00.000Z', [answer('applicant_name', '예전 이름'), answer('applicant_email', 'old@example.com')]),
    app('application_new', '2026-11-23T00:00:00.000Z', [answer('applicant_name', '데모 지원자'), answer('applicant_email', 'demo@example.com'), answer('motivation', '이 공고만의 지원 동기')]),
  ];
  assert.deepEqual(identityPrefill('application_now', [], others), { applicant_name: '데모 지원자', applicant_email: 'demo@example.com' });
});

test('answers already in the current application are never replaced', () => {
  const others = [app('application_new', '2026-11-23T00:00:00.000Z', [answer('applicant_name', '데모 지원자'), answer('applicant_email', 'demo@example.com')])];
  assert.deepEqual(identityPrefill('application_now', [answer('applicant_name', '직접 쓴 이름')], others), { applicant_email: 'demo@example.com' });
});

test('the current application itself and blank answers are not sources', () => {
  const others = [
    app('application_now', '2026-11-24T00:00:00.000Z', [answer('applicant_name', '자기 자신')]),
    app('application_blank', '2026-11-23T00:00:00.000Z', [answer('applicant_name', '   '), answer('applicant_email', 'demo@example.com')]),
    app('application_old', '2026-11-20T00:00:00.000Z', [answer('applicant_name', '데모 지원자')]),
  ];
  assert.deepEqual(identityPrefill('application_now', [answer('applicant_name', '')], others), { applicant_name: '데모 지원자', applicant_email: 'demo@example.com' });
});

test('no earlier application or malformed input gives nothing to fill', () => {
  assert.deepEqual(identityPrefill('application_now', [], []), {});
  assert.deepEqual(identityPrefill('application_now', [], null), {});
  assert.deepEqual(identityPrefill('application_now', undefined, [app('application_old', 'bad-date', [answer('motivation', '지원 동기')])]), {});
});
