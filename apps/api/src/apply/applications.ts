import type { DatabaseSync } from 'node:sqlite';
import { answerIssues, canonicalJson, parseAnswers, payloadHash, sha256 } from '../../../../packages/apply/src/payload.ts';
import { SELF_FORM_ADAPTER_VERSION, SELF_FORM_QUESTIONS, SELF_FORM_SITE_ID, selfFormTarget } from '../../../../packages/apply/src/self-form.ts';
import type { Answer } from '../../../../packages/apply/src/types.ts';
import type { Config } from '../config.ts';
import { iso, isPlainObject, newId, problem, readJson } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import { idempotentWrite, readIdempotencyKey } from '../idempotency.ts';
import type { ObjectStore } from '../resume/storage.ts';
import { getJobSnapshot, jobSnapshotBody } from '../search/repository.ts';
import type { JobSnapshotRow } from '../search/repository.ts';
import { artifactBody, getRevision } from '../tailor/repository.ts';
import type { ArtifactRow } from '../tailor/repository.ts';
import {
  applicationBody, appRevisionBody, attemptBody, authorizationBody, evidenceBody, getApplication, getAppRevision, listAppRevisions, listAttempts,
  listAuthorizations, listEvidence, observationBody, readVerifiedArtifact, revisionAnswers,
} from './repository.ts';
import type { ApplicationRow, ObservationRow } from './repository.ts';
import { externalBody, matchingExternal } from './external.ts';

// 지원 건(공고당 하나): 제출할 이력서 revision·실제 PDF·답변을 revision으로 고정한다. 전송 뒤에는 바꾸지 않는다.

export type ApplyDeps = { db: DatabaseSync; config: Config; store: ObjectStore };

const notFound = (request: ProductRequest) => problem(request, 404, 'APPLICATION_NOT_FOUND', '지원 건을 찾을 수 없습니다.');
const CREATE_KEYS = ['answers', 'artifact_id', 'job_snapshot_id', 'resume_revision_id'];
const UPDATE_KEYS = [...CREATE_KEYS, 'expected_revision'].sort();
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

type Content = { job: JobSnapshotRow; resumeRevisionId: string; artifact: ArtifactRow; answers: Answer[]; payloadHash: string };

// 지원 내용 검증: 공고·확정 이력서·실제 PDF bytes·답변 형식. 실패하면 Reply.
// keepResumeId: 이미 지원 건에 고정된 이력서(자동 준비가 확정 파일 그대로 쓴 기준 이력서 등)는 공고가 달라도 그대로 유지할 수 있다.
function resolveContent(deps: ApplyDeps, request: ProductRequest, ws: string, body: Record<string, unknown>, keepResumeId?: string): Content | Reply {
  const job = getJobSnapshot(deps.db, ws, String(body.job_snapshot_id));
  if (!job) return problem(request, 404, 'JOB_NOT_FOUND', '공고를 찾을 수 없습니다.');
  if (!selfFormTarget(job)) return problem(request, 422, 'SITE_NOT_SUPPORTED', '이 공고의 지원 사이트는 아직 자동 입력을 지원하지 않습니다. 사이트에서 직접 지원한 뒤 외부 지원 기록으로 남겨 주세요.');
  const resume = getRevision(deps.db, ws, String(body.resume_revision_id));
  if (!resume) return problem(request, 404, 'RESUME_REVISION_NOT_FOUND', '이력서 버전을 찾을 수 없습니다.');
  if (resume.state !== 'final') return problem(request, 409, 'RESUME_NOT_FINAL', '확정한 이력서만 지원에 사용할 수 있습니다.');
  if (resume.job_snapshot_id !== job.id && resume.id !== keepResumeId) return problem(request, 409, 'RESUME_JOB_MISMATCH', '이 공고에 맞춰 확정한 이력서가 아닙니다.');
  const file = readVerifiedArtifact(deps.db, deps.store, ws, String(body.artifact_id));
  if ('error' in file) return problem(request, file.error === 'ARTIFACT_NOT_FOUND' ? 404 : 409, file.error, file.error === 'ARTIFACT_NOT_FOUND' ? '파일을 찾을 수 없습니다.' : '저장된 PDF가 생성 당시와 다릅니다. PDF를 다시 만들어 주세요.');
  if (file.row.resume_revision_id !== resume.id) return problem(request, 409, 'ARTIFACT_REVISION_MISMATCH', '이 이력서 버전에서 만든 PDF가 아닙니다.');
  const answers = parseAnswers(body.answers, SELF_FORM_QUESTIONS);
  if (!answers.ok) return problem(request, 422, answers.code, answers.message);
  const hash = payloadHash({ job_snapshot_id: job.id, job_content_hash: job.content_hash, resume_revision_id: resume.id, artifact_id: file.row.id, artifact_sha256: file.row.sha256, answers: answers.answers });
  return { job, resumeRevisionId: resume.id, artifact: file.row, answers: answers.answers, payloadHash: hash };
}

