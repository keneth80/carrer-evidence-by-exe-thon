import test from 'node:test';
import assert from 'node:assert/strict';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import {
  answers, ANSWERS, approveAndDispatch, authorize, createApplication, executorFetch, finalPdf, pairDevice, prepareForm, readbackFor, runObserve, sha, siteSubmit, snapshotFor,
} from './helpers/s05-harness.mjs';
import { accept, current, say, startTailoring } from './helpers/s04-harness.mjs';
import { runRender } from './helpers/s04-harness.mjs';
import { sweepStaleDispatches } from '../apps/worker/src/observe-task.ts';

// S05: 확정 PDF·답변 → 지원 건 → 실행기 연결 → 폼 관측·readback → 수동 권한 → 시도 → 전송 → 접수 근거 → 이력.
// 실제 HTTP + 실행기 프로토콜(확장 역할을 HTTP로 수행). 실제 Chrome 검증은 별도 스크립트다.

async function setup(prefix, name = 'alice') {
  const { folder, cleanup } = tempFolder(prefix);
  const api = await startApi(folder);
  const user = await login(api, name);
  const http = client(api, user);
  return { api, http, user, done: async () => { await api.stop(); cleanup(); } };
}

test('normal submission: answers, form readback, manual authorization, dispatch, receipt evidence and history', async () => {
  const { api, http, done } = await setup('s05-ok-');
  try {
    const prepared = await finalPdf(api, http);
    // 답변 없이 초안을 만들 수 있지만 권한은 만들 수 없다.
    const created = await createApplication(http, prepared, []);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.submission_state, 'draft');
    assert.equal(created.body.recruitment_stage, 'unknown');
    assert.equal(created.body.current.artifact_sha256, prepared.artifact.sha256);
    const updated = await http.patch(`/api/v1/job-applications/${created.body.id}`, { json: { expected_revision: 1, job_snapshot_id: prepared.job.id, resume_revision_id: prepared.revision.id, artifact_id: prepared.artifact.id, answers: answers() } });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.current.revision, 2);
    assert.notEqual(updated.body.current.payload_hash, created.body.current.payload_hash);
    assert.equal(updated.body.current.answers.find(item => item.question_id === 'motivation').answer, ANSWERS.motivation, 'Korean multi-line answer is kept');

    const device = await pairDevice(api, http);
    const work = await device.get('/applications');
    assert.equal(work.body.items.length, 1);
    assert.equal(work.body.items[0].answers_complete, true);
    const form = await prepareForm(device, created.body.id);
    assert.equal(form.plan.status, 200);
    assert.equal(sha(form.file.body), prepared.artifact.sha256, 'executor receives the exact PDF bytes');
    assert.equal(form.inspected.body.state, 'inspected');
    assert.equal(form.verified.status, 201);
    assert.equal(form.verified.body.state, 'verified', JSON.stringify(form.verified.body.issues));
    assert.equal((await http.get(`/api/v1/job-applications/${created.body.id}`)).body.submission_state, 'prepared');

    const application = updated.body;
    const flow = await approveAndDispatch(api, http, device, application, form);
    assert.equal(flow.auth.body.kind, 'manual');
    assert.equal(flow.auth.body.artifact_sha256, prepared.artifact.sha256);
    assert.equal(flow.auth.body.payload_hash, application.current.payload_hash);
    assert.equal(flow.attempt.body.state, 'prepared');
    assert.equal(flow.dispatch.status, 200, JSON.stringify(flow.dispatch.body));
    assert.equal(flow.dispatch.body.submission_key, flow.attempt.body.id);
    assert.equal((await http.get(`/api/v1/job-applications/${created.body.id}`)).body.submission_state, 'running');

    // 페이지가 제출하고, 확장은 완료 화면을 관측해 보고한다.
    const receipt = await siteSubmit(api, form.plan.body.posting_id, flow.claim.body.fill, form.file.body, flow.dispatch.body.submission_key);
    assert.equal(receipt.status, 201);
    assert.equal(receipt.body.file.sha256, prepared.artifact.sha256);
    const reported = await device.post(`/attempts/${flow.attempt.body.id}/result`, { run_token: flow.claim.body.run_token, outcome: 'confirmation', detail: '', observed: { receipt_number: receipt.body.receipt_number, posting_id: form.plan.body.posting_id, submission_key: flow.attempt.body.id, page_url: form.plan.body.target_url } });
    assert.equal(reported.status, 200, JSON.stringify(reported.body));
    assert.equal(reported.body.state, 'submitted');
    assert.equal(reported.body.evidence_ids.length, 2);
    const attempt = (await http.get(`/api/v1/submission-attempts/${flow.attempt.body.id}`)).body;
    const evidence = await Promise.all(attempt.evidence_ids.map(id => http.get(`/api/v1/submission-evidence/${id}`)));
    assert.deepEqual(evidence.map(item => item.body.kind).sort(), ['confirmation_page', 'receipt_id']);
    assert.ok(evidence.every(item => item.body.conclusion === 'submitted'));
    assert.match(evidence.find(item => item.body.kind === 'receipt_id').body.summary, new RegExp(receipt.body.receipt_number));

    const history = (await http.get(`/api/v1/job-applications/${created.body.id}/history`)).body;
    assert.equal(history.application.submission_state, 'submitted');
    assert.equal(history.revisions.length, 2);
    assert.equal(history.jobs[0].company_name, prepared.job.company_name);
    assert.equal(history.artifacts[0].sha256, prepared.artifact.sha256);
    assert.equal(history.authorizations[0].authorization.user_reviewed_at !== null, true);
    assert.equal(history.attempts[0].dispatch_started_at !== null, true);
    assert.equal(history.evidence.length, 2);

    // 채용 진행 단계는 접수 상태와 별개로 기록한다.
    const stage = await http.post(`/api/v1/job-applications/${created.body.id}/recruitment-events`, { json: { expected_application_revision: 2, stage: 'interview', note: '1차 면접 안내 메일' } });
    assert.equal(stage.status, 201);
    assert.equal(stage.body.recruitment_stage, 'interview');
    assert.equal(stage.body.submission_state, 'submitted');

    // 같은 공고 재지원·같은 지원 건 재승인은 막는다.
    assert.equal((await createApplication(http, prepared)).body.code, 'APPLICATION_EXISTS');
    assert.equal((await authorize(http, application, form.verified.body)).body.code, 'APPLICATION_ALREADY_SUBMITTED');
    assert.equal((await device.post(`/attempts/${flow.attempt.body.id}/claim`)).body.code, 'ATTEMPT_NOT_PREPARED', 'a dispatched attempt is never re-run');
  } finally { await done(); }
});

