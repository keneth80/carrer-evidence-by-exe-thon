import { call } from '../resume/api.ts';
import type { JobSnapshot, RenderedArtifact, Task } from '../resume/api.ts';
import type { Condition } from '../../../../packages/search/src/types.ts';

// S06 자동화 정책(추천·자동 준비)과 유사 공고 캠페인 호출.

export type PolicyMode = 'recommend' | 'prepare';
export type DocumentStrategy = 'fixed_document' | 'tailor_within_facts';
export type PolicyRevision = {
  id: string; policy_id: string; revision: number; mode: PolicyMode | 'submit'; document_strategy: DocumentStrategy; fact_revision_id: string; seed_resume_revision_id: string; fixed_artifact_id: string | null;
  conditions: Condition[]; allowed_sites: string[]; account_binding_ids: string[]; excluded_companies: string[]; allowed_edits: string[];
  daily_limit: number; total_limit: number; budget_limit_micro_usd: number; quota_timezone: 'Asia/Seoul'; valid_from: string; expires_at: string; content_hash: string; created_at: string;
};
export type PolicyControl = { policy_id: string; active_revision_id: string | null; state: 'draft' | 'active' | 'paused' | 'revoked' | 'expired'; generation: number; updated_at: string };
export type Campaign = { id: string; policy_revision_id: string; seed_application_id: string; seed_job_snapshot_id: string; seed_resume_revision_id: string; state: 'draft' | 'active' | 'paused' | 'completed' | 'canceled'; discovered_job_snapshot_ids: string[]; application_ids: string[]; created_at: string };
export type QueueState = 'discovered' | 'needs_review' | 'eligible' | 'prepared' | 'queued' | 'skipped';
export type Evaluation = {
  mode: string; score: number; reasons: { kind: string; matched: boolean; text: string }[]; shared_skills: string[];
  conditions: { field: string; importance: string; state: string; detail: string }[]; duplicate: { kind: string; detail: string };
  needs: string[]; notes: string[]; held: boolean; document: { strategy: DocumentStrategy; resume_revision_id: string; artifact_id: string; artifact_sha256: string; filename: string } | null; decided_at: string;
};
export type QueueItem = { job: JobSnapshot; state: QueueState; application_id: string | null; application_state: string | null; evaluation: Evaluation };
export type Queue = {
  campaign: Campaign; policy: PolicyRevision; policy_control: PolicyControl;
  seed: { application_id: string; application_revision: number; submission_state: string; job: JobSnapshot; resume_revision_id: string; artifact: RenderedArtifact };
  tasks: (Task & { kind: string })[]; items: QueueItem[];
};
export type PolicyDraft = Omit<PolicyRevision, 'id' | 'policy_id' | 'revision' | 'content_hash' | 'created_at'> & { policy_id: string | null; expected_parent_revision_id: string | null };

const json = (value: unknown) => JSON.stringify(value);
export const automationApi = {
  createPolicy: (body: PolicyDraft, key: string) => call<PolicyRevision>('POST', '/api/v1/auto-apply-policies', json(body), 'application/json', key),
  control: (policyId: string) => call<PolicyControl>('GET', `/api/v1/auto-apply-policies/${policyId}`),
  activate: (policyId: string, body: { revision_id: string; expected_generation: number; accepted_content_hash: string; consent: true }, key: string) => call<PolicyControl>('POST', `/api/v1/auto-apply-policies/${policyId}/activate`, json(body), 'application/json', key),
  pausePolicy: (policyId: string, generation: number, key: string) => call<PolicyControl>('POST', `/api/v1/auto-apply-policies/${policyId}/pause`, json({ expected_generation: generation }), 'application/json', key),
  createCampaign: (body: { policy_revision_id: string; seed_application_id: string }, key: string) => call<Campaign>('POST', '/api/v1/similar-job-campaigns', json(body), 'application/json', key),
  campaigns: () => call<{ items: Campaign[] }>('GET', '/api/v1/similar-job-campaigns'),
  queue: (id: string) => call<Queue>('GET', `/api/v1/similar-job-campaigns/${id}/queue`),
  run: (id: string, key: string) => call<{ task: Task; resource_id: string }>('POST', `/api/v1/similar-job-campaigns/${id}/run`, '{}', 'application/json', key),
  pause: (id: string, key: string) => call<Campaign>('POST', `/api/v1/similar-job-campaigns/${id}/pause`, '{}', 'application/json', key),
  cancel: (id: string, key: string) => call<Campaign>('POST', `/api/v1/similar-job-campaigns/${id}/cancel`, '{}', 'application/json', key),
};

export const QUEUE_LABELS: Record<QueueState, string> = { prepared: '서류 준비됨', needs_review: '검토 필요', eligible: '추천', discovered: '발견', queued: '대기', skipped: '건너뜀' };
export const CAMPAIGN_LABELS: Record<Campaign['state'], string> = { draft: '시작 전', active: '진행 중', paused: '일시중지', completed: '완료', canceled: '취소됨' };
export const MODE_LABELS: Record<string, string> = { recommend: '추천만', prepare: '서류 자동 준비(제출 없음)', submit: '자동 제출' };
export const STRATEGY_LABELS: Record<DocumentStrategy, string> = { tailor_within_facts: '공고마다 확정 경력 범위에서 맞춤', fixed_document: '확정 PDF 그대로 사용' };