function insertRevision(db: DatabaseSync, ws: string, applicationId: string, revision: number, content: Content, nowMs: number) {
  db.prepare('INSERT INTO ce7_application_revisions (workspace_id, application_id, revision, job_snapshot_id, resume_revision_id, artifact_id, artifact_sha256, answers_json, payload_hash, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ws, applicationId, revision, content.job.id, content.resumeRevisionId, content.artifact.id, content.artifact.sha256, JSON.stringify(content.answers), content.payloadHash, nowMs);
}

// 같은 공고의 지원 건이나 사용자가 기록한 외부 지원이 있으면 새 지원을 만들지 않는다.
function duplicateOf(db: DatabaseSync, request: ProductRequest, ws: string, jobKey: string): Reply | null {
  const existing = db.prepare('SELECT id FROM ce7_applications WHERE workspace_id = ? AND job_key = ?').get(ws, jobKey) as { id: string } | undefined;
  if (existing) return problem(request, 409, 'APPLICATION_EXISTS', '이 공고의 지원 건이 이미 있습니다.', { application_id: existing.id });
  const external = db.prepare('SELECT id FROM ce8_external_applications WHERE workspace_id = ? AND job_key = ?').get(ws, jobKey) as { id: string } | undefined;
  if (external) return problem(request, 409, 'EXTERNAL_APPLICATION_EXISTS', '이 공고는 다른 경로로 이미 지원했다고 기록되어 있습니다.', { external_application_id: external.id });
  return null;
}

export function createJobApplication(deps: ApplyDeps, request: ProductRequest, principal: Principal): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== CREATE_KEYS.join() || !isId(body.job_snapshot_id) || !isId(body.resume_revision_id) || !isId(body.artifact_id)) {
    return problem(request, 400, 'INVALID_APPLICATION', 'job_snapshot_id·resume_revision_id·artifact_id·answers가 필요합니다.');
  }
  const ws = principal.workspaceId;
  const content = resolveContent(deps, request, ws, body);
  if ('status' in content) return content;
  return idempotentWrite(deps.db, request, ws, 'createJobApplication', key.key, sha256(canonicalJson(body)), () => {
    const duplicate = duplicateOf(deps.db, request, ws, content.job.job_key);
    if (duplicate) return duplicate;
    const id = newId('application');
    const now = request.nowMs;
    deps.db.prepare("INSERT INTO ce7_applications (id, workspace_id, job_key, current_revision, source_kind, source_campaign_id, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 1, 'manual', NULL, ?, ?)")
      .run(id, ws, content.job.job_key, now, now);
    insertRevision(deps.db, ws, id, 1, content, now);
    return { status: 201, body: applicationBody(deps.db, getApplication(deps.db, ws, id)!) };
  });
}

export function listJobApplications(deps: ApplyDeps, _request: ProductRequest, principal: Principal): Reply {
  const rows = deps.db.prepare('SELECT * FROM ce7_applications WHERE workspace_id = ? ORDER BY updated_at_ms DESC, rowid DESC LIMIT 100').all(principal.workspaceId) as ApplicationRow[];
  return { status: 200, body: { items: rows.map(row => applicationBody(deps.db, row)), next_cursor: null } };
}

export function getJobApplication(deps: ApplyDeps, request: ProductRequest, principal: Principal, id: string): Reply {
  const app = getApplication(deps.db, principal.workspaceId, id);
  return app ? { status: 200, body: applicationBody(deps.db, app) } : notFound(request);
}