test('changed file or answers in the form are rejected before any submission', async () => {
  const { api, http, done } = await setup('s05-readback-');
  try {
    const prepared = await finalPdf(api, http);
    const app = (await createApplication(http, prepared)).body;
    const device = await pairDevice(api, http);
    // 다른 파일 bytes가 첨부된 readback은 검증되지 않고, 권한을 만들 수 없다.
    const other = Buffer.from('%PDF-1.4 different file');
    const plan = (await device.get(`/applications/${app.id}/prepare`)).body;
    const wrongFile = await prepareForm(device, app.id, { readback: readbackFor(plan.fill, other) });
    assert.equal(wrongFile.verified.body.state, 'mismatch');
    assert.ok(wrongFile.verified.body.issues.some(issue => issue.code === 'FILE_HASH_MISMATCH'));
    assert.equal((await authorize(http, app, wrongFile.verified.body)).body.code, 'FORM_NOT_VERIFIED');
    assert.equal((await http.get(`/api/v1/job-applications/${app.id}`)).body.submission_state, 'waiting_user');
    // 답변이 페이지에서 바뀐 경우
    const edited = plan.fill.map(item => item.question_id === 'applicant_name' ? { ...item, value: '다른 이름' } : item);
    const wrongAnswer = await prepareForm(device, app.id, { readback: readbackFor(edited, Buffer.alloc(0)) });
    assert.ok(wrongAnswer.verified.body.issues.some(issue => issue.code === 'ANSWER_MISMATCH'));
    // 처리할 수 없는 새 문항이 생긴 폼
    const extra = await prepareForm(device, app.id, { snapshot: snapshotFor(plan.posting_id, s => ({ ...s, questions: [...s.questions, { question_id: 'salary_expectation', label: '희망 연봉', kind: 'text', required: true, max_length: 50 }] })) });
    assert.equal(extra.inspected.body.state, 'mismatch');
    assert.ok(extra.inspected.body.issues.some(issue => issue.code === 'UNSUPPORTED_QUESTION'));

    // 검증된 뒤 승인했더라도, 전송 직전 다시 읽은 파일이 다르면 전송하지 않고 시도를 멈춘다.
    const good = await prepareForm(device, app.id);
    assert.equal(good.verified.body.state, 'verified');
    const auth = await authorize(http, app, good.verified.body);
    const attempt = await http.post(`/api/v1/job-applications/${app.id}/attempts`, { json: { authorization_id: auth.body.id } });
    const claim = await device.post(`/attempts/${attempt.body.id}/claim`);
    const dispatch = await device.post(`/attempts/${attempt.body.id}/dispatch`, { run_token: claim.body.run_token, target_url: claim.body.target_url, document_id: 'doc-x', snapshot: good.snapshot, readback: readbackFor(claim.body.fill, other) });
    assert.equal(dispatch.status, 409);
    assert.equal(dispatch.body.code, 'READBACK_MISMATCH');
    const stopped = (await http.get(`/api/v1/submission-attempts/${attempt.body.id}`)).body;
    assert.equal(stopped.state, 'failed_before_dispatch');
    assert.equal(stopped.dispatch_started_at, null);
    assert.equal((await authorize(http, app, good.verified.body)).body.code, 'FORM_NOT_VERIFIED', 'a stopped attempt needs a new form check before re-approval');
    assert.equal((await http.get(`/api/v1/job-applications/${app.id}`)).body.submission_state, 'waiting_user');
    // 바뀐 폼 구조(snapshot hash 다름)도 전송 전에 거절한다.
    const again = await prepareForm(device, app.id);
    const auth2 = await authorize(http, app, again.verified.body);
    const attempt2 = await http.post(`/api/v1/job-applications/${app.id}/attempts`, { json: { authorization_id: auth2.body.id } });
    const claim2 = await device.post(`/attempts/${attempt2.body.id}/claim`);
    const changedForm = snapshotFor(plan.posting_id, s => ({ ...s, questions: s.questions.map(q => q.question_id === 'motivation' ? { ...q, max_length: 500 } : q) }));
    const dispatch2 = await device.post(`/attempts/${attempt2.body.id}/dispatch`, { run_token: claim2.body.run_token, target_url: claim2.body.target_url, document_id: 'doc-y', snapshot: changedForm, readback: readbackFor(claim2.body.fill, again.file.body) });
    assert.equal(dispatch2.body.code, 'FORM_CHANGED');
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM demo_site_submissions').get().n, 0, 'nothing reached the site');
  } finally { await done(); }
});

