import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { answerIssues, fillValue } from '../../../../packages/apply/src/payload.ts';
import { SELF_FORM_ADAPTER_VERSION, SELF_FORM_QUESTIONS, SELF_FORM_SITE_ID, selfFormTarget } from '../../../../packages/apply/src/self-form.ts';
import { parseReadback, parseSnapshot, readbackIssues, snapshotHash, snapshotIssues } from '../../../../packages/apply/src/verify.ts';
import type { Issue } from '../../../../packages/apply/src/types.ts';
import { header, iso, isPlainObject, newId, problem, readJson, sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import { getJobSnapshot } from '../search/repository.ts';
import type { ApplyDeps } from './applications.ts';
import { codeHash } from './devices.ts';
import type { DeviceRow } from './devices.ts';
import { hasReconciler, reconcileSelfForm, recordConfirmationPage, setAttemptState } from './reconcile.ts';
import {
  attemptBody, bindingFingerprint, getApplication, getAppRevision, getAttempt, getAuthorization, observationBody, readVerifiedArtifact, revisionAnswers, submissionState,
} from './repository.ts';
import type { ApplicationRow, AttemptRow, ObservationRow } from './repository.ts';
import { authorizationMessage, authorizationProblem } from './submission.ts';

// 실행기(확장) 내부 프로토콜 /api/executor/v1/*. 공개 제품 API가 아니며 기기 토큰(Bearer)으로 인증한다(docs/EXECUTOR_PROTOCOL.md).
// 실행기는 서버가 허용한 지원 건·파일·동작만 실행한다. 승인·접수 상태는 서버가 보존하고, 실행기 메모리에 두지 않는다.

const PREFIX = '/api/executor/v1';
const ID = '([a-zA-Z0-9_-]{1,128})';
const TOKEN = /^Bearer ([a-f0-9]{64})$/;
const pairFailures: number[] = [];

function transaction(db: DatabaseSync, work: () => Reply): Reply {
  db.exec('BEGIN IMMEDIATE');
  try {
    const reply = work();
    db.exec('COMMIT');
    return reply;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function authenticateDevice(deps: ApplyDeps, request: ProductRequest): DeviceRow | Reply {
  const match = TOKEN.exec(header(request, 'authorization') ?? '');
  if (!match) return problem(request, 401, 'DEVICE_TOKEN_REQUIRED', '확장을 다시 연결해 주세요.');
  const device = deps.db.prepare('SELECT * FROM ce8_executor_devices WHERE token_hash = ?').get(sha256Hex(match[1])) as DeviceRow | undefined;
  if (!device) return problem(request, 401, 'DEVICE_TOKEN_INVALID', '연결 정보가 없습니다. 확장을 다시 연결해 주세요.');
  if (device.revoked_at_ms !== null) return problem(request, 401, 'DEVICE_REVOKED', '웹에서 연결을 해제한 기기입니다. 확장을 다시 연결해 주세요.');
  if (request.nowMs - device.last_seen_at_ms > 60_000) deps.db.prepare('UPDATE ce8_executor_devices SET last_seen_at_ms = ? WHERE id = ?').run(request.nowMs, device.id);
  return device;
}

function pair(deps: ApplyDeps, request: ProductRequest): Reply {
  const now = request.nowMs;
  while (pairFailures.length && pairFailures[0] < now - 60_000) pairFailures.shift();
  if (pairFailures.length >= 20) return problem(request, 429, 'PAIRING_RATE_LIMITED', '연결 시도가 너무 많습니다. 잠시 뒤 다시 시도해 주세요.');
  const parsed = readJson(request, 4096);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== 'code,label' || typeof body.code !== 'string' || body.code.length > 20 || typeof body.label !== 'string' || !body.label.trim() || body.label.length > 60) {
    return problem(request, 400, 'INVALID_PAIR_REQUEST', '연결 코드와 기기 이름이 필요합니다.');
  }
  return transaction(deps.db, () => {
    const pairing = deps.db.prepare('SELECT * FROM ce8_executor_pairings WHERE code_hash = ?').get(codeHash(String(body.code))) as { id: string; workspace_id: string; executor: 'chrome'; expires_at_ms: number; used_at_ms: number | null } | undefined;
    if (!pairing || pairing.used_at_ms !== null || pairing.expires_at_ms <= now) {
      pairFailures.push(now);
      return problem(request, 401, 'PAIRING_CODE_INVALID', '연결 코드가 맞지 않거나 만료되었습니다. 웹에서 새 코드를 만들어 주세요.');
    }
    const token = randomBytes(32).toString('hex');
    const deviceId = newId('device');
    const label = String(body.label).trim();
    deps.db.prepare('INSERT INTO ce8_executor_devices (id, workspace_id, executor, label, token_hash, created_at_ms, last_seen_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(deviceId, pairing.workspace_id, pairing.executor, label, sha256Hex(token), now, now);
    deps.db.prepare('UPDATE ce8_executor_pairings SET used_at_ms = ?, device_id = ? WHERE id = ? AND used_at_ms IS NULL').run(now, deviceId, pairing.id);
    return { status: 201, body: { device_id: deviceId, executor: pairing.executor, label, token } };
  });
}

// 이 기기 × 사이트의 계정 binding. 자체 폼은 사이트 로그인이 없어 기기 단위다(DECISIONS S5-03).
function ensureBinding(db: DatabaseSync, device: DeviceRow, siteId: string, nowMs: number): string {
  const fingerprint = bindingFingerprint(siteId, device.id);
  const row = db.prepare('SELECT id FROM ce7_account_bindings WHERE workspace_id = ? AND site_id = ? AND executor = ? AND account_fingerprint = ? AND revoked_at_ms IS NULL').get(device.workspace_id, siteId, device.executor, fingerprint) as { id: string } | undefined;
  if (row) return row.id;
  const id = newId('binding');
  db.prepare('INSERT INTO ce7_account_bindings (id, workspace_id, site_id, executor, account_label, account_fingerprint, verified_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, device.workspace_id, siteId, device.executor, `${device.label} · 자체 테스트 폼`, fingerprint, nowMs);
  return id;
}

type Plan = { app: ApplicationRow; revision: NonNullable<ReturnType<typeof getAppRevision>>; target: { posting_id: string; target_url: string }; job: NonNullable<ReturnType<typeof getJobSnapshot>> };

function plan(deps: ApplyDeps, ws: string, applicationId: string): Plan | null {
  const app = getApplication(deps.db, ws, applicationId);
  if (!app) return null;
  const revision = getAppRevision(deps.db, ws, app.id, app.current_revision)!;
  const job = getJobSnapshot(deps.db, ws, revision.job_snapshot_id)!;
  const target = selfFormTarget(job);
  return target ? { app, revision, job, target } : null;
}

const fillFor = (answers: ReturnType<typeof revisionAnswers>) =>
  SELF_FORM_QUESTIONS.map(question => ({ question_id: question.question_id, kind: question.kind, value: fillValue(question, answers.find(item => item.question_id === question.question_id)?.answer ?? '') }));

function listWork(deps: ApplyDeps, device: DeviceRow): Reply {
  const apps = deps.db.prepare('SELECT * FROM ce7_applications WHERE workspace_id = ? ORDER BY updated_at_ms DESC, rowid DESC LIMIT 50').all(device.workspace_id) as ApplicationRow[];
  const pendingList = pendingAttempts(deps.db, device);
  const items = apps.map(app => {
    const work = plan(deps, device.workspace_id, app.id);
    const pending = pendingList.find(item => item.application_id === app.id);
    return work && {
      application_id: app.id, application_revision: app.current_revision, payload_hash: work.revision.payload_hash, company_name: work.job.company_name, title: work.job.title,
      target_url: work.target.target_url, site_id: SELF_FORM_SITE_ID, adapter_version: SELF_FORM_ADAPTER_VERSION, submission_state: submissionState(deps.db, app),
      answers_complete: answerIssues(revisionAnswers(work.revision), SELF_FORM_QUESTIONS).length === 0, pending_attempt_id: pending?.id ?? null,
    };
  }).filter(Boolean);
  return { status: 200, body: { items } };
}

function pendingAttempts(db: DatabaseSync, device: DeviceRow): AttemptRow[] {
  return db.prepare(`SELECT a.* FROM ce7_attempts a JOIN ce7_authorizations z ON z.workspace_id = a.workspace_id AND z.id = a.authorization_id
    JOIN ce7_account_bindings b ON b.workspace_id = z.workspace_id AND b.id = z.account_binding_id
    WHERE a.workspace_id = ? AND a.state = 'prepared' AND b.account_fingerprint = ? AND b.revoked_at_ms IS NULL ORDER BY a.created_at_ms`).all(device.workspace_id, bindingFingerprint(SELF_FORM_SITE_ID, device.id)) as AttemptRow[];
}

function prepare(deps: ApplyDeps, request: ProductRequest, device: DeviceRow, applicationId: string): Reply {
  const work = plan(deps, device.workspace_id, applicationId);
  if (!work) return problem(request, 404, 'APPLICATION_NOT_FOUND', '지원 건을 찾을 수 없습니다.');
  const answers = revisionAnswers(work.revision);
  const issues = answerIssues(answers, SELF_FORM_QUESTIONS);
  if (issues.length) return problem(request, 409, 'ANSWERS_INCOMPLETE', `웹에서 답변을 먼저 저장해 주세요: ${issues[0].message}`, { issues });
  const sent = deps.db.prepare("SELECT 1 FROM ce7_attempts WHERE workspace_id = ? AND application_id = ? AND state IN ('dispatched','submitted','submission_unknown')").get(device.workspace_id, applicationId);
  if (sent) return problem(request, 409, 'APPLICATION_ALREADY_SENT', '이미 제출을 시작한 지원 건입니다. 다시 입력하지 않습니다.');
  const file = readVerifiedArtifact(deps.db, deps.store, device.workspace_id, work.revision.artifact_id);
  if ('error' in file) return problem(request, 409, file.error, '저장된 PDF를 확인할 수 없습니다.');
  return {
    status: 200,
    body: {
      application_id: work.app.id, application_revision: work.revision.revision, payload_hash: work.revision.payload_hash,
      site_id: SELF_FORM_SITE_ID, adapter_version: SELF_FORM_ADAPTER_VERSION, target_url: work.target.target_url, posting_id: work.target.posting_id,
      expected: { company_name: work.job.company_name, title: work.job.title }, fill: fillFor(answers),
      artifact: { id: file.row.id, filename: file.row.filename, sha256: file.row.sha256, byte_size: file.row.byte_size },
    },
  };
}

function artifact(deps: ApplyDeps, request: ProductRequest, device: DeviceRow, applicationId: string): Reply {
  const app = getApplication(deps.db, device.workspace_id, applicationId);
  if (!app) return problem(request, 404, 'APPLICATION_NOT_FOUND', '지원 건을 찾을 수 없습니다.');
  // 현재 지원 revision에 고정한 파일만 내준다. 다른 revision·다른 파일은 요청할 수 없다.
  if (request.url.searchParams.get('revision') !== String(app.current_revision)) return problem(request, 409, 'APPLICATION_CHANGED', '지원 내용이 바뀌었습니다. 다시 준비해 주세요.');
  const revision = getAppRevision(deps.db, device.workspace_id, app.id, app.current_revision)!;
  const file = readVerifiedArtifact(deps.db, deps.store, device.workspace_id, revision.artifact_id);
  if ('error' in file || file.row.sha256 !== revision.artifact_sha256) return problem(request, 409, 'ARTIFACT_HASH_MISMATCH', '저장된 PDF가 지원 내용에 고정한 파일과 다릅니다.');
  return { status: 200, raw: { bytes: file.bytes, contentType: 'application/pdf' }, headers: { 'X-Content-SHA256': file.row.sha256 } };
}

function observe(deps: ApplyDeps, request: ProductRequest, device: DeviceRow, applicationId: string): Reply {
  const parsed = readJson(request, 256 * 1024);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== 'application_revision,document_id,payload_hash,readback,snapshot,target_url'
    || !Number.isInteger(body.application_revision) || typeof body.payload_hash !== 'string' || typeof body.target_url !== 'string' || typeof body.document_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.document_id)) {
    return problem(request, 400, 'INVALID_OBSERVATION', '관측 형식이 올바르지 않습니다.');
  }
  const snapshot = parseSnapshot(body.snapshot);
  const readback = body.readback === null ? null : parseReadback(body.readback);
  if (!snapshot || (body.readback !== null && !readback)) return problem(request, 400, 'INVALID_OBSERVATION', '폼 구조 또는 다시 읽은 값의 형식이 올바르지 않습니다.');
  const ws = device.workspace_id;
  const work = plan(deps, ws, applicationId);
  if (!work) return problem(request, 404, 'APPLICATION_NOT_FOUND', '지원 건을 찾을 수 없습니다.');
  if (work.app.current_revision !== body.application_revision || work.revision.payload_hash !== body.payload_hash) return problem(request, 409, 'APPLICATION_CHANGED', '지원 내용이 바뀌었습니다. 다시 준비해 주세요.');
  const issues: Issue[] = [];
  if (body.target_url !== work.target.target_url) issues.push({ code: 'TARGET_URL_MISMATCH', message: '이 공고의 지원 주소가 아닌 탭입니다.' });
  issues.push(...snapshotIssues(snapshot, { site_id: SELF_FORM_SITE_ID, adapter_version: SELF_FORM_ADAPTER_VERSION, posting_id: work.target.posting_id, company_name: work.job.company_name, title: work.job.title, questions: SELF_FORM_QUESTIONS }));
  if (readback) {
    const file = readVerifiedArtifact(deps.db, deps.store, ws, work.revision.artifact_id);
    if ('error' in file) return problem(request, 409, file.error, '저장된 PDF를 확인할 수 없습니다.');
    issues.push(...readbackIssues(readback, revisionAnswers(work.revision), SELF_FORM_QUESTIONS, { sha256: work.revision.artifact_sha256, byte_size: file.row.byte_size }));
  }
  const state = issues.length ? 'mismatch' : readback ? 'verified' : 'inspected';
  return transaction(deps.db, () => {
    const sent = deps.db.prepare("SELECT 1 FROM ce7_attempts WHERE workspace_id = ? AND application_id = ? AND state IN ('dispatched','submitted','submission_unknown')").get(ws, applicationId);
    if (sent) return problem(request, 409, 'APPLICATION_ALREADY_SENT', '이미 제출을 시작한 지원 건입니다.');
    const bindingId = ensureBinding(deps.db, device, SELF_FORM_SITE_ID, request.nowMs);
    const id = newId('observation');
    deps.db.prepare(`INSERT INTO ce8_form_observations (id, workspace_id, application_id, application_revision, payload_hash, device_id, account_binding_id, executor, site_id, adapter_version, target_url, document_id, form_snapshot_hash, snapshot_json, issues_json, readback_json, state, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ws, applicationId, work.revision.revision, work.revision.payload_hash, device.id, bindingId, device.executor, SELF_FORM_SITE_ID, SELF_FORM_ADAPTER_VERSION, String(body.target_url).slice(0, 2000), String(body.document_id),
        snapshotHash(snapshot), JSON.stringify(snapshot), JSON.stringify(issues), readback ? JSON.stringify(readback) : null, state, request.nowMs, request.nowMs);
    deps.db.prepare('UPDATE ce7_applications SET updated_at_ms = ? WHERE workspace_id = ? AND id = ?').run(request.nowMs, ws, applicationId);
    return { status: 201, body: observationBody(deps.db.prepare('SELECT * FROM ce8_form_observations WHERE id = ?').get(id) as ObservationRow) };
  });
}

function listPending(deps: ApplyDeps, device: DeviceRow): Reply {
  const items = pendingAttempts(deps.db, device).map(attempt => {
    const auth = getAuthorization(deps.db, device.workspace_id, attempt.authorization_id)!;
    const job = getJobSnapshot(deps.db, device.workspace_id, auth.job_snapshot_id)!;
    return { attempt_id: attempt.id, application_id: attempt.application_id, company_name: job.company_name, title: job.title, target_url: auth.target_url, authorization_expires_at: iso(auth.expires_at_ms), created_at: iso(attempt.created_at_ms) };
  });
  return { status: 200, body: { items } };
}

function failAttempt(db: DatabaseSync, request: ProductRequest, attempt: AttemptRow, code: string, message: string, issues: Issue[] = []): Reply {
  db.prepare("UPDATE ce7_attempts SET state = 'failed_before_dispatch', error_code = ?, updated_at_ms = ? WHERE workspace_id = ? AND id = ? AND state = 'prepared'").run(code, request.nowMs, attempt.workspace_id, attempt.id);
  return problem(request, 409, code, message, issues.length ? { issues } : undefined);
}

function ownedAttempt(deps: ApplyDeps, request: ProductRequest, device: DeviceRow, attemptId: string) {
  const attempt = getAttempt(deps.db, device.workspace_id, attemptId);
  if (!attempt) return problem(request, 404, 'ATTEMPT_NOT_FOUND', '지원 시도를 찾을 수 없습니다.');
  const auth = getAuthorization(deps.db, device.workspace_id, attempt.authorization_id)!;
  const binding = deps.db.prepare('SELECT account_fingerprint FROM ce7_account_bindings WHERE workspace_id = ? AND id = ?').get(device.workspace_id, auth.account_binding_id) as { account_fingerprint: string };
  if (binding.account_fingerprint !== bindingFingerprint(auth.site_id, device.id)) return problem(request, 403, 'EXECUTOR_NOT_BOUND', '이 기기에서 승인한 제출이 아닙니다.');
  return { attempt, auth };
}

function claim(deps: ApplyDeps, request: ProductRequest, device: DeviceRow, attemptId: string): Reply {
  return transaction(deps.db, () => {
    const owned = ownedAttempt(deps, request, device, attemptId);
    if ('status' in owned) return owned;
    const { attempt, auth } = owned;
    if (attempt.state !== 'prepared') return problem(request, 409, 'ATTEMPT_NOT_PREPARED', '이미 실행했거나 멈춘 시도입니다. 다시 제출하지 않습니다.', { state: attempt.state });
    const invalid = authorizationProblem(deps.db, auth, request.nowMs);
    if (invalid) return failAttempt(deps.db, request, attempt, invalid, authorizationMessage(invalid));
    const run = deps.db.prepare('SELECT dispatched_at_ms FROM ce8_attempt_runs WHERE attempt_id = ?').get(attempt.id) as { dispatched_at_ms: number | null } | undefined;
    if (run?.dispatched_at_ms) return problem(request, 409, 'ATTEMPT_NOT_PREPARED', '이미 전송을 시작한 시도입니다.');
    // 전송 전이면 다시 집을 수 있다(확장 재시작). 새 실행 토큰을 발급하고 이전 토큰은 더 쓰지 못한다.
    const token = randomBytes(32).toString('hex');
    if (run) deps.db.prepare('UPDATE ce8_attempt_runs SET device_id = ?, run_token_hash = ?, claimed_at_ms = ? WHERE attempt_id = ? AND dispatched_at_ms IS NULL').run(device.id, sha256Hex(token), request.nowMs, attempt.id);
    else deps.db.prepare('INSERT INTO ce8_attempt_runs (attempt_id, workspace_id, device_id, run_token_hash, claimed_at_ms) VALUES (?, ?, ?, ?, ?)').run(attempt.id, device.workspace_id, device.id, sha256Hex(token), request.nowMs);
    const revision = getAppRevision(deps.db, device.workspace_id, auth.application_id, auth.application_revision)!;
    const file = deps.db.prepare('SELECT filename, byte_size FROM ce7_artifacts WHERE workspace_id = ? AND id = ?').get(device.workspace_id, auth.artifact_id) as { filename: string; byte_size: number };
    return {
      status: 200,
      body: {
        run_token: token, attempt_id: attempt.id, application_id: auth.application_id, application_revision: auth.application_revision, payload_hash: auth.payload_hash,
        site_id: auth.site_id, adapter_version: auth.adapter_version, target_url: auth.target_url, form_snapshot_hash: auth.form_snapshot_hash,
        fill: fillFor(revisionAnswers(revision)), artifact: { id: auth.artifact_id, filename: file.filename, sha256: auth.artifact_sha256, byte_size: file.byte_size },
        authorization_expires_at: iso(auth.expires_at_ms),
      },
    };
  });
}

function runFor(db: DatabaseSync, device: DeviceRow, attemptId: string, token: unknown) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return undefined;
  return db.prepare('SELECT * FROM ce8_attempt_runs WHERE attempt_id = ? AND workspace_id = ? AND device_id = ? AND run_token_hash = ?').get(attemptId, device.workspace_id, device.id, sha256Hex(token)) as
    { attempt_id: string; dispatched_at_ms: number | null; reported_at_ms: number | null } | undefined;
}

// 전송 직전 검증: 권한·대상 주소·폼 snapshot hash·다시 읽은 값·실제 파일 hash가 모두 맞을 때만 dispatched로 바꾼다.
// dispatched는 브라우저에 제출을 지시하기 직전의 경계다. 이후 끊기면 외부 효과가 없었다고 단정하지 않는다.
function dispatch(deps: ApplyDeps, request: ProductRequest, device: DeviceRow, attemptId: string): Reply {
  const parsed = readJson(request, 256 * 1024);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== 'document_id,readback,run_token,snapshot,target_url') return problem(request, 400, 'INVALID_DISPATCH', '전송 요청 형식이 올바르지 않습니다.');
  return transaction(deps.db, () => {
    const run = runFor(deps.db, device, attemptId, body.run_token);
    if (!run) return problem(request, 409, 'RUN_TOKEN_INVALID', '이 실행의 토큰이 아닙니다(다른 실행이 시도를 다시 집었습니다). 제출하지 않았습니다.');
    const owned = ownedAttempt(deps, request, device, attemptId);
    if ('status' in owned) return owned;
    const { attempt, auth } = owned;
    if (attempt.state === 'dispatched' && run.dispatched_at_ms) return { status: 200, body: { submission_key: attempt.id, dispatched_at: iso(run.dispatched_at_ms), replay: true } };
    if (attempt.state !== 'prepared') return problem(request, 409, 'ATTEMPT_NOT_PREPARED', '이미 실행했거나 멈춘 시도입니다.', { state: attempt.state });
    const invalid = authorizationProblem(deps.db, auth, request.nowMs);
    if (invalid) return failAttempt(deps.db, request, attempt, invalid, authorizationMessage(invalid));
    if (body.target_url !== auth.target_url) return failAttempt(deps.db, request, attempt, 'TARGET_CHANGED', '승인한 지원 주소가 아닌 탭입니다. 제출하지 않았습니다.');
    const snapshot = parseSnapshot(body.snapshot);
    const job = getJobSnapshot(deps.db, device.workspace_id, auth.job_snapshot_id)!;
    const target = selfFormTarget(job)!;
    const formIssues = snapshot ? snapshotIssues(snapshot, { site_id: auth.site_id, adapter_version: auth.adapter_version, posting_id: target.posting_id, company_name: job.company_name, title: job.title, questions: SELF_FORM_QUESTIONS }) : [];
    if (!snapshot || snapshotHash(snapshot) !== auth.form_snapshot_hash || formIssues.length) return failAttempt(deps.db, request, attempt, 'FORM_CHANGED', '승인한 뒤 지원 폼이 바뀌었습니다. 제출하지 않았습니다. 다시 확인해 주세요.', formIssues);
    const readback = parseReadback(body.readback);
    const file = readVerifiedArtifact(deps.db, deps.store, device.workspace_id, auth.artifact_id);
    if ('error' in file || file.row.sha256 !== auth.artifact_sha256) return failAttempt(deps.db, request, attempt, 'ARTIFACT_HASH_MISMATCH', '저장된 PDF가 승인한 파일과 다릅니다. 제출하지 않았습니다.');
    const revision = getAppRevision(deps.db, device.workspace_id, auth.application_id, auth.application_revision)!;
    const valueIssues = readback ? readbackIssues(readback, revisionAnswers(revision), SELF_FORM_QUESTIONS, { sha256: auth.artifact_sha256, byte_size: file.row.byte_size }) : [{ code: 'READBACK_INVALID', message: '다시 읽은 값의 형식이 올바르지 않습니다.' }];
    if (valueIssues.length) return failAttempt(deps.db, request, attempt, 'READBACK_MISMATCH', '폼에 들어간 값·파일이 승인한 내용과 다릅니다. 제출하지 않았습니다.', valueIssues);
    const now = request.nowMs;
    deps.db.prepare("UPDATE ce7_attempts SET state = 'dispatched', dispatch_started_at_ms = ?, updated_at_ms = ? WHERE workspace_id = ? AND id = ? AND state = 'prepared'").run(now, now, device.workspace_id, attempt.id);
    deps.db.prepare('UPDATE ce8_attempt_runs SET dispatched_at_ms = ?, report_json = NULL WHERE attempt_id = ?').run(now, attempt.id);
    return { status: 200, body: { submission_key: attempt.id, dispatched_at: iso(now), replay: false } };
  });
}

const OUTCOMES = ['confirmation', 'form_error', 'no_confirmation', 'not_started'];

// 실행기의 결과 보고. 자체 폼은 사이트 저장소와 대조해 확정한다. 근거가 없으면 접수 불명으로 남긴다(자동 재제출 없음).
function result(deps: ApplyDeps, request: ProductRequest, device: DeviceRow, attemptId: string): Reply {
  const parsed = readJson(request, 64 * 1024);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  const observed = isPlainObject(body) ? body.observed : null;
  const observedOk = observed === null || (isPlainObject(observed) && Object.keys(observed).sort().join() === 'page_url,posting_id,receipt_number,submission_key' && Object.values(observed).every(value => typeof value === 'string' && value.length <= 2000));
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== 'detail,observed,outcome,run_token' || !OUTCOMES.includes(String(body.outcome)) || !observedOk || typeof body.detail !== 'string' || body.detail.length > 200
    || (body.outcome === 'confirmation' && observed === null)) {
    return problem(request, 400, 'INVALID_RESULT', '결과 보고 형식이 올바르지 않습니다.');
  }
  return transaction(deps.db, () => {
    const run = runFor(deps.db, device, attemptId, body.run_token);
    if (!run || !run.dispatched_at_ms) return problem(request, 409, 'RUN_TOKEN_INVALID', '전송을 시작한 실행의 토큰이 아닙니다.');
    const attempt = getAttempt(deps.db, device.workspace_id, attemptId)!;
    if (run.reported_at_ms) return { status: 200, body: attemptBody(deps.db, attempt) };
    const now = request.nowMs;
    deps.db.prepare('UPDATE ce8_attempt_runs SET reported_at_ms = ?, report_json = ? WHERE attempt_id = ?').run(now, JSON.stringify({ outcome: body.outcome, observed, detail: body.detail }), attemptId);
    if (attempt.state !== 'dispatched' && attempt.state !== 'submission_unknown') return { status: 200, body: attemptBody(deps.db, attempt) };
    const auth = getAuthorization(deps.db, device.workspace_id, attempt.authorization_id)!;
    const strong = hasReconciler(auth.site_id);
    if (body.outcome === 'confirmation') recordConfirmationPage(deps.db, attempt, observed as { receipt_number: string; posting_id: string; submission_key: string; page_url: string }, now);
    if (strong) reconcileSelfForm(deps.db, device.workspace_id, attemptId, { seal: body.outcome !== 'no_confirmation', nowMs: now });
    else {
      // 사이트 저장소 대조가 없는 사이트: 이 시도의 접수 키가 보이는 완료 화면만 접수 근거로 쓴다.
      const confirmed = body.outcome === 'confirmation' && (observed as { submission_key: string }).submission_key === attempt.id;
      setAttemptState(deps.db, attempt, confirmed ? 'submitted' : 'submission_unknown', confirmed ? null : 'RECEIPT_NOT_OBSERVED', now);
    }
    return { status: 200, body: attemptBody(deps.db, getAttempt(deps.db, device.workspace_id, attemptId)!) };
  });
}

type Route = { method: string; pattern: RegExp; handle: (deps: ApplyDeps, request: ProductRequest, device: DeviceRow, id: string) => Reply };
const routes: Route[] = [
  { method: 'GET', pattern: new RegExp(`^${PREFIX}/session$`), handle: (_deps, _request, device) => ({ status: 200, body: { device_id: device.id, executor: device.executor, label: device.label } }) },
  { method: 'GET', pattern: new RegExp(`^${PREFIX}/applications$`), handle: (deps, _request, device) => listWork(deps, device) },
  { method: 'GET', pattern: new RegExp(`^${PREFIX}/applications/${ID}/prepare$`), handle: prepare },
  { method: 'GET', pattern: new RegExp(`^${PREFIX}/applications/${ID}/artifact$`), handle: artifact },
  { method: 'POST', pattern: new RegExp(`^${PREFIX}/applications/${ID}/observations$`), handle: observe },
  { method: 'GET', pattern: new RegExp(`^${PREFIX}/attempts$`), handle: (deps, _request, device) => listPending(deps, device) },
  { method: 'POST', pattern: new RegExp(`^${PREFIX}/attempts/${ID}/claim$`), handle: claim },
  { method: 'POST', pattern: new RegExp(`^${PREFIX}/attempts/${ID}/dispatch$`), handle: dispatch },
  { method: 'POST', pattern: new RegExp(`^${PREFIX}/attempts/${ID}/result$`), handle: result },
];

export function routeExecutorRequest(deps: ApplyDeps, request: ProductRequest): Reply | null {
  const path = request.url.pathname;
  if (!path.startsWith(`${PREFIX}/`)) return null;
  if (request.method === 'POST' && path === `${PREFIX}/pair`) return pair(deps, request);
  for (const route of routes) {
    if (route.method !== request.method) continue;
    const match = route.pattern.exec(path);
    if (!match) continue;
    const device = authenticateDevice(deps, request);
    if ('status' in device) return device;
    return route.handle(deps, request, device, match[1] ?? '');
  }
  return problem(request, 404, 'NOT_FOUND', '없는 실행기 경로입니다.');
}
