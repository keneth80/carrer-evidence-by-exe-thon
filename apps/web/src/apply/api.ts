import { call } from '../resume/api.ts';
import type { JobSnapshot, RenderedArtifact } from '../resume/api.ts';

// S05 지원 호출: 지원 건·수동 제출 권한·시도·접수 근거·채용 단계·외부 지원 기록·실행기 연결.

export type Answer = { question_id: string; question_text: string; answer: string; source: 'user_answer'; source_ids: string[] };
export type Question = { question_id: string; label: string; kind: 'text' | 'email' | 'textarea' | 'checkbox'; required: boolean; max_length: number };
export type ApplicationRevision = { application_id: string; revision: number; job_snapshot_id: string; resume_revision_id: string; artifact_id: string; artifact_sha256: string; answers: Answer[]; payload_hash: string; created_at: string };
export type SubmissionState = 'draft' | 'prepared' | 'queued' | 'running' | 'waiting_user' | 'submitted' | 'submission_unknown' | 'not_submitted' | 'canceled';
export type Stage = 'unknown' | 'review' | 'interview' | 'offer' | 'rejected' | 'withdrawn';
export type Application = { id: string; job_key: string; current: ApplicationRevision; submission_state: SubmissionState; recruitment_stage: Stage; created_at: string; updated_at: string };
export type Target = { executor: 'chrome' | 'ego'; site_id: string; adapter_version: string; account_binding_id: string; target_url: string; form_snapshot_hash: string };
export type Authorization = { id: string; application_revision: number; artifact_sha256: string; payload_hash: string; target: Target; expires_at: string; created_at: string; kind: 'manual'; user_reviewed_at: string };
export type Attempt = { id: string; application_id: string; authorization_id: string; executor: string; state: 'prepared' | 'dispatched' | 'submitted' | 'submission_unknown' | 'not_submitted' | 'failed_before_dispatch'; dispatch_started_at: string | null; evidence_ids: string[]; error_code: string | null; created_at: string; updated_at: string };
export type Evidence = { id: string; attempt_id: string; kind: 'confirmation_page' | 'receipt_id' | 'user_report' | 'no_delivery_proof'; conclusion: 'submitted' | 'not_submitted' | 'unknown'; summary: string; evidence_hash: string; observed_at: string; source_url: string | null };
export type Issue = { code: string; message: string };
export type Observation = { id: string; application_revision: number; payload_hash: string; state: 'inspected' | 'verified' | 'mismatch'; issues: Issue[]; target: Target; document_id: string; readback: { answers: { question_id: string; value: string }[]; file: { name: string; size: number; type: string; sha256: string } | null } | null; created_at: string };
export type External = { id: string; job_snapshot_id: string | null; job_key: string | null; company_name: string; title: string; channel: string; applied_on: string; note: string; created_at: string };
export type History = {
  application: Application; source: { kind: 'manual' | 'campaign'; campaign_id: string | null }; jobs: JobSnapshot[]; form: { site_id: string; adapter_version: string; target_url: string | null; questions: Question[] }; answer_issues: Issue[];
  revisions: ApplicationRevision[]; artifacts: RenderedArtifact[]; observations: Observation[]; authorizations: { authorization: Authorization; revoked_at: string | null }[]; attempts: Attempt[]; evidence: Evidence[];
  recruitment_events: { id: string; stage: Stage; source: 'user' | 'verified_integration'; note: string; observed_at: string }[]; external_matches: External[];
};
export type Device = { id: string; executor: string; label: string; created_at: string; last_seen_at: string; revoked_at: string | null };
export type Pairing = { id: string; executor: 'chrome'; code: string; expires_at: string };
export type ApplicationContent = { job_snapshot_id: string; resume_revision_id: string; artifact_id: string; answers: Answer[] };

const json = (value: unknown) => JSON.stringify(value);

export const applyApi = {
  list: () => call<{ items: Application[] }>('GET', '/api/v1/job-applications'),
  history: (id: string) => call<History>('GET', `/api/v1/job-applications/${id}/history`),
  create: (body: ApplicationContent, key: string) => call<Application>('POST', '/api/v1/job-applications', json(body), 'application/json', key),
  update: (id: string, body: ApplicationContent & { expected_revision: number }, key: string) => call<Application>('PATCH', `/api/v1/job-applications/${id}`, json(body), 'application/json', key),
  authorize: (id: string, body: { expected_application_revision: number; expected_payload_hash: string; target: Target; reviewed: true }, key: string) => call<Authorization>('POST', `/api/v1/job-applications/${id}/manual-authorizations`, json(body), 'application/json', key),
  attempt: (id: string, authorizationId: string, key: string) => call<Attempt>('POST', `/api/v1/job-applications/${id}/attempts`, json({ authorization_id: authorizationId }), 'application/json', key),
  observe: (attemptId: string, key: string) => call<{ task: { id: string; state: string }; resource_id: string }>('POST', `/api/v1/submission-attempts/${attemptId}/observe`, '{}', 'application/json', key),
  recordStage: (id: string, body: { expected_application_revision: number; stage: Stage; note: string }, key: string) => call<Application>('POST', `/api/v1/job-applications/${id}/recruitment-events`, json(body), 'application/json', key),
  externals: () => call<{ items: External[] }>('GET', '/api/v1/external-applications'),
  createExternal: (body: { job_snapshot_id: string | null; company_name: string; title: string; channel: string; applied_on: string; note: string }, key: string) => call<External>('POST', '/api/v1/external-applications', json(body), 'application/json', key),
  pairing: () => call<Pairing>('POST', '/api/v1/executor-pairings', json({ executor: 'chrome' }), 'application/json'),
  devices: () => call<{ items: Device[] }>('GET', '/api/v1/executor-devices'),
  revokeDevice: (id: string) => call<Device>('POST', `/api/v1/executor-devices/${id}/revoke`, '{}', 'application/json'),
};

export const STATE_LABELS: Record<SubmissionState, string> = {
  draft: '작성 중', prepared: '폼 입력 확인됨', queued: '승인됨 · 실행 대기', running: '전송 중', waiting_user: '확인 필요',
  submitted: '접수 확인됨', submission_unknown: '접수 여부 불명', not_submitted: '미접수 확정', canceled: '중지됨',
};
export const STAGE_LABELS: Record<Stage, string> = { unknown: '진행 정보 없음', review: '서류 검토 중', interview: '면접', offer: '합격·제안', rejected: '불합격', withdrawn: '지원 철회' };
export const EVIDENCE_LABELS: Record<Evidence['kind'], string> = { confirmation_page: '접수 완료 화면', receipt_id: '접수번호(사이트 기록)', user_report: '사용자 확인', no_delivery_proof: '미접수·불명 근거' };
export const CONCLUSION_LABELS: Record<Evidence['conclusion'], string> = { submitted: '접수됨', not_submitted: '접수 안 됨', unknown: '알 수 없음' };
export const userAnswer = (question: Question, answer: string): Answer => ({ question_id: question.question_id, question_text: question.label, answer, source: 'user_answer', source_ids: [`ua_${question.question_id}`] });