test('stale, revoked, reused or cross-application authorizations are refused', async () => {
  const { api, http, done } = await setup('s05-stale-');
  try {
    const prepared = await finalPdf(api, http);
    const app = (await createApplication(http, prepared)).body;
    const device = await pairDevice(api, http);
    const form = await prepareForm(device, app.id);
    // 대상(계정 binding·폼 hash)이 관측과 다르면 권한을 만들지 않는다.
    assert.equal((await authorize(http, app, { target: { ...form.verified.body.target, form_snapshot_hash: 'f'.repeat(64) } })).body.code, 'TARGET_MISMATCH');
    assert.equal((await authorize(http, app, form.verified.body, { expected_payload_hash: '0'.repeat(64) })).body.code, 'PAYLOAD_CHANGED');
    assert.equal((await authorize(http, app, form.verified.body, { reviewed: false })).status, 400);

    // 만료된 권한(권한 행의 만료 시각은 DB trigger로 바꿀 수 없으므로 유효시간 설정을 짧게 해 재현한다).
    const ttl = api.config.limits.authorizationTtlMs;
    api.config.limits.authorizationTtlMs = 1;
    const auth = await authorize(http, app, form.verified.body);
    api.config.limits.authorizationTtlMs = ttl;
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await http.post(`/api/v1/job-applications/${app.id}/attempts`, { json: { authorization_id: auth.body.id } })).body.code, 'AUTHORIZATION_EXPIRED');

    // 권한을 만든 뒤 지원 내용이 바뀌면 그 권한·대기 시도는 쓸 수 없다.
    const auth2 = await authorize(http, app, form.verified.body);
    const attempt = await http.post(`/api/v1/job-applications/${app.id}/attempts`, { json: { authorization_id: auth2.body.id } });
    assert.equal(attempt.status, 201);
    const changed = await http.patch(`/api/v1/job-applications/${app.id}`, { json: { expected_revision: 1, job_snapshot_id: prepared.job.id, resume_revision_id: prepared.revision.id, artifact_id: prepared.artifact.id, answers: answers({ ...ANSWERS, motivation: '내용을 고쳤습니다.' }) } });
    assert.equal(changed.status, 200);
    assert.equal((await http.get(`/api/v1/submission-attempts/${attempt.body.id}`)).body.state, 'failed_before_dispatch');
    assert.equal((await device.post(`/attempts/${attempt.body.id}/claim`)).body.code, 'ATTEMPT_NOT_PREPARED');
    assert.equal((await http.post(`/api/v1/job-applications/${app.id}/attempts`, { json: { authorization_id: auth2.body.id } })).body.code, 'AUTHORIZATION_USED');
    // 이전 revision에서 검증한 폼 관측으로는 새 권한을 만들 수 없다.
    const latest = (await http.get(`/api/v1/job-applications/${app.id}`)).body;
    assert.equal((await authorize(http, latest, form.verified.body)).body.code, 'FORM_NOT_VERIFIED');

    // 다른 공고(다른 지원 건)의 권한은 재사용할 수 없다.
    const otherJob = prepared.jobs.find(job => job.job_key !== prepared.job.job_key);
    const exact = new RegExp(`^${otherJob.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const other = await finalPdf(api, http, { start: await startTailoring(api, http, 'frontend', exact) });
    assert.notEqual(other.job.job_key, prepared.job.job_key);
    const otherApp = (await createApplication(http, other)).body;
    assert.ok(otherApp.id, JSON.stringify(otherApp));
    const fresh = await prepareForm(device, latest.id);
    const latestAuth = await authorize(http, latest, fresh.verified.body);
    assert.equal(latestAuth.status, 201);
    assert.equal((await http.post(`/api/v1/job-applications/${otherApp.id}/attempts`, { json: { authorization_id: latestAuth.body.id } })).body.code, 'AUTHORIZATION_NOT_FOUND');
  } finally { await done(); }
});

test('users and devices are isolated: another user cannot read, authorize or execute', async () => {
  const { api, http, done } = await setup('s05-owner-');
  try {
    const prepared = await finalPdf(api, http);
    const app = (await createApplication(http, prepared)).body;
    const device = await pairDevice(api, http);
    const form = await prepareForm(device, app.id);
    const auth = await authorize(http, app, form.verified.body);
    const attempt = await http.post(`/api/v1/job-applications/${app.id}/attempts`, { json: { authorization_id: auth.body.id } });

    const bob = client(api, await login(api, 'bob'));
    assert.equal((await bob.get(`/api/v1/job-applications/${app.id}`)).status, 404);
    assert.equal((await bob.get(`/api/v1/job-applications/${app.id}/history`)).status, 404);
    assert.equal((await bob.get(`/api/v1/submission-attempts/${attempt.body.id}`)).status, 404);
    assert.equal((await authorize(bob, app, form.verified.body)).status, 404);
    assert.equal((await bob.post(`/api/v1/job-applications/${app.id}/attempts`, { json: { authorization_id: auth.body.id } })).status, 404);
    const bobDevice = await pairDevice(api, bob, 'Bob Chrome');
    assert.equal((await bobDevice.get('/applications')).body.items.length, 0);
    assert.equal((await bobDevice.get(`/applications/${app.id}/prepare`)).status, 404);
    assert.equal((await bobDevice.get(`/applications/${app.id}/artifact?revision=1`)).status, 404);
    assert.equal((await bobDevice.post(`/attempts/${attempt.body.id}/claim`)).status, 404);

    // 같은 사용자의 다른 기기는 이 기기에서 승인한 시도를 실행할 수 없다.
    const second = await pairDevice(api, http, '두 번째 Chrome');
    assert.equal((await second.post(`/attempts/${attempt.body.id}/claim`)).body.code, 'EXECUTOR_NOT_BOUND');
    assert.equal((await second.get('/attempts')).body.items.length, 0);
    assert.equal((await device.get('/attempts')).body.items.length, 1);

    // 토큰·연결 코드 검증
    assert.equal((await executorFetch(api, 'f'.repeat(64), 'GET', '/api/executor/v1/session')).status, 401);
    assert.equal((await executorFetch(api, null, 'POST', '/api/executor/v1/pair', { code: 'AAAA-BBBB', label: 'x' })).body.code, 'PAIRING_CODE_INVALID');
    const pairing = await http.post('/api/v1/executor-pairings', { json: { executor: 'chrome' } });
    assert.equal((await executorFetch(api, null, 'POST', '/api/executor/v1/pair', { code: pairing.body.code.toLowerCase(), label: 'one' })).status, 201);
    assert.equal((await executorFetch(api, null, 'POST', '/api/executor/v1/pair', { code: pairing.body.code, label: 'two' })).body.code, 'PAIRING_CODE_INVALID', 'codes are single use');
    // 다른 origin(웹 페이지)에서 실행기 경로를 부르지 못한다.
    const fromPage = await fetch(`${api.base}/api/executor/v1/session`, { headers: { Origin: 'https://evil.example', Authorization: `Bearer ${device.token}` } });
    assert.equal(fromPage.status, 403);

    // 기기 연결 해제: 토큰을 더 쓰지 못하고 대기 시도는 전송 전에 멈춘다.
    const devices = (await http.get('/api/v1/executor-devices')).body.items;
    const revoked = await http.post(`/api/v1/executor-devices/${devices.find(item => item.id === device.info.device_id).id}/revoke`, { json: {} });
    assert.ok(revoked.body.revoked_at);
    assert.equal((await device.get('/session')).body.code, 'DEVICE_REVOKED');
    assert.equal((await http.get(`/api/v1/submission-attempts/${attempt.body.id}`)).body.error_code, 'EXECUTOR_REVOKED');
  } finally { await done(); }
});

test('duplicate requests: idempotent replay, one active attempt per application, one receipt per submission key', async () => {
  const { api, http, done } = await setup('s05-dup-');
  try {
    const prepared = await finalPdf(api, http);
    const key = 'create-application-key-1';
    const first = await http.post('/api/v1/job-applications', { key, json: { job_snapshot_id: prepared.job.id, resume_revision_id: prepared.revision.id, artifact_id: prepared.artifact.id, answers: answers() } });
    const replay = await http.post('/api/v1/job-applications', { key, json: { job_snapshot_id: prepared.job.id, resume_revision_id: prepared.revision.id, artifact_id: prepared.artifact.id, answers: answers() } });
    assert.equal(replay.headers.get('idempotent-replay'), 'true');
    assert.deepEqual(replay.body, first.body);
    const app = first.body;
    const device = await pairDevice(api, http);
    const form = await prepareForm(device, app.id);
    const auth = await authorize(http, app, form.verified.body);
    const attemptKey = 'create-attempt-key-1';
    const a1 = await http.post(`/api/v1/job-applications/${app.id}/attempts`, { key: attemptKey, json: { authorization_id: auth.body.id } });
    const a2 = await http.post(`/api/v1/job-applications/${app.id}/attempts`, { key: attemptKey, json: { authorization_id: auth.body.id } });
    assert.equal(a2.body.id, a1.body.id);
    const auth2 = await authorize(http, app, form.verified.body);
    assert.equal(auth2.body.code, 'SUBMISSION_IN_PROGRESS', 'no second authorization while one attempt is queued');
    assert.equal(api.db.prepare("SELECT count(*) AS n FROM ce7_attempts WHERE application_id = ?").get(app.id).n, 1);

    const claim = await device.post(`/attempts/${a1.body.id}/claim`);
    const dispatch = await device.post(`/attempts/${a1.body.id}/dispatch`, { run_token: claim.body.run_token, target_url: claim.body.target_url, document_id: 'doc', snapshot: form.snapshot, readback: readbackFor(claim.body.fill, form.file.body) });
    const dispatchReplay = await device.post(`/attempts/${a1.body.id}/dispatch`, { run_token: claim.body.run_token, target_url: claim.body.target_url, document_id: 'doc', snapshot: form.snapshot, readback: readbackFor(claim.body.fill, form.file.body) });
    assert.equal(dispatchReplay.body.replay, true);
    assert.equal(dispatchReplay.body.submission_key, dispatch.body.submission_key);
    // 같은 접수 키로 사이트에 두 번 보내도 접수는 하나다.
    const s1 = await siteSubmit(api, form.plan.body.posting_id, claim.body.fill, form.file.body, a1.body.id);
    const s2 = await siteSubmit(api, form.plan.body.posting_id, claim.body.fill, form.file.body, a1.body.id);
    assert.equal(s1.status, 201);
    assert.equal(s2.status, 200);
    assert.equal(s2.body.receipt_number, s1.body.receipt_number);
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM demo_site_submissions').get().n, 1);
    // 결과 보고를 두 번 보내도 근거는 한 번만 기록된다.
    const result = { run_token: claim.body.run_token, outcome: 'confirmation', detail: '', observed: { receipt_number: s1.body.receipt_number, posting_id: form.plan.body.posting_id, submission_key: a1.body.id, page_url: form.plan.body.target_url } };
    const r1 = await device.post(`/attempts/${a1.body.id}/result`, result);
    const r2 = await device.post(`/attempts/${a1.body.id}/result`, result);
    assert.deepEqual(r2.body.evidence_ids, r1.body.evidence_ids);
    // 사이트 쪽 필수 입력 오류는 접수하지 않는다.
    const missing = await siteSubmit(api, form.plan.body.posting_id, claim.body.fill.filter(item => item.question_id !== 'applicant_email'), form.file.body, 'other-key');
    assert.equal(missing.status, 422);
    assert.deepEqual(missing.body.fields, ['applicant_email']);
  } finally { await done(); }
});

test('connection lost during submission: unknown is persistent, observe reconciles without resubmitting', async () => {
  const { api, http, done } = await setup('s05-unknown-');
  try {
    const prepared = await finalPdf(api, http);
    const app = (await createApplication(http, prepared)).body;
    const device = await pairDevice(api, http);
    const form = await prepareForm(device, app.id);
    const flow = await approveAndDispatch(api, http, device, app, form);
    // 확장이 완료 화면을 보지 못하고 끊겼다(사이트에 도달했는지 모름).
    const unknown = await device.post(`/attempts/${flow.attempt.body.id}/result`, { run_token: flow.claim.body.run_token, outcome: 'no_confirmation', detail: 'timeout', observed: null });
    assert.equal(unknown.body.state, 'submission_unknown');
    assert.equal((await http.get(`/api/v1/job-applications/${app.id}`)).body.submission_state, 'submission_unknown');
    // 불명 상태에서는 새 권한·재제출을 만들지 않는다.
    assert.equal((await authorize(http, app, form.verified.body)).body.code, 'SUBMISSION_UNKNOWN');
    assert.equal((await device.post(`/attempts/${flow.attempt.body.id}/claim`)).body.code, 'ATTEMPT_NOT_PREPARED');
    // 접수 결과 확인(조회만): 자체 폼 저장소에 기록이 없으므로 접수 키를 닫고 미접수로 확정한다.
    const observe = await http.post(`/api/v1/submission-attempts/${flow.attempt.body.id}/observe`, { json: {} });
    assert.equal(observe.status, 202);
    assert.equal(observe.body.task.kind, 'submit_application');
    assert.equal(runObserve(api), 'succeeded');
    const settled = (await http.get(`/api/v1/submission-attempts/${flow.attempt.body.id}`)).body;
    assert.equal(settled.state, 'not_submitted');
    // 닫힌 키로 늦게 도착한 전송은 사이트가 받지 않는다.
    const late = await siteSubmit(api, form.plan.body.posting_id, flow.claim.body.fill, form.file.body, flow.attempt.body.id);
    assert.equal(late.status, 409);
    assert.equal(late.body.code, 'SUBMISSION_CLOSED');
    assert.equal((await http.post(`/api/v1/submission-attempts/${flow.attempt.body.id}/observe`, { json: {} })).body.code, 'OBSERVATION_NOT_NEEDED');
    // 미접수 확정 뒤: 예전 관측으로는 승인할 수 없고, 다시 폼을 확인하면 진행할 수 있다(자동 재제출 아님).
    assert.equal((await http.get(`/api/v1/job-applications/${app.id}`)).body.submission_state, 'not_submitted');
    assert.equal((await authorize(http, app, form.verified.body)).body.code, 'FORM_NOT_VERIFIED');
    assert.ok((await device.get('/applications')).body.items.some(item => item.application_id === app.id && item.submission_state === 'not_submitted'));
    const again = await prepareForm(device, app.id);
    assert.equal((await http.get(`/api/v1/job-applications/${app.id}`)).body.submission_state, 'prepared');
    const second = await approveAndDispatch(api, http, device, app, again);
    assert.equal(second.dispatch.status, 200);
    assert.notEqual(second.attempt.body.id, flow.attempt.body.id);
  } finally { await done(); }
});

test('lost response: the site stored the receipt, observe and sweep find it instead of resubmitting', async () => {
  const { api, http, done } = await setup('s05-lost-');
  try {
    const prepared = await finalPdf(api, http);
    const app = (await createApplication(http, prepared, answers({ ...ANSWERS, motivation: '지원합니다. [demo:drop]' }))).body;
    const device = await pairDevice(api, http);
    const form = await prepareForm(device, app.id);
    const flow = await approveAndDispatch(api, http, device, app, form);
    // 사이트는 접수를 저장했지만 응답 없이 연결을 끊는다.
    await assert.rejects(siteSubmit(api, form.plan.body.posting_id, flow.claim.body.fill, form.file.body, flow.attempt.body.id));
    assert.equal(api.db.prepare("SELECT state FROM demo_site_submissions WHERE submission_key = ?").get(flow.attempt.body.id).state, 'accepted');
    // 실행기가 보고하지 못한 채 시간이 지나면 worker가 사이트 기록을 조회해 확정한다(봉인하지 않음, 재제출 없음).
    assert.equal(sweepStaleDispatches({ db: api.db, now: () => Date.now() + 10 * 60_000, reportTimeoutMs: 3 * 60_000 }), 1);
    const settled = (await http.get(`/api/v1/submission-attempts/${flow.attempt.body.id}`)).body;
    assert.equal(settled.state, 'submitted');
    const evidence = (await http.get(`/api/v1/submission-evidence/${settled.evidence_ids[0]}`)).body;
    assert.equal(evidence.kind, 'receipt_id');
    // 늦게 도착한 실행기 보고는 상태를 되돌리지 않는다.
    const late = await device.post(`/attempts/${flow.attempt.body.id}/result`, { run_token: flow.claim.body.run_token, outcome: 'form_error', detail: 'network error', observed: null });
    assert.equal(late.body.state, 'submitted');
  } finally { await done(); }
});

test('browser restart: an unsent attempt can be reclaimed with a new token; a sent one is never re-run', async () => {
  const { api, http, done } = await setup('s05-restart-');
  try {
    const prepared = await finalPdf(api, http);
    const app = (await createApplication(http, prepared)).body;
    const device = await pairDevice(api, http);
    const form = await prepareForm(device, app.id);
    const auth = await authorize(http, app, form.verified.body);
    const attempt = await http.post(`/api/v1/job-applications/${app.id}/attempts`, { json: { authorization_id: auth.body.id } });
    const firstClaim = await device.post(`/attempts/${attempt.body.id}/claim`);
    // 확장이 재시작되어 다시 집는다. 이전 실행 토큰은 더 쓰지 못한다.
    const secondClaim = await device.post(`/attempts/${attempt.body.id}/claim`);
    assert.notEqual(secondClaim.body.run_token, firstClaim.body.run_token);
    const body = token => ({ run_token: token, target_url: secondClaim.body.target_url, document_id: 'doc', snapshot: form.snapshot, readback: readbackFor(secondClaim.body.fill, form.file.body) });
    assert.equal((await device.post(`/attempts/${attempt.body.id}/dispatch`, body(firstClaim.body.run_token))).body.code, 'RUN_TOKEN_INVALID');
    assert.equal((await device.post(`/attempts/${attempt.body.id}/dispatch`, body(secondClaim.body.run_token))).status, 200);
    // 전송 뒤 재시작: 다시 집거나 실행하지 않는다. 서버 상태로 복구해 결과만 조회한다.
    assert.equal((await device.post(`/attempts/${attempt.body.id}/claim`)).body.code, 'ATTEMPT_NOT_PREPARED');
    assert.equal((await device.get('/attempts')).body.items.length, 0);
    assert.equal(sweepStaleDispatches({ db: api.db, now: () => Date.now() + 10 * 60_000, reportTimeoutMs: 3 * 60_000 }), 1);
    const state = (await http.get(`/api/v1/submission-attempts/${attempt.body.id}`)).body;
    assert.equal(state.state, 'submission_unknown');
    assert.equal(state.error_code, 'RECEIPT_NOT_OBSERVED');
  } finally { await done(); }
});

test('history keeps the submitted file and answers after the resume is edited again; external records block duplicates', async () => {
  const { api, http, done } = await setup('s05-history-');
  try {
    const prepared = await finalPdf(api, http);
    const app = (await createApplication(http, prepared)).body;
    const device = await pairDevice(api, http);
    const form = await prepareForm(device, app.id);
    const flow = await approveAndDispatch(api, http, device, app, form);
    const receipt = await siteSubmit(api, form.plan.body.posting_id, flow.claim.body.fill, form.file.body, flow.attempt.body.id);
    await device.post(`/attempts/${flow.attempt.body.id}/result`, { run_token: flow.claim.body.run_token, outcome: 'confirmation', detail: '', observed: { receipt_number: receipt.body.receipt_number, posting_id: form.plan.body.posting_id, submission_key: flow.attempt.body.id, page_url: form.plan.body.target_url } });
    const before = (await http.get(`/api/v1/job-applications/${app.id}/history`)).body;

    // 제출 뒤 같은 공고의 이력서를 다시 고치고 새 PDF를 만든다.
    const proposal = (await say(api, http, prepared.session.id, '이 공고에 맞춰 수정해줘')).proposal;
    const { revision } = await current(http, prepared.session.id);
    const accepted = await accept(http, proposal, revision);
    assert.equal(accepted.status, 201);
    await http.post(`/api/v1/resume-revisions/${accepted.body.id}/finalize`, { json: { expected_content_hash: accepted.body.content_hash, reviewed: true } });
    await http.post('/api/v1/artifacts', { json: { resume_revision_id: accepted.body.id } });
    await runRender(api);
    const newArtifact = (await http.get(`/api/v1/resume-revisions/${accepted.body.id}/artifacts`)).body.items[0];
    assert.notEqual(newArtifact.sha256, prepared.artifact.sha256);
    // 제출한 지원 건은 바꿀 수 없고, 이력의 파일·답변·근거는 그대로다.
    const blocked = await http.patch(`/api/v1/job-applications/${app.id}`, { json: { expected_revision: 1, job_snapshot_id: prepared.job.id, resume_revision_id: accepted.body.id, artifact_id: newArtifact.id, answers: answers() } });
    assert.equal(blocked.body.code, 'APPLICATION_ALREADY_SENT');
    const after = (await http.get(`/api/v1/job-applications/${app.id}/history`)).body;
    assert.deepEqual(after.revisions, before.revisions);
    assert.deepEqual(after.artifacts, before.artifacts);
    assert.deepEqual(after.evidence, before.evidence);
    const bytes = (await http.get(`/api/v1/artifacts/${after.revisions[0].artifact_id}/content`, { raw: true })).body;
    assert.equal(sha(bytes), prepared.artifact.sha256, 'the submitted PDF bytes are still served unchanged');
    assert.equal(api.db.prepare('SELECT file_sha256 FROM demo_site_submissions').get().file_sha256, prepared.artifact.sha256);

    // 외부 지원 기록: 같은 공고면 지원 건을 만들지 않는다. 회사·직무만 같으면 확인 안내로만 쓴다.
    const other = prepared.jobs.find(job => job.id !== prepared.job.id && job.site_id === 'mock-job-board-v1');
    const external = await http.post('/api/v1/external-applications', { json: { job_snapshot_id: other.id, company_name: other.company_name, title: other.title, channel: '회사 채용 홈페이지', applied_on: '2026-11-01', note: '' } });
    assert.equal(external.status, 201, JSON.stringify(external.body));
    assert.equal((await http.post('/api/v1/external-applications', { json: { job_snapshot_id: other.id, company_name: other.company_name, title: other.title, channel: '다시', applied_on: '2026-11-01', note: '' } })).body.code, 'EXTERNAL_APPLICATION_EXISTS');
    assert.equal((await http.post('/api/v1/external-applications', { json: { job_snapshot_id: prepared.job.id, company_name: prepared.job.company_name, title: prepared.job.title, channel: '중복', applied_on: '2026-11-01', note: '' } })).body.code, 'APPLICATION_EXISTS');
    const free = await http.post('/api/v1/external-applications', { json: { job_snapshot_id: null, company_name: prepared.job.company_name.replace(' (합성)', ''), title: prepared.job.title, channel: '지인 추천', applied_on: '2026-10-20', note: '메일로 지원' } });
    assert.equal(free.status, 201);
    assert.equal((await http.get(`/api/v1/job-applications/${app.id}/history`)).body.external_matches.length, 1);
    assert.equal((await http.get('/api/v1/external-applications')).body.items.length, 2);
    assert.equal((await http.post('/api/v1/external-applications', { json: { job_snapshot_id: null, company_name: 'x', title: 'y', channel: 'z', applied_on: '2999-01-01', note: '' } })).status, 400, 'future date refused');
  } finally { await done(); }
});

test('review fixes: early observe refused, expired queued attempt closed, other submission not sealed as not_submitted, run token mismatch keeps the device', async () => {
  const { api, http, done } = await setup('s05-review-');
  try {
    const prepared = await finalPdf(api, http);
    const app = (await createApplication(http, prepared)).body;
    const device = await pairDevice(api, http);

    // 승인 뒤 실행하지 않은 채 만료된 대기 시도는 worker가 전송 전 중단으로 닫아 새 승인을 막지 않는다.
    const form = await prepareForm(device, app.id);
    const ttl = api.config.limits.authorizationTtlMs;
    api.config.limits.authorizationTtlMs = 400;
    const auth = await authorize(http, app, form.verified.body);
    api.config.limits.authorizationTtlMs = ttl;
    const queued = await http.post(`/api/v1/job-applications/${app.id}/attempts`, { json: { authorization_id: auth.body.id } });
    assert.equal(queued.status, 201, JSON.stringify(queued.body));
    assert.equal((await authorize(http, app, form.verified.body)).body.code, 'SUBMISSION_IN_PROGRESS');
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(sweepStaleDispatches({ db: api.db, now: Date.now, reportTimeoutMs: 3 * 60_000 }), 1);
    const closed = (await http.get(`/api/v1/submission-attempts/${queued.body.id}`)).body;
    assert.equal(closed.state, 'failed_before_dispatch');
    assert.equal(closed.error_code, 'AUTHORIZATION_EXPIRED');

    // 다시 확인·승인·전송. 실행 토큰이 바뀐(다른 실행이 다시 집은) dispatch는 409이며 기기 연결과 무관하다.
    const fresh = await prepareForm(device, app.id);
    const auth2 = await authorize(http, app, fresh.verified.body);
    const attempt = await http.post(`/api/v1/job-applications/${app.id}/attempts`, { json: { authorization_id: auth2.body.id } });
    assert.equal(attempt.status, 201, JSON.stringify(attempt.body));
    const oldClaim = await device.post(`/attempts/${attempt.body.id}/claim`);
    const claim = await device.post(`/attempts/${attempt.body.id}/claim`);
    const body = token => ({ run_token: token, target_url: claim.body.target_url, document_id: 'doc', snapshot: fresh.snapshot, readback: readbackFor(claim.body.fill, fresh.file.body) });
    const stale = await device.post(`/attempts/${attempt.body.id}/dispatch`, body(oldClaim.body.run_token));
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'RUN_TOKEN_INVALID');
    assert.equal((await device.get('/session')).status, 200, 'device token still valid');
    assert.equal((await device.post(`/attempts/${attempt.body.id}/dispatch`, body(claim.body.run_token))).status, 200);

    // 막 전송한 시도는 접수 결과 확인(봉인)을 1분 동안 받지 않는다.
    assert.equal((await http.post(`/api/v1/submission-attempts/${attempt.body.id}/observe`, { json: {} })).body.code, 'OBSERVATION_TOO_EARLY');

    // 사용자가 페이지의 제출 버튼을 직접 눌러 다른 접수 키로 같은 파일이 접수된 경우: 미접수로 봉인하지 않고 불명으로 남긴다.
    const manual = await siteSubmit(api, fresh.plan.body.posting_id, claim.body.fill, fresh.file.body, null);
    assert.equal(manual.status, 201);
    const reported = await device.post(`/attempts/${attempt.body.id}/result`, { run_token: claim.body.run_token, outcome: 'no_confirmation', detail: 'page_already_submitted', observed: null });
    assert.equal(reported.body.state, 'submission_unknown');
    assert.equal(reported.body.error_code, 'POSSIBLE_OTHER_SUBMISSION');
    const observe = await http.post(`/api/v1/submission-attempts/${attempt.body.id}/observe`, { json: {} });
    assert.equal(observe.status, 202);
    assert.equal(runObserve(api), 'succeeded');
    const after = (await http.get(`/api/v1/submission-attempts/${attempt.body.id}`)).body;
    assert.equal(after.state, 'submission_unknown', 'not sealed as not_submitted');
    assert.equal(after.evidence_ids.length, reported.body.evidence_ids.length, 'repeated observe adds no duplicate evidence');
    assert.equal(api.db.prepare("SELECT count(*) AS n FROM demo_site_submissions WHERE state = 'sealed'").get().n, 0);
    assert.match((await http.get(`/api/v1/submission-evidence/${after.evidence_ids.at(-1)}`)).body.summary, new RegExp(manual.body.receipt_number));
  } finally { await done(); }
});
