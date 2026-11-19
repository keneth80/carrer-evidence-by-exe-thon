import test from 'node:test';
import assert from 'node:assert/strict';
import { answerIssues, canonicalJson, fillValue, parseAnswers, payloadHash } from '../packages/apply/src/payload.ts';
import { demoPosting, SELF_FORM_QUESTIONS, selfFormPostingFromUrl, selfFormTarget } from '../packages/apply/src/self-form.ts';
import { parseReadback, parseSnapshot, readbackIssues, snapshotHash, snapshotIssues } from '../packages/apply/src/verify.ts';
import { answers, ANSWERS, snapshotFor } from './helpers/s05-harness.mjs';

// S05 순수 함수: 답변 검증·payload hash·자체 폼 주소·폼 snapshot/readback 대조.

test('answers: only known questions, exact question text, user source, length and characters', () => {
  const ok = parseAnswers(answers(), SELF_FORM_QUESTIONS);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.answers.map(item => item.question_id), ['applicant_email', 'applicant_name', 'motivation', 'privacy_consent']);
  assert.equal(parseAnswers('x', SELF_FORM_QUESTIONS).code, 'ANSWERS_INVALID');
  assert.equal(parseAnswers([{ ...answers()[0], question_id: 'salary' }], SELF_FORM_QUESTIONS).code, 'ANSWER_QUESTION_UNKNOWN');
  assert.equal(parseAnswers([answers()[0], answers()[0]], SELF_FORM_QUESTIONS).code, 'ANSWER_QUESTION_UNKNOWN', 'duplicate');
  assert.equal(parseAnswers([{ ...answers()[0], question_text: '성함' }], SELF_FORM_QUESTIONS).code, 'ANSWER_QUESTION_TEXT_MISMATCH');
  assert.equal(parseAnswers([{ ...answers()[0], source: 'confirmed_fact' }], SELF_FORM_QUESTIONS).code, 'ANSWER_SOURCE_UNSUPPORTED');
  assert.equal(parseAnswers([{ ...answers()[0], source_ids: ['fact_1'] }], SELF_FORM_QUESTIONS).code, 'ANSWER_SOURCE_INVALID');
  assert.equal(parseAnswers([{ ...answers()[0], answer: 'a\nb' }], SELF_FORM_QUESTIONS).code, 'ANSWER_CHARACTERS_INVALID', 'single-line field');
  assert.equal(parseAnswers([{ ...answers()[0], answer: 'a'.repeat(51) }], SELF_FORM_QUESTIONS).code, 'ANSWER_TOO_LONG');
  assert.equal(parseAnswers([{ ...answers()[0], extra: 1 }], SELF_FORM_QUESTIONS).code, 'ANSWERS_INVALID');
  const spaced = parseAnswers(answers({ ...ANSWERS, applicant_email: '  a@example.com ', motivation: '  앞뒤 공백 유지  ' }), SELF_FORM_QUESTIONS).answers;
  assert.equal(spaced.find(item => item.question_id === 'applicant_email').answer, 'a@example.com', 'single-line answers trimmed like the browser does');
  assert.equal(spaced.find(item => item.question_id === 'motivation').answer, '  앞뒤 공백 유지  ');
  const crlf = parseAnswers(answers({ ...ANSWERS, motivation: '첫 줄\r\n둘째 줄' }), SELF_FORM_QUESTIONS);
  assert.equal(crlf.answers.find(item => item.question_id === 'motivation').answer, '첫 줄\n둘째 줄', 'line endings normalized like a browser textarea');
});

test('answer completeness: required, email format, consent value', () => {
  const full = parseAnswers(answers(), SELF_FORM_QUESTIONS).answers;
  assert.deepEqual(answerIssues(full, SELF_FORM_QUESTIONS), []);
  assert.deepEqual(answerIssues([], SELF_FORM_QUESTIONS).map(issue => issue.code), ['ANSWER_REQUIRED', 'ANSWER_REQUIRED', 'ANSWER_REQUIRED', 'ANSWER_REQUIRED']);
  const bad = parseAnswers(answers({ ...ANSWERS, applicant_email: 'not-an-email', privacy_consent: '네' }), SELF_FORM_QUESTIONS).answers;
  assert.deepEqual(answerIssues(bad, SELF_FORM_QUESTIONS).map(issue => issue.code), ['ANSWER_EMAIL_INVALID', 'ANSWER_CONSENT_INVALID']);
  assert.equal(fillValue(SELF_FORM_QUESTIONS[3], '동의'), 'checked');
  assert.equal(fillValue(SELF_FORM_QUESTIONS[3], ''), '');
});

test('payload hash covers job, resume, file hash and every answer; key order does not matter', () => {
  const parts = { job_snapshot_id: 'job_1', job_content_hash: 'a'.repeat(64), resume_revision_id: 'rr_1', artifact_id: 'art_1', artifact_sha256: 'b'.repeat(64), answers: parseAnswers(answers(), SELF_FORM_QUESTIONS).answers };
  const base = payloadHash(parts);
  assert.equal(payloadHash({ ...parts, answers: [...parts.answers].reverse() }), base);
  for (const change of [{ artifact_sha256: 'c'.repeat(64) }, { job_snapshot_id: 'job_2' }, { resume_revision_id: 'rr_2' }, { job_content_hash: 'd'.repeat(64) }]) assert.notEqual(payloadHash({ ...parts, ...change }), base);
  assert.notEqual(payloadHash({ ...parts, answers: parts.answers.map(item => item.question_id === 'motivation' ? { ...item, answer: item.answer + '.' } : item) }), base);
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});

