import type { DatabaseSync } from 'node:sqlite';
import { answerIssues, canonicalJson, sha256 } from '../../../../packages/apply/src/payload.ts';
import { SELF_FORM_QUESTIONS } from '../../../../packages/apply/src/self-form.ts';
import { isPlainObject, newId, problem, readJson, sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import { idempotentWrite, readIdempotencyKey } from '../idempotency.ts';
import { getTask, taskBody } from '../resume/repository.ts';
import { getJobSnapshot } from '../search/repository.ts';
import type { ApplyDeps } from './applications.ts';
import {
  attemptBody, authorizationBody, closeExpiredPrepared, evidenceBody, freshObservation, getApplication, getAppRevision, getAttempt, getAuthorization, getEvidence, readVerifiedArtifact, revisionAnswers,
} from './repository.ts';
import type { ApplicationRow, AuthorizationRow } from './repository.ts';

// 수동 제출 권한과 실행 시도. 권한은 회사·공고·지원 revision·이력서 revision·실제 파일 hash·전체 답변 hash·
// 대상 주소·계정 binding·adapter 버전·폼 snapshot hash·만료에 묶인다. 바뀌거나 만료된 권한으로는 시도를 만들지 않는다.

const TARGET_KEYS = 'account_binding_id,adapter_version,executor,form_snapshot_hash,site_id,target_url';
const HASH = /^[a-f0-9]{64}$/;

// 지원 건이 지금 새 권한·시도를 받을 수 있는지(중복 접수·외부 기록·마감·파일 변경). 문제가 있으면 Reply.
function blockingProblem(deps: ApplyDeps, request: ProductRequest, app: ApplicationRow): Reply | null {
  const { db } = deps;
  const ws = app.workspace_id;
  closeExpiredPrepared(db, request.nowMs, ws);
  const active = db.prepare("SELECT state FROM ce7_attempts WHERE workspace_id = ? AND application_id = ? AND state IN ('prepared','dispatched','submitted','submission_unknown') LIMIT 1").get(ws, app.id) as { state: string } | undefined;
  if (active?.state === 'submitted') return problem(request, 409, 'APPLICATION_ALREADY_SUBMITTED', '이미 접수가 확인된 지원 건입니다.');
  if (active?.state === 'submission_unknown') return problem(request, 409, 'SUBMISSION_UNKNOWN', '이전 제출의 접수 여부를 아직 모릅니다. 다시 제출하지 말고 접수 결과 확인을 먼저 진행하세요.');
  if (active) return problem(request, 409, 'SUBMISSION_IN_PROGRESS', '이 지원 건의 제출이 이미 진행 중입니다.');
  const external = db.prepare('SELECT id FROM ce8_external_applications WHERE workspace_id = ? AND job_key = ?').get(ws, app.job_key) as { id: string } | undefined;
  if (external) return problem(request, 409, 'EXTERNAL_APPLICATION_EXISTS', '이 공고는 다른 경로로 이미 지원했다고 기록되어 있습니다.', { external_application_id: external.id });
  const revision = getAppRevision(db, ws, app.id, app.current_revision)!;
  const job = getJobSnapshot(db, ws, revision.job_snapshot_id)!;
  if (job.open_status === 'closed') return problem(request, 409, 'JOB_CLOSED', '마감된 공고입니다.');
  const file = readVerifiedArtifact(db, deps.store, ws, revision.artifact_id);
  if ('error' in file || file.row.sha256 !== revision.artifact_sha256) return problem(request, 409, 'ARTIFACT_HASH_MISMATCH', '저장된 PDF가 지원 내용에 고정한 파일과 다릅니다. PDF를 다시 만들고 지원 내용을 갱신해 주세요.');
  return null;
}

function executorRevoked(db: DatabaseSync, ws: string, bindingId: string): boolean {
  const binding = db.prepare('SELECT revoked_at_ms FROM ce7_account_bindings WHERE workspace_id = ? AND id = ?').get(ws, bindingId) as { revoked_at_ms: number | null } | undefined;
  return !binding || binding.revoked_at_ms !== null;
}

export function createManualAuthorization(deps: ApplyDeps, request: ProductRequest, principal: Principal, applicationId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  const target = isPlainObject(body) ? body.target : null;
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== 'expected_application_revision,expected_payload_hash,reviewed,target' || body.reviewed !== true
    || !Number.isInteger(body.expected_application_revision) || typeof body.expected_payload_hash !== 'string' || !HASH.test(body.expected_payload_hash)
    || !isPlainObject(target) || Object.keys(target).sort().join() !== TARGET_KEYS || Object.values(target).some(value => typeof value !== 'string')) {
    return problem(request, 400, 'INVALID_AUTHORIZATION', '확인한 지원 revision·payload hash·대상·reviewed=true가 필요합니다.');
  }
  const ws = principal.workspaceId;
  if (!getApplication(deps.db, ws, applicationId)) return problem(request, 404, 'APPLICATION_NOT_FOUND', '지원 건을 찾을 수 없습니다.');
  return idempotentWrite(deps.db, request, ws, `createManualAuthorization:${applicationId}`, key.key, sha256(canonicalJson(body)), () => {
    const app = getApplication(deps.db, ws, applicationId)!;
    if (app.current_revision !== body.expected_application_revision) return problem(request, 409, 'APPLICATION_REVISION_CONFLICT', '확인한 뒤 지원 내용이 바뀌었습니다. 바뀐 내용을 다시 확인해 주세요.');
    const revision = getAppRevision(deps.db, ws, app.id, app.current_revision)!;
    if (revision.payload_hash !== body.expected_payload_hash) return problem(request, 409, 'PAYLOAD_CHANGED', '확인한 파일·답변이 현재 지원 내용과 다릅니다.');
    const issues = answerIssues(revisionAnswers(revision), SELF_FORM_QUESTIONS);
    if (issues.length) return problem(request, 422, 'ANSWERS_INCOMPLETE', issues[0].message, { issues });
    const blocked = blockingProblem(deps, request, app);
    if (blocked) return blocked;
    // 실제 폼에서 입력·첨부를 다시 읽어 검증한 최근 관측이 있어야 하고, 확인한 대상과 정확히 같아야 한다.
    const observation = freshObservation(deps.db, app);
    if (!observation || observation.state !== 'verified' || observation.payload_hash !== revision.payload_hash) return problem(request, 409, 'FORM_NOT_VERIFIED', 'Chrome 확장으로 지원 폼에 입력·첨부한 결과를 먼저 확인해야 합니다.');
    if (request.nowMs - observation.updated_at_ms > deps.config.limits.observationMaxAgeMs) return problem(request, 409, 'FORM_OBSERVATION_STALE', '폼을 확인한 지 오래되었습니다. 확장에서 폼을 다시 확인해 주세요.');
    const t = target as Record<string, string>;
    if (t.executor !== observation.executor || t.site_id !== observation.site_id || t.adapter_version !== observation.adapter_version || t.account_binding_id !== observation.account_binding_id
      || t.target_url !== observation.target_url || t.form_snapshot_hash !== observation.form_snapshot_hash) return problem(request, 409, 'TARGET_MISMATCH', '확인한 지원 대상이 최근 폼 확인 결과와 다릅니다. 화면을 새로 불러와 다시 확인해 주세요.');
    const device = deps.db.prepare('SELECT revoked_at_ms FROM ce8_executor_devices WHERE workspace_id = ? AND id = ?').get(ws, observation.device_id) as { revoked_at_ms: number | null } | undefined;
    if (!device || device.revoked_at_ms !== null || executorRevoked(deps.db, ws, observation.account_binding_id)) return problem(request, 409, 'EXECUTOR_REVOKED', '연결이 해제된 실행기입니다. 확장을 다시 연결해 주세요.');
    const now = request.nowMs;
    // 새 권한을 만들면 같은 지원 건의 아직 쓰지 않은 이전 권한은 더 쓰지 않는다.
    deps.db.prepare('UPDATE ce7_authorizations SET revoked_at_ms = ? WHERE workspace_id = ? AND application_id = ? AND revoked_at_ms IS NULL AND id NOT IN (SELECT authorization_id FROM ce7_attempts WHERE workspace_id = ?)').run(now, ws, app.id, ws);
    const id = newId('authorization');
    deps.db.prepare(`INSERT INTO ce7_authorizations (id, workspace_id, application_id, application_revision, kind, job_snapshot_id, resume_revision_id, artifact_id, artifact_sha256, payload_hash, executor, site_id, adapter_version, account_binding_id, target_url, form_snapshot_hash, user_reviewed_at_ms, created_at_ms, expires_at_ms)
      VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ws, app.id, revision.revision, revision.job_snapshot_id, revision.resume_revision_id, revision.artifact_id, revision.artifact_sha256, revision.payload_hash,
        observation.executor, observation.site_id, observation.adapter_version, observation.account_binding_id, observation.target_url, observation.form_snapshot_hash, now, now, now + deps.config.limits.authorizationTtlMs);
    return { status: 201, body: authorizationBody(getAuthorization(deps.db, ws, id)!) };
  });
}

// 권한이 지금도 유효한지(철회·만료·지원 내용 변경·실행기 해제). 문제가 있으면 오류 코드.
export function authorizationProblem(db: DatabaseSync, auth: AuthorizationRow, nowMs: number): string | null {
  if (auth.revoked_at_ms !== null) return 'AUTHORIZATION_REVOKED';
  if (auth.expires_at_ms <= nowMs) return 'AUTHORIZATION_EXPIRED';
  const app = getApplication(db, auth.workspace_id, auth.application_id)!;
  const revision = getAppRevision(db, auth.workspace_id, app.id, app.current_revision)!;
  if (app.current_revision !== auth.application_revision || revision.payload_hash !== auth.payload_hash) return 'APPLICATION_CHANGED';
  if (executorRevoked(db, auth.workspace_id, auth.account_binding_id)) return 'EXECUTOR_REVOKED';
  return null;
}

const AUTH_MESSAGES: Record<string, string> = {
  AUTHORIZATION_REVOKED: '더 이상 쓸 수 없는 제출 권한입니다. 최종 확인을 다시 해 주세요.',
  AUTHORIZATION_EXPIRED: '제출 권한이 만료되었습니다. 최종 확인을 다시 해 주세요.',
  APPLICATION_CHANGED: '권한을 만든 뒤 지원 내용이 바뀌었습니다. 바뀐 내용을 다시 확인해 주세요.',
  EXECUTOR_REVOKED: '연결이 해제된 실행기입니다. 확장을 다시 연결해 주세요.',
};
export const authorizationMessage = (code: string) => AUTH_MESSAGES[code] ?? '제출 권한을 사용할 수 없습니다.';

export function createSubmissionAttempt(deps: ApplyDeps, request: ProductRequest, principal: Principal, applicationId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).join() !== 'authorization_id' || typeof body.authorization_id !== 'string') return problem(request, 400, 'INVALID_ATTEMPT', 'authorization_id가 필요합니다.');
  const ws = principal.workspaceId;
  if (!getApplication(deps.db, ws, applicationId)) return problem(request, 404, 'APPLICATION_NOT_FOUND', '지원 건을 찾을 수 없습니다.');
  return idempotentWrite(deps.db, request, ws, `createSubmissionAttempt:${applicationId}`, key.key, sha256(canonicalJson(body)), () => {
    const auth = getAuthorization(deps.db, ws, String(body.authorization_id));
    // 다른 지원 건(다른 공고)의 권한은 재사용할 수 없다.
    if (!auth || auth.application_id !== applicationId) return problem(request, 404, 'AUTHORIZATION_NOT_FOUND', '이 지원 건의 제출 권한을 찾을 수 없습니다.');
    if (deps.db.prepare('SELECT 1 FROM ce7_attempts WHERE workspace_id = ? AND authorization_id = ?').get(ws, auth.id)) return problem(request, 409, 'AUTHORIZATION_USED', '이미 사용한 제출 권한입니다.');
    const invalid = authorizationProblem(deps.db, auth, request.nowMs);
    if (invalid) return problem(request, 409, invalid, authorizationMessage(invalid));
    const app = getApplication(deps.db, ws, applicationId)!;
    const blocked = blockingProblem(deps, request, app);
    if (blocked) return blocked;
    const id = newId('attempt');
    const now = request.nowMs;
    deps.db.prepare("INSERT INTO ce7_attempts (id, workspace_id, application_id, authorization_id, executor, state, dispatch_started_at_ms, error_code, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, 'prepared', NULL, NULL, ?, ?)")
      .run(id, ws, applicationId, auth.id, auth.executor, now, now);
    deps.db.prepare('UPDATE ce7_applications SET updated_at_ms = ? WHERE workspace_id = ? AND id = ?').run(now, ws, applicationId);
    return { status: 201, body: attemptBody(deps.db, getAttempt(deps.db, ws, id)!) };
  });
}

export function getSubmissionAttempt(deps: ApplyDeps, request: ProductRequest, principal: Principal, attemptId: string): Reply {
  const attempt = getAttempt(deps.db, principal.workspaceId, attemptId);
  return attempt ? { status: 200, body: attemptBody(deps.db, attempt) } : problem(request, 404, 'ATTEMPT_NOT_FOUND', '지원 시도를 찾을 수 없습니다.');
}

export function getSubmissionEvidence(deps: ApplyDeps, request: ProductRequest, principal: Principal, evidenceId: string): Reply {
  const evidence = getEvidence(deps.db, principal.workspaceId, evidenceId);
  return evidence ? { status: 200, body: evidenceBody(evidence) } : problem(request, 404, 'EVIDENCE_NOT_FOUND', '접수 근거를 찾을 수 없습니다.');
}

// 접수 결과 재확인: 조회 작업만 예약한다. 다시 제출하지 않는다.
export function observeSubmissionAttempt(deps: ApplyDeps, request: ProductRequest, principal: Principal, attemptId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const ws = principal.workspaceId;
  if (!getAttempt(deps.db, ws, attemptId)) return problem(request, 404, 'ATTEMPT_NOT_FOUND', '지원 시도를 찾을 수 없습니다.');
  return idempotentWrite(deps.db, request, ws, `observeSubmissionAttempt:${attemptId}`, key.key, sha256Hex(attemptId), () => {
    const attempt = getAttempt(deps.db, ws, attemptId)!;
    if (attempt.state !== 'dispatched' && attempt.state !== 'submission_unknown') return problem(request, 409, 'OBSERVATION_NOT_NEEDED', '전송했지만 결과를 모르는 시도만 접수 결과를 확인합니다.');
    // 막 전송한 시도는 실행기가 결과를 볼 시간을 준다(자체 폼은 확인 시 접수 키를 닫으므로 전송 중인 제출을 끊을 수 있다).
    if (attempt.state === 'dispatched' && request.nowMs - (attempt.dispatch_started_at_ms ?? 0) < deps.config.limits.observeMinDispatchAgeMs) return problem(request, 409, 'OBSERVATION_TOO_EARLY', '방금 전송한 제출입니다. 1분 뒤에도 결과가 없으면 다시 확인해 주세요.');
    const running = deps.db.prepare("SELECT * FROM ce7_tasks WHERE workspace_id = ? AND kind = 'submit_application' AND state IN ('queued','running') AND json_extract(input_json, '$.attempt_id') = ? LIMIT 1").get(ws, attemptId);
    if (running) return { status: 202, body: { task: taskBody(running as never), resource_id: attemptId } };
    const now = request.nowMs;
    const taskId = newId('task');
    const inputJson = JSON.stringify({ action: 'observe', attempt_id: attemptId });
    deps.db.prepare(`INSERT INTO ce7_tasks (id, workspace_id, kind, state, input_json, input_hash, result_json, error_code, cancel_requested, provider_transmission, lease_owner, lease_generation, lease_until_ms, available_at_ms, created_at_ms, updated_at_ms)
      VALUES (?, ?, 'submit_application', 'queued', ?, ?, NULL, NULL, 0, 'not_dispatched', NULL, 0, NULL, ?, ?, ?)`).run(taskId, ws, inputJson, sha256Hex(inputJson), now, now, now);
    return { status: 202, body: { task: taskBody(getTask(deps.db, ws, taskId)!), resource_id: attemptId } };
  });
}
