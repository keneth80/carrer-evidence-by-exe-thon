import type { FactReview, ResumeFact } from '../../../../packages/resume/src/types.ts';
import type { Condition, JobRequirement, QueryPlan } from '../../../../packages/search/src/types.ts';
import type { ProposedChange, ResumeBlock } from '../../../../packages/tailor/src/types.ts';

// /api/v1 S01·S02·S04 호출(S05 지원 호출은 apply/api.ts). 쓰기 요청은 CSRF header와 Idempotency-Key를 붙인다.

export type ProductSession = { workspace_id: string; mode: 'authenticated' | 'synthetic_local'; expires_at: string };
export type ResumeDocument = {
  id: string; input_kind: 'text_pdf' | 'pasted_text' | 'docx'; filename: string; mime_type: string; byte_size: number; sha256: string;
  data_origin: 'user' | 'synthetic'; extraction_status: 'uploaded' | 'extracting' | 'review_required' | 'extracted' | 'failed';
  error_code: string | null; created_at: string;
};
export type Task = { id: string; kind?: string; state: string; error_code: string | null; cancel_requested?: boolean; provider_transmission?: string; result_ids?: string[]; updated_at: string };
export type DocumentSummary = { document: ResumeDocument; current_fact_revision_id: string | null; latest_task: Task | null };
export type ExtractionDraft = { id: string; document_id: string; status: 'review_required' | 'failed'; facts: ResumeFact[]; warnings: string[]; created_at: string };
export type AiReview = { id: string; fact_revision_id: string; task_id: string; provider_mode: 'mock' | 'live'; state: 'queued' | 'succeeded' | 'failed'; summary: string | null; items: { fact_ids: string[]; title: string; detail: string; question: string | null; example?: string | null }[]; error_code: string | null; created_at: string; updated_at: string };
// 기본 이력서 보완 대화(S1-16). candidates는 사용자 메시지 문장이고, drafts는 사실이 아닌 문장 제안이다.
export type SupplementCandidate = { statement: string; category: ResumeFact['category']; supplements_fact_id: string | null; message_id: string };
// 단계별 실행 요약·진행(DECISIONS S1-17). stages는 서버가 정한 순서·이름 그대로 보여 준다.
export type SupplementStage = { key: string; label: string; state: 'pending' | 'running' | 'done' | 'skipped' | 'failed'; note: string | null };
export type SupplementPipeline = { mode: 'staged' | 'single'; stages: SupplementStage[]; rule_findings: number; ai_findings: number; drafts_reviewed: number; dropped_drafts: { text: string; reason: string; by: 'critic' | 'guard' }[]; drafts_withheld: boolean };
export type SupplementProgress = { task_id: string; mode: 'staged' | 'single'; stages: (SupplementStage & { started_at: string | null; finished_at: string | null })[]; started_at: string };
// 점검 항목별 추천 문장(v0.7.8, S1-24). 이 턴이 추천 응답이면 suggestion이 있고, 화면은 해당 점검 항목 아래에 보여 준다.
export type SuggestionOption = { style: 'concise' | 'scope' | 'result'; text: string; fact_ids: string[] };
export type SuggestionSet = { source_message_id: string; finding_index: number; finding_title: string; target_fact_ids: string[]; options: SuggestionOption[] };
export type SupplementTurn = { reply: string; findings: AiReview['items']; candidates: SupplementCandidate[]; drafts: { text: string; fact_ids: string[]; note: string }[]; questions: string[]; pipeline?: SupplementPipeline; suggestion?: SuggestionSet };
export type SupplementMessage = { id: string; role: 'user' | 'assistant'; content: string; turn: SupplementTurn | null; created_at: string };
export type SupplementSession = { id: string; document_id: string; fact_revision_id: string; head_fact_revision_id: string | null; provider_mode: 'mock' | 'live'; state: 'open' | 'closed'; messages: SupplementMessage[]; latest_task: Task | null; progress: SupplementProgress | null; created_at: string; updated_at: string };
export type SourceText = { document_id: string; extraction_id: string; input_kind: string; pages: { page: number | null; text: string }[] };
export type FactRevision = { id: string; document_id: string; revision: number; parent_revision_id: string | null; facts: ResumeFact[]; content_hash: string; confirmed_at: string };
export type SearchIntent = { id: string; fact_revision_id: string; conditions: Condition[]; queries: QueryPlan[]; content_hash: string; created_at: string };
export type SearchRun = { id: string; intent_id: string; task_id: string; provider_mode: 'mock' | 'live'; state: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'; job_snapshot_ids: string[]; outcome: 'complete' | 'partial' | 'empty' | null; created_at: string };
export type JobSnapshot = {
  id: string; job_key: string; company_name: string; title: string; canonical_url: string; site_id: string; content_text: string;
  content_hash: string; open_status: 'open' | 'closed' | 'unknown'; requirements: JobRequirement[]; data_origin: 'live' | 'synthetic'; observed_at: string;
};
export type TailoringSession = { id: string; job_snapshot_id: string; fact_revision_id: string; current_resume_revision_id: string | null; revision: number; state: 'editing' | 'ready' | 'waiting_user' | 'closed'; created_at: string; progress?: SupplementProgress | null; job_text?: string | null };
// 공고(JD) 맞춤 대화 턴 결과(v0.7.6, S1-18). 서버 packages/tailor/src/tailor-pipeline.ts TailorTurn과 같은 모양이다.
export type RequirementCheck = { requirement_id: string; requirement: string; importance: 'required' | 'preferred' | 'unknown'; status: 'met' | 'weak' | 'missing'; fact_ids: string[]; note: string; evidence?: string | null; judged_by?: 'rule' | 'ai' };
export type JdFinding = { requirement_id: string; fact_ids: string[]; title: string; question: string; example?: string | null };
export type TailorPipeline = { mode: 'staged' | 'single'; stages: SupplementStage[]; requirements_checked: number; ai_findings: number; changes_reviewed: number; dropped_changes: { text: string; reason: string; by: 'critic' | 'guard' }[]; changes_withheld: boolean };
export type TailorTurn = { kind: 'jd_check' | 'answer'; requirements: RequirementCheck[]; findings: JdFinding[]; pipeline: TailorPipeline };
export type TailoringMessage = { id: string; session_id: string; role: 'user' | 'assistant'; content: string; base_resume_revision_id: string | null; created_at: string; turn?: TailorTurn | null };
export type EditProposal = { id: string; session_id: string; base_resume_revision_id: string; base_content_hash: string; changes: ProposedChange[]; state: 'proposed' | 'accepted' | 'rejected' | 'stale'; unresolved_questions: string[]; created_at: string };
export type ResumeRevision = { id: string; session_id: string; job_snapshot_id: string; fact_revision_id: string; revision: number; parent_revision_id: string | null; blocks: ResumeBlock[]; content_hash: string; state: 'draft' | 'final'; finalized_at: string | null; finalization_source: 'user' | 'policy' | null; created_at: string };
export type RenderedArtifact = { id: string; resume_revision_id: string; mime_type: 'application/pdf'; filename: string; byte_size: number; sha256: string; download_path: string; created_at: string };
export type Problem = { code: string; message: string; request_id?: string; details?: Record<string, unknown> };

export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;
  constructor(status: number, problem: Problem) {
    super(problem.message);
    this.status = status;
    this.problem = problem;
  }
}

