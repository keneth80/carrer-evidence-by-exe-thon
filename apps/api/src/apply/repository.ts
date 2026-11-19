import type { DatabaseSync } from 'node:sqlite';
import { iso, sha256Hex } from '../http.ts';
import type { ObjectStore } from '../resume/storage.ts';
import type { ArtifactRow } from '../tailor/repository.ts';
import type { Answer } from '../../../../packages/apply/src/types.ts';

// 지원 건·제출 revision·권한·시도·접수 근거 조회와 응답 본문. 모든 조회는 인증된 workspace_id로 제한한다.

export type ApplicationRow = { id: string; workspace_id: string; job_key: string; current_revision: number; source_kind: string; created_at_ms: number; updated_at_ms: number };
export type AppRevisionRow = {
  workspace_id: string; application_id: string; revision: number; job_snapshot_id: string; resume_revision_id: string;
  artifact_id: string; artifact_sha256: string; answers_json: string; payload_hash: string; created_at_ms: number;
};
export type AuthorizationRow = {
  id: string; workspace_id: string; application_id: string; application_revision: number; kind: string; job_snapshot_id: string; resume_revision_id: string;
  artifact_id: string; artifact_sha256: string; payload_hash: string; executor: 'chrome' | 'ego'; site_id: string; adapter_version: string; account_binding_id: string;
  target_url: string; form_snapshot_hash: string; user_reviewed_at_ms: number | null; created_at_ms: number; expires_at_ms: number; revoked_at_ms: number | null;
};
export type AttemptState = 'prepared' | 'dispatched' | 'submitted' | 'submission_unknown' | 'not_submitted' | 'failed_before_dispatch';
export type AttemptRow = { id: string; workspace_id: string; application_id: string; authorization_id: string; executor: 'chrome' | 'ego'; state: AttemptState; dispatch_started_at_ms: number | null; error_code: string | null; created_at_ms: number; updated_at_ms: number };
export type EvidenceRow = { id: string; workspace_id: string; attempt_id: string; kind: string; conclusion: string; summary: string; evidence_hash: string; observed_at_ms: number; source_url: string | null };
export type ObservationRow = {
  id: string; workspace_id: string; application_id: string; application_revision: number; payload_hash: string; device_id: string; account_binding_id: string;
  executor: 'chrome' | 'ego'; site_id: string; adapter_version: string; target_url: string; document_id: string; form_snapshot_hash: string;
  snapshot_json: string; issues_json: string; readback_json: string | null; state: 'inspected' | 'verified' | 'mismatch'; created_at_ms: number; updated_at_ms: number;
};

export const ACTIVE_ATTEMPT_STATES: AttemptState[] = ['prepared', 'dispatched', 'submitted', 'submission_unknown'];

export const getApplication = (db: DatabaseSync, ws: string, id: string) =>
  db.prepare('SELECT * FROM ce7_applications WHERE workspace_id = ? AND id = ?').get(ws, id) as ApplicationRow | undefined;
export const getAppRevision = (db: DatabaseSync, ws: string, applicationId: string, revision: number) =>
  db.prepare('SELECT * FROM ce7_application_revisions WHERE workspace_id = ? AND application_id = ? AND revision = ?').get(ws, applicationId, revision) as AppRevisionRow | undefined;
export const listAppRevisions = (db: DatabaseSync, ws: string, applicationId: string) =>
  db.prepare('SELECT * FROM ce7_application_revisions WHERE workspace_id = ? AND application_id = ? ORDER BY revision').all(ws, applicationId) as AppRevisionRow[];
export const getAuthorization = (db: DatabaseSync, ws: string, id: string) =>
  db.prepare('SELECT * FROM ce7_authorizations WHERE workspace_id = ? AND id = ?').get(ws, id) as AuthorizationRow | undefined;
export const listAuthorizations = (db: DatabaseSync, ws: string, applicationId: string) =>
  db.prepare('SELECT * FROM ce7_authorizations WHERE workspace_id = ? AND application_id = ? ORDER BY created_at_ms, rowid').all(ws, applicationId) as AuthorizationRow[];
export const getAttempt = (db: DatabaseSync, ws: string, id: string) =>
  db.prepare('SELECT * FROM ce7_attempts WHERE workspace_id = ? AND id = ?').get(ws, id) as AttemptRow | undefined;
export const listAttempts = (db: DatabaseSync, ws: string, applicationId: string) =>
  db.prepare('SELECT * FROM ce7_attempts WHERE workspace_id = ? AND application_id = ? ORDER BY created_at_ms, rowid').all(ws, applicationId) as AttemptRow[];