// 새 지원 내용 revision. 아직 전송하지 않은 경우에만 바꿀 수 있고, 전송 전 권한·대기 시도는 더 쓰지 못하게 한다.
export function updateJobApplication(deps: ApplyDeps, request: ProductRequest, principal: Principal, id: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== UPDATE_KEYS.join() || !Number.isInteger(body.expected_revision) || !isId(body.job_snapshot_id) || !isId(body.resume_revision_id) || !isId(body.artifact_id)) {
    return problem(request, 400, 'INVALID_APPLICATION', 'expected_revision과 지원 내용 전체가 필요합니다.');
  }
  const ws = principal.workspaceId;
  const app = getApplication(deps.db, ws, id);
  if (!app) return notFound(request);
  const content = resolveContent(deps, request, ws, body, app.source_kind === 'campaign' ? getAppRevision(deps.db, ws, id, app.current_revision)?.resume_revision_id : undefined);
  if ('status' in content) return content;
  if (content.job.job_key !== app.job_key) return problem(request, 409, 'APPLICATION_JOB_MISMATCH', '지원 건의 공고는 바꿀 수 없습니다.');
  return idempotentWrite(deps.db, request, ws, `updateJobApplication:${id}`, key.key, sha256(canonicalJson(body)), () => {
    const current = getApplication(deps.db, ws, id)!;
    if (current.current_revision !== body.expected_revision) return problem(request, 409, 'APPLICATION_REVISION_CONFLICT', '다른 화면에서 지원 내용이 바뀌었습니다. 새로 불러온 뒤 다시 저장해 주세요.');
    const sent = deps.db.prepare("SELECT 1 FROM ce7_attempts WHERE workspace_id = ? AND application_id = ? AND state IN ('dispatched','submitted','submission_unknown')").get(ws, id);
    if (sent) return problem(request, 409, 'APPLICATION_ALREADY_SENT', '이미 제출을 시작한 지원 건은 바꿀 수 없습니다. 제출 당시 내용은 이력에 그대로 남습니다.');
    const revision = getAppRevision(deps.db, ws, id, current.current_revision)!;
    if (revision.payload_hash === content.payloadHash) return { status: 200, body: applicationBody(deps.db, current) };
    const now = request.nowMs;
    const next = current.current_revision + 1;
    // 바뀌기 전 내용에 묶인 미전송 권한·대기 시도는 더 쓰지 않는다(DB도 대기 시도가 있으면 revision 변경을 막는다).
    deps.db.prepare("UPDATE ce7_attempts SET state = 'failed_before_dispatch', error_code = 'APPLICATION_CHANGED', updated_at_ms = ? WHERE workspace_id = ? AND application_id = ? AND state = 'prepared'").run(now, ws, id);
    deps.db.prepare('UPDATE ce7_authorizations SET revoked_at_ms = ? WHERE workspace_id = ? AND application_id = ? AND revoked_at_ms IS NULL').run(now, ws, id);
    insertRevision(deps.db, ws, id, next, content, now);
    deps.db.prepare('UPDATE ce7_applications SET current_revision = ?, updated_at_ms = ? WHERE workspace_id = ? AND id = ?').run(next, now, ws, id);
    return { status: 200, body: applicationBody(deps.db, getApplication(deps.db, ws, id)!) };
  });
}

const STAGES = ['unknown', 'review', 'interview', 'offer', 'rejected', 'withdrawn'];