test('self-form address: exact origin and path only; mock jobs only', () => {
  assert.equal(selfFormPostingFromUrl('http://127.0.0.1:4310/demo/apply/lumino-frontend'), 'lumino-frontend');
  for (const url of ['http://127.0.0.1:4310/demo/apply/lumino-frontend?x=1', 'http://127.0.0.1:4310/demo/apply/lumino-frontend#a', 'http://localhost:4310/demo/apply/lumino-frontend',
    'https://127.0.0.1:4310/demo/apply/lumino-frontend', 'http://u:p@127.0.0.1:4310/demo/apply/lumino-frontend', 'http://127.0.0.1:4310/demo/apply/unknown', 'http://127.0.0.1:4310/demo/apply/../x', 'not a url']) {
    assert.equal(selfFormPostingFromUrl(url), null, url);
  }
  assert.deepEqual(selfFormTarget({ job_key: 'mock-job-board-v1:lumino-frontend', site_id: 'mock-job-board-v1' }), { posting_id: 'lumino-frontend', target_url: 'http://127.0.0.1:4310/demo/apply/lumino-frontend' });
  assert.equal(selfFormTarget({ job_key: 'liner:123', site_id: 'liner' }), null);
  assert.equal(demoPosting('pixelhouse-designer').questions.at(-1).question_id, 'portfolio_url');
});

test('form snapshot: posting identity, unsupported or changed questions, file input', () => {
  const expected = { site_id: 'self-form', adapter_version: 'self-form.v1', posting_id: 'lumino-frontend', company_name: demoPosting('lumino-frontend').company_name, title: demoPosting('lumino-frontend').title, questions: SELF_FORM_QUESTIONS };
  const good = parseSnapshot(snapshotFor('lumino-frontend'));
  assert.deepEqual(snapshotIssues(good, expected), []);
  assert.equal(snapshotHash(good), snapshotHash(parseSnapshot(JSON.parse(JSON.stringify(snapshotFor('lumino-frontend'))))));
  assert.deepEqual(snapshotIssues(parseSnapshot(snapshotFor('pixelhouse-designer')), expected).map(issue => issue.code).sort(), ['COMPANY_MISMATCH', 'POSTING_MISMATCH', 'TITLE_MISMATCH', 'UNSUPPORTED_QUESTION']);
  const missing = parseSnapshot(snapshotFor('lumino-frontend', s => ({ ...s, questions: s.questions.filter(q => q.question_id !== 'motivation'), file: null })));
  assert.deepEqual(snapshotIssues(missing, expected).map(issue => issue.code), ['FORM_CHANGED', 'FILE_INPUT_UNSUPPORTED']);
  assert.equal(parseSnapshot({ ...snapshotFor('lumino-frontend'), script: 'alert(1)' }), null, 'unknown keys refused');
  assert.equal(parseSnapshot(snapshotFor('lumino-frontend', s => ({ ...s, questions: [{ ...s.questions[0], kind: 'select' }] }))), null);
});

test('readback: values and the attached file bytes hash must match exactly', () => {
  const list = parseAnswers(answers(), SELF_FORM_QUESTIONS).answers;
  const file = { sha256: 'a'.repeat(64), byte_size: 100 };
  const values = SELF_FORM_QUESTIONS.map(q => ({ question_id: q.question_id, value: fillValue(q, list.find(a => a.question_id === q.question_id).answer) }));
  const good = parseReadback({ answers: values, file: { name: 'r.pdf', size: 100, type: 'application/pdf', sha256: 'a'.repeat(64) } });
  assert.deepEqual(readbackIssues(good, list, SELF_FORM_QUESTIONS, file), []);
  assert.deepEqual(readbackIssues({ ...good, file: null }, list, SELF_FORM_QUESTIONS, file).map(i => i.code), ['FILE_MISSING']);
  assert.deepEqual(readbackIssues({ ...good, file: { ...good.file, sha256: 'b'.repeat(64), size: 99, type: 'text/plain' } }, list, SELF_FORM_QUESTIONS, file).map(i => i.code), ['FILE_HASH_MISMATCH', 'FILE_SIZE_MISMATCH', 'FILE_TYPE_MISMATCH']);
  assert.deepEqual(readbackIssues({ ...good, answers: values.map(v => v.question_id === 'privacy_consent' ? { ...v, value: '' } : v) }, list, SELF_FORM_QUESTIONS, file).map(i => i.code), ['ANSWER_MISMATCH']);
  assert.deepEqual(readbackIssues({ ...good, answers: [...values, { question_id: 'portfolio_url', value: 'x' }] }, list, SELF_FORM_QUESTIONS, file).map(i => i.code), ['UNEXPECTED_VALUE']);
  assert.equal(parseReadback({ answers: [], file: { name: 'x', size: 1, type: 'application/pdf', sha256: 'XYZ' } }), null);
});
