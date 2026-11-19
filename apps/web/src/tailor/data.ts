import type { ResumeFact } from '../../../../packages/resume/src/types.ts';
import { api } from '../resume/api.ts';
import type { EditProposal, FactRevision, JobSnapshot, ResumeRevision, Task, TailoringMessage, TailoringSession } from '../resume/api.ts';

// 편집 화면 데이터: 세션·공고·현재 revision·대화·제안과, 사실 확인에 필요한 문서의 최신 확정 경력.

export type TailorData = {
  session: TailoringSession; job: JobSnapshot; revision: ResumeRevision; revisions: ResumeRevision[];
  messages: TailoringMessage[]; proposals: EditProposal[]; facts: ResumeFact[];
  head: FactRevision | null; documentId: string; extractionId: string | null;
  tasks: (Task & { input_revision_ids: string[] })[];
};

export async function loadTailor(sessionId: string): Promise<TailorData> {
  const session = await api.tailoringSession(sessionId);
  const [job, revision, messages, proposals, revisions, tasks] = await Promise.all([
    api.job(session.job_snapshot_id), api.revision(session.current_resume_revision_id ?? ''),
    api.messages(sessionId), api.proposals(sessionId), api.revisions(sessionId), api.sessionTasks(sessionId),
  ]);
  const factRevision = await api.factRevision(revision.fact_revision_id);
  const documents = await api.documents();
  const summary = documents.items.find(item => item.document.id === factRevision.document_id);
  const head = summary?.current_fact_revision_id ? (summary.current_fact_revision_id === factRevision.id ? factRevision : await api.factRevision(summary.current_fact_revision_id)) : null;
  const extraction = await api.extraction(factRevision.document_id).catch(() => null);
  return {
    session, job, revision, revisions: revisions.items, messages: messages.items, proposals: proposals.items,
    facts: factRevision.facts, head, documentId: factRevision.document_id, extractionId: extraction?.id ?? null, tasks: tasks.items,
  };
}

// 마지막 사용자 메시지의 답변 상태. 서버 작업 기록으로 판단하므로 새로고침 뒤에도 '생성 중'과 '실패'를 구분한다.
// JD 점검(S1-18)은 사용자 메시지 없이 만든 대화 작업이다. 가장 최근 대화 작업이 어떤 메시지에도 묶이지 않았으면 JD 점검으로 본다.
export type ReplyState = { kind: 'idle' } | { kind: 'pending'; taskId: string | null; jdCheck: boolean } | { kind: 'failed'; messageId: string; code: string | null } | { kind: 'jd_failed'; code: string | null };
export function replyState(data: TailorData): ReplyState {
  const last = data.messages.at(-1);
  if (last?.role === 'user') {
    const task = data.tasks.find(item => item.kind === 'tailor_resume' && item.input_revision_ids.includes(last.id));
    if (task?.state === 'failed') return { kind: 'failed', messageId: last.id, code: task.error_code };
    if (task?.state === 'queued' || task?.state === 'running') return { kind: 'pending', taskId: task.id, jdCheck: false };
    return task ? { kind: 'idle' } : { kind: 'pending', taskId: null, jdCheck: false };
  }
  // 작업 목록은 최신순이다.
  const latest = data.tasks.find(item => item.kind === 'tailor_resume');
  const jdCheck = latest && !data.messages.some(message => latest.input_revision_ids.includes(message.id));
  if (!latest || !jdCheck) return { kind: 'idle' };
  if (latest.state === 'queued' || latest.state === 'running') return { kind: 'pending', taskId: latest.id, jdCheck: true };
  if (latest.state === 'failed') return { kind: 'jd_failed', code: latest.error_code };
  return { kind: 'idle' };
}

// 이 revision의 대기·진행 중 렌더 작업.
export function renderInProgress(data: TailorData, revisionId: string): string | null {
  return data.tasks.find(item => item.kind === 'render_resume' && (item.state === 'queued' || item.state === 'running') && item.input_revision_ids.includes(revisionId))?.id ?? null;
}

// 답변 메시지와 같은 시각에 저장된 제안을 묶는다(worker가 한 transaction·같은 시각으로 저장).
export function proposalFor(message: TailoringMessage, proposals: EditProposal[]): EditProposal | undefined {
  return message.role === 'assistant' ? proposals.find(item => item.created_at === message.created_at && item.base_resume_revision_id === message.base_resume_revision_id) : undefined;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

// 사용자 진술이 이미 경력 정보로 확정됐는지(최신 확정 경력에 같은 문장의 user_statement 사실이 있는지).
export function statementConfirmed(head: FactRevision | null, text: string | null): boolean {
  if (!head || !text) return false;
  return head.facts.some(fact => squash(fact.statement) === squash(text) && fact.evidence.some(item => item.kind === 'user_statement'));
}

// 같은 세션에서 기억해 둔 최근 편집 세션(공고별). 편의 기능이며 서버 자료가 기준이다.
export function rememberSession(jobId: string, sessionId: string) {
  try { window.localStorage.setItem(`ce.tailor.${jobId}`, sessionId); } catch { /* 저장소를 쓸 수 없으면 기억하지 않는다. */ }
}
export function recentSession(jobId: string): string | null {
  try {
    const value = window.localStorage.getItem(`ce.tailor.${jobId}`);
    return value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
  } catch { return null; }
}