// 채용 진행 단계는 접수 상태와 별개 기록이다. 접수가 확인된 지원 건에만 사용자가 기록한다(source=user).
export function recordRecruitmentStage(deps: ApplyDeps, request: ProductRequest, principal: Principal, id: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== 'expected_application_revision,note,stage' || !Number.isInteger(body.expected_application_revision) || !STAGES.includes(String(body.stage)) || typeof body.note !== 'string' || body.note.length > 500) {
    return problem(request, 400, 'INVALID_RECRUITMENT_UPDATE', 'stage·note(500자 이하)·expected_application_revision이 필요합니다.');
  }
  const ws = principal.workspaceId;
  if (!getApplication(deps.db, ws, id)) return notFound(request);
  return idempotentWrite(deps.db, request, ws, `recordRecruitmentStage:${id}`, key.key, sha256(canonicalJson(body)), () => {
    const app = getApplication(deps.db, ws, id)!;
    if (app.current_revision !== body.expected_application_revision) return problem(request, 409, 'APPLICATION_REVISION_CONFLICT', '지원 내용이 바뀌었습니다. 새로 불러와 주세요.');
    const submitted = deps.db.prepare("SELECT 1 FROM ce7_attempts WHERE workspace_id = ? AND application_id = ? AND state = 'submitted'").get(ws, id);
    if (!submitted) return problem(request, 409, 'APPLICATION_NOT_SUBMITTED', '접수가 확인된 지원 건에만 채용 진행 단계를 기록할 수 있습니다.');
    deps.db.prepare("INSERT INTO ce7_recruitment_events (id, workspace_id, application_id, stage, source, note, observed_at_ms) VALUES (?, ?, ?, ?, 'user', ?, ?)")
      .run(newId('event'), ws, id, String(body.stage), String(body.note).normalize('NFC'), request.nowMs);
    deps.db.prepare('UPDATE ce7_applications SET updated_at_ms = ? WHERE workspace_id = ? AND id = ?').run(request.nowMs, ws, id);
    return { status: 201, body: applicationBody(deps.db, getApplication(deps.db, ws, id)!) };
  });
}

// 지원 이력 상세: 회사·공고 snapshot·제출 revision·파일·답변·권한·시도·접수 근거·채용 단계를 한 번에 돌려준다.
export function getApplicationHistory(deps: ApplyDeps, request: ProductRequest, principal: Principal, id: string): Reply {
  const ws = principal.workspaceId;
  const app = getApplication(deps.db, ws, id);
  if (!app) return notFound(request);
  const revisions = listAppRevisions(deps.db, ws, id);
  const current = revisions.find(item => item.revision === app.current_revision)!;
  const jobIds = [...new Set(revisions.map(item => item.job_snapshot_id))];
  const jobs = jobIds.map(jobId => getJobSnapshot(deps.db, ws, jobId)!).filter(Boolean);
  const currentJob = jobs.find(job => job.id === current.job_snapshot_id)!;
  const artifactIds = [...new Set(revisions.map(item => item.artifact_id))];
  const artifacts = artifactIds.map(artifactId => deps.db.prepare('SELECT * FROM ce7_artifacts WHERE workspace_id = ? AND id = ?').get(ws, artifactId) as ArtifactRow);
  const attempts = listAttempts(deps.db, ws, id);
  const observations = deps.db.prepare('SELECT * FROM ce8_form_observations WHERE workspace_id = ? AND application_id = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 10').all(ws, id) as ObservationRow[];
  const events = deps.db.prepare('SELECT * FROM ce7_recruitment_events WHERE workspace_id = ? AND application_id = ? ORDER BY observed_at_ms DESC, rowid DESC').all(ws, id) as { id: string; stage: string; source: string; note: string; observed_at_ms: number }[];
  const target = selfFormTarget(currentJob);
  return {
    status: 200,
    body: {
      application: applicationBody(deps.db, app),
      source: { kind: app.source_kind, campaign_id: (deps.db.prepare('SELECT source_campaign_id FROM ce7_applications WHERE workspace_id = ? AND id = ?').get(ws, id) as { source_campaign_id: string | null }).source_campaign_id },
      jobs: jobs.map(jobSnapshotBody),
      form: { site_id: SELF_FORM_SITE_ID, adapter_version: SELF_FORM_ADAPTER_VERSION, target_url: target?.target_url ?? null, questions: SELF_FORM_QUESTIONS.map(question => ({ ...question })) },
      answer_issues: answerIssues(revisionAnswers(current), SELF_FORM_QUESTIONS),
      revisions: revisions.map(appRevisionBody),
      artifacts: artifacts.map(artifactBody),
      observations: observations.map(observationBody),
      authorizations: listAuthorizations(deps.db, ws, id).map(row => ({ authorization: authorizationBody(row), revoked_at: row.revoked_at_ms === null ? null : iso(row.revoked_at_ms) })),
      attempts: attempts.map(row => attemptBody(deps.db, row)),
      evidence: attempts.flatMap(row => listEvidence(deps.db, ws, row.id)).map(evidenceBody),
      recruitment_events: events.map(row => ({ id: row.id, stage: row.stage, source: row.source, note: row.note, observed_at: iso(row.observed_at_ms) })),
      external_matches: matchingExternal(deps.db, ws, currentJob).map(externalBody),
    },
  };
}