function csrfToken(): string {
  const match = /(?:^|;\s*)ce_csrf=([a-f0-9]{64})/.exec(document.cookie);
  return match ? match[1] : '';
}

export async function call<T>(method: string, path: string, body?: BodyInit, contentType?: string, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken();
    headers['Idempotency-Key'] = idempotencyKey ?? crypto.randomUUID();
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: 'API에 연결할 수 없습니다. 터미널에서 npm run dev 실행 상태를 확인하세요.' });
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({ code: 'INVALID_RESPONSE', message: `API 응답 ${response.status}` }));
  if (!response.ok) throw new ApiError(response.status, payload as Problem);
  return payload as T;
}

export const api = {
  session: () => call<ProductSession>('GET', '/api/v1/product-session'),
  login: (profile: string) => call<{ session: ProductSession; profile: string }>('POST', '/api/v1/local-dev/session', JSON.stringify({ profile }), 'application/json'),
  logout: () => call<void>('DELETE', '/api/v1/local-dev/session'),
  documents: () => call<{ items: DocumentSummary[] }>('GET', '/api/v1/resume-documents'),
  uploadPdf: (file: File, key: string) => {
    const form = new FormData();
    form.append('file', file);
    return call<{ task: Task; resource_id: string }>('POST', '/api/v1/resume-documents', form, undefined, key);
  },
  pasteText: (text: string, filename: string, key: string) => call<{ task: Task; resource_id: string }>('POST', '/api/v1/resume-documents/text', JSON.stringify({ text, filename }), 'application/json', key),
  extraction: (id: string) => call<ExtractionDraft>('GET', `/api/v1/resume-documents/${id}/extraction`),
  extractionReview: (taskId: string) => call<Record<string, FactReview>>('GET', `/api/v1/local-dev/extraction-tasks/${taskId}/review`),
  sourceText: (id: string) => call<SourceText>('GET', `/api/v1/resume-documents/${id}/source-text`),
  factRevision: (id: string) => call<FactRevision>('GET', `/api/v1/resume-fact-revisions/${id}`),
  // AI 1차 점검(S1-14). 결과는 안내·질문이며 확정 경력을 바꾸지 않는다.
  createAiReview: (revisionId: string, key: string) => call<{ task: Task; resource_id: string }>('POST', `/api/v1/resume-fact-revisions/${revisionId}/ai-reviews`, '{}', 'application/json', key),
  aiReview: (id: string) => call<AiReview>('GET', `/api/v1/resume-ai-reviews/${id}`),
  createSupplement: (revisionId: string, key: string) => call<{ task: Task; resource_id: string }>('POST', `/api/v1/resume-fact-revisions/${revisionId}/supplement-sessions`, '{}', 'application/json', key),
  supplement: (id: string) => call<SupplementSession>('GET', `/api/v1/resume-supplement-sessions/${id}`),
  suggestSupplement: (id: string, body: { message_id: string; finding_index: number }, key: string) => call<{ task: Task; resource_id: string }>('POST', `/api/v1/resume-supplement-sessions/${id}/suggestions`, JSON.stringify(body), 'application/json', key),
  recordStatement: (id: string, content: string, key: string) => call<SupplementMessage>('POST', `/api/v1/resume-supplement-sessions/${id}/statements`, JSON.stringify({ content }), 'application/json', key),
  sendSupplement: (id: string, content: string, key: string) => call<{ task: Task; resource_id: string }>('POST', `/api/v1/resume-supplement-sessions/${id}/messages`, JSON.stringify({ content }), 'application/json', key),
  confirm: (documentId: string, body: { extraction_id: string; expected_parent_revision_id: string | null; facts: ResumeFact[] }, key: string) =>
    call<FactRevision>('POST', `/api/v1/resume-documents/${documentId}/fact-revisions`, JSON.stringify(body), 'application/json', key),
  createIntent: (body: { fact_revision_id: string; conditions: Condition[] }, key: string) => call<SearchIntent>('POST', '/api/v1/search-intents', JSON.stringify(body), 'application/json', key),
  intent: (id: string) => call<SearchIntent>('GET', `/api/v1/search-intents/${id}`),
  createSearch: (body: { intent_id: string; max_candidates: number }, key: string) => call<{ task: Task; resource_id: string }>('POST', '/api/v1/resume-searches', JSON.stringify(body), 'application/json', key),
  search: (id: string) => call<SearchRun>('GET', `/api/v1/resume-searches/${id}`),
  task: (id: string) => call<Task>('GET', `/api/v1/product-tasks/${id}`),
  cancelTask: (id: string, key: string) => call<Task>('POST', `/api/v1/product-tasks/${id}/cancel`, undefined, undefined, key),
  job: (id: string) => call<JobSnapshot>('GET', `/api/v1/job-snapshots/${id}`),
  createSession: (body: { job_snapshot_id: string; fact_revision_id: string }, key: string) => call<TailoringSession>('POST', '/api/v1/tailoring-sessions', JSON.stringify(body), 'application/json', key),
  tailoringSession: (id: string) => call<TailoringSession>('GET', `/api/v1/tailoring-sessions/${id}`),
  messages: (id: string) => call<{ items: TailoringMessage[] }>('GET', `/api/v1/tailoring-sessions/${id}/messages`),
  proposals: (id: string) => call<{ items: EditProposal[] }>('GET', `/api/v1/tailoring-sessions/${id}/proposals`),
  revisions: (id: string) => call<{ items: ResumeRevision[] }>('GET', `/api/v1/tailoring-sessions/${id}/revisions`),
  sessionTasks: (id: string) => call<{ items: (Task & { input_revision_ids: string[] })[] }>('GET', `/api/v1/tailoring-sessions/${id}/tasks`),
  sendMessage: (id: string, body: { expected_resume_revision_id: string | null; content: string }, key: string) => call<{ task: Task; resource_id: string }>('POST', `/api/v1/tailoring-sessions/${id}/messages`, JSON.stringify(body), 'application/json', key),
  retryMessage: (id: string, messageId: string, key: string) => call<{ task: Task; resource_id: string }>('POST', `/api/v1/tailoring-sessions/${id}/messages/${messageId}/retry`, '{}', 'application/json', key),
  putJobText: (id: string, content_text: string, key: string) => call<TailoringSession>('POST', `/api/v1/tailoring-sessions/${id}/job-text`, JSON.stringify({ content_text }), 'application/json', key),
  requestJdCheck: (id: string, body: { expected_resume_revision_id: string }, key: string) => call<{ task: Task; resource_id: string }>('POST', `/api/v1/tailoring-sessions/${id}/jd-checks`, JSON.stringify(body), 'application/json', key),
  restore: (id: string, body: { source_revision_id: string; expected_resume_revision_id: string }, key: string) => call<ResumeRevision>('POST', `/api/v1/tailoring-sessions/${id}/restore`, JSON.stringify(body), 'application/json', key),
  acceptProposal: (id: string, body: { expected_resume_revision_id: string; expected_content_hash: string; change_indexes?: number[] }, key: string) => call<ResumeRevision>('POST', `/api/v1/edit-proposals/${id}/accept`, JSON.stringify(body), 'application/json', key),
  rejectProposal: (id: string, key: string) => call<EditProposal>('POST', `/api/v1/edit-proposals/${id}/reject`, '{}', 'application/json', key),
  revision: (id: string) => call<ResumeRevision>('GET', `/api/v1/resume-revisions/${id}`),
  finalize: (id: string, body: { expected_content_hash: string; reviewed: true }, key: string) => call<ResumeRevision>('POST', `/api/v1/resume-revisions/${id}/finalize`, JSON.stringify(body), 'application/json', key),
  render: (revisionId: string, key: string) => call<{ task: Task; resource_id: string }>('POST', '/api/v1/artifacts', JSON.stringify({ resume_revision_id: revisionId }), 'application/json', key),
  artifacts: (revisionId: string) => call<{ items: RenderedArtifact[] }>('GET', `/api/v1/resume-revisions/${revisionId}/artifacts`),
  artifact: (id: string) => call<RenderedArtifact>('GET', `/api/v1/artifacts/${id}`),
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.problem.message;
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
}