export const listEvidence = (db: DatabaseSync, ws: string, attemptId: string) =>
  db.prepare('SELECT * FROM ce7_submission_evidence WHERE workspace_id = ? AND attempt_id = ? ORDER BY observed_at_ms, rowid').all(ws, attemptId) as EvidenceRow[];
export const getEvidence = (db: DatabaseSync, ws: string, id: string) =>
  db.prepare('SELECT * FROM ce7_submission_evidence WHERE workspace_id = ? AND id = ?').get(ws, id) as EvidenceRow | undefined;
export const latestObservation = (db: DatabaseSync, ws: string, applicationId: string, revision: number) =>
  db.prepare('SELECT * FROM ce8_form_observations WHERE workspace_id = ? AND application_id = ? AND application_revision = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 1').get(ws, applicationId, revision) as ObservationRow | undefined;

export const revisionAnswers = (row: AppRevisionRow) => JSON.parse(row.answers_json) as Answer[];

export function appRevisionBody(row: AppRevisionRow) {
  return {
    application_id: row.application_id, revision: row.revision, job_snapshot_id: row.job_snapshot_id, resume_revision_id: row.resume_revision_id,
    artifact_id: row.artifact_id, artifact_sha256: row.artifact_sha256, answers: revisionAnswers(row), payload_hash: row.payload_hash, created_at: iso(row.created_at_ms),
  };
}

export function authorizationBody(row: AuthorizationRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, application_id: row.application_id, application_revision: row.application_revision,
    job_snapshot_id: row.job_snapshot_id, resume_revision_id: row.resume_revision_id, artifact_id: row.artifact_id, artifact_sha256: row.artifact_sha256, payload_hash: row.payload_hash,
    target: { executor: row.executor, site_id: row.site_id, adapter_version: row.adapter_version, account_binding_id: row.account_binding_id, target_url: row.target_url, form_snapshot_hash: row.form_snapshot_hash },
    expires_at: iso(row.expires_at_ms), created_at: iso(row.created_at_ms), kind: 'manual' as const, user_reviewed_at: iso(row.user_reviewed_at_ms ?? row.created_at_ms),
  };
}

export function attemptBody(db: DatabaseSync, row: AttemptRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, application_id: row.application_id, authorization_id: row.authorization_id, executor: row.executor, state: row.state,
    dispatch_started_at: row.dispatch_started_at_ms === null ? null : iso(row.dispatch_started_at_ms),
    evidence_ids: listEvidence(db, row.workspace_id, row.id).map(item => item.id), error_code: row.error_code,
    created_at: iso(row.created_at_ms), updated_at: iso(row.updated_at_ms),
  };
}

export function evidenceBody(row: EvidenceRow) {
  return { id: row.id, workspace_id: row.workspace_id, attempt_id: row.attempt_id, kind: row.kind, conclusion: row.conclusion, summary: row.summary, evidence_hash: row.evidence_hash, observed_at: iso(row.observed_at_ms), source_url: row.source_url };
}

export function observationBody(row: ObservationRow) {
  return {
    id: row.id, application_id: row.application_id, application_revision: row.application_revision, payload_hash: row.payload_hash, state: row.state,
    issues: JSON.parse(row.issues_json) as { code: string; message: string }[],
    target: { executor: row.executor, site_id: row.site_id, adapter_version: row.adapter_version, account_binding_id: row.account_binding_id, target_url: row.target_url, form_snapshot_hash: row.form_snapshot_hash },
    document_id: row.document_id, readback: row.readback_json ? JSON.parse(row.readback_json) as unknown : null, created_at: iso(row.created_at_ms),
  };
}

// 전송 상태(submission_state)는 시도·관측 기록에서 계산한다. 채용 진행 상태와 섞지 않는다.
export function submissionState(db: DatabaseSync, app: ApplicationRow): string {
  const last = db.prepare('SELECT state, updated_at_ms FROM ce7_attempts WHERE workspace_id = ? AND application_id = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 1').get(app.workspace_id, app.id) as { state: AttemptState; updated_at_ms: number } | undefined;
  if (last?.state === 'submitted') return 'submitted';
  if (last?.state === 'submission_unknown') return 'submission_unknown';
  if (last?.state === 'dispatched') return 'running';
  if (last?.state === 'prepared') return 'queued';
  // 끝난 시도(미접수·전송 전 중단) 뒤에는 그 뒤에 새로 한 폼 확인만 인정한다. 사용자는 다시 확인·승인해 진행할 수 있다.
  const observation = freshObservation(db, app);
  if (observation?.state === 'verified') return 'prepared';
  if (observation?.state === 'mismatch') return 'waiting_user';
  if (last?.state === 'not_submitted') return 'not_submitted';
  return last ? 'waiting_user' : 'draft';
}

// 현재 revision의 최근 폼 관측 중, 마지막으로 끝난 시도(미접수·전송 전 중단)보다 나중의 것. 실패 전 관측으로 다시 승인하지 않게 한다.
export function freshObservation(db: DatabaseSync, app: ApplicationRow): ObservationRow | undefined {
  const closed = db.prepare("SELECT max(updated_at_ms) AS at FROM ce7_attempts WHERE workspace_id = ? AND application_id = ? AND state IN ('not_submitted','failed_before_dispatch')").get(app.workspace_id, app.id) as { at: number | null };
  const observation = latestObservation(db, app.workspace_id, app.id, app.current_revision);
  return observation && (closed.at === null || observation.updated_at_ms > closed.at) ? observation : undefined;
}

// 승인이 만료·철회되었거나 지원 내용이 바뀐 대기 시도(prepared)를 전송 전 중단으로 닫는다. 아무것도 보내지 않은 시도다.
export function closeExpiredPrepared(db: DatabaseSync, nowMs: number, workspaceId?: string): number {
  const rows = db.prepare(`SELECT a.id, a.workspace_id, CASE WHEN z.revoked_at_ms IS NOT NULL THEN 'AUTHORIZATION_REVOKED' WHEN z.expires_at_ms <= ? THEN 'AUTHORIZATION_EXPIRED' ELSE 'APPLICATION_CHANGED' END AS code
    FROM ce7_attempts a JOIN ce7_authorizations z ON z.workspace_id = a.workspace_id AND z.id = a.authorization_id JOIN ce7_applications p ON p.workspace_id = a.workspace_id AND p.id = a.application_id
    WHERE a.state = 'prepared' AND (? IS NULL OR a.workspace_id = ?) AND (z.revoked_at_ms IS NOT NULL OR z.expires_at_ms <= ? OR p.current_revision <> z.application_revision)`).all(nowMs, workspaceId ?? null, workspaceId ?? null, nowMs) as { id: string; workspace_id: string; code: string }[];
  for (const row of rows) db.prepare("UPDATE ce7_attempts SET state = 'failed_before_dispatch', error_code = ?, updated_at_ms = ? WHERE workspace_id = ? AND id = ? AND state = 'prepared'").run(row.code, nowMs, row.workspace_id, row.id);
  return rows.length;
}

export function recruitmentStage(db: DatabaseSync, ws: string, applicationId: string): string {
  const row = db.prepare('SELECT stage FROM ce7_recruitment_events WHERE workspace_id = ? AND application_id = ? ORDER BY observed_at_ms DESC, rowid DESC LIMIT 1').get(ws, applicationId) as { stage: string } | undefined;
  return row?.stage ?? 'unknown';
}

export function applicationBody(db: DatabaseSync, app: ApplicationRow) {
  const revision = getAppRevision(db, app.workspace_id, app.id, app.current_revision);
  if (!revision) throw new Error('APPLICATION_REVISION_MISSING');
  return {
    id: app.id, workspace_id: app.workspace_id, job_key: app.job_key, current: appRevisionBody(revision),
    submission_state: submissionState(db, app), recruitment_stage: recruitmentStage(db, app.workspace_id, app.id),
    created_at: iso(app.created_at_ms), updated_at: iso(app.updated_at_ms),
  };
}

// 저장된 파일 bytes를 다시 읽어 DB hash와 대조한다. 권한·실행은 실제 bytes가 확정 당시와 같을 때만 진행한다.
export function readVerifiedArtifact(db: DatabaseSync, store: ObjectStore, ws: string, artifactId: string): { row: ArtifactRow; bytes: Buffer } | { error: 'ARTIFACT_NOT_FOUND' | 'ARTIFACT_FILE_MISSING' | 'ARTIFACT_HASH_MISMATCH' } {
  const row = db.prepare('SELECT * FROM ce7_artifacts WHERE workspace_id = ? AND id = ?').get(ws, artifactId) as ArtifactRow | undefined;
  if (!row) return { error: 'ARTIFACT_NOT_FOUND' };
  let bytes: Buffer;
  try { bytes = store.read(ws, row.object_key); } catch { return { error: 'ARTIFACT_FILE_MISSING' }; }
  if (sha256Hex(bytes) !== row.sha256 || bytes.length !== row.byte_size) return { error: 'ARTIFACT_HASH_MISMATCH' };
  return { row, bytes };
}

// 자체 폼은 사이트 로그인이 없어 '기기 × 사이트'를 계정 binding으로 쓴다(DECISIONS S5-03).
export const bindingFingerprint = (siteId: string, deviceId: string) => sha256Hex(`${siteId}|${deviceId}`);
