import { randomUUID } from 'node:crypto';
import { userSentenceFor } from '../../../packages/tailor/src/user-sentence.ts';
import { screenChanges } from '../../../packages/tailor/src/screen-changes.ts';
import type { ChatProvider, ChatRequirementCheck, ChatTurn } from '../../../packages/tailor/src/provider.ts';
import type { TailorStageProvider } from '../../../packages/tailor/src/jd-check.ts';
import { runTailorPipeline } from '../../../packages/tailor/src/tailor-pipeline.ts';
import type { TailorStageKey, TailorTurn } from '../../../packages/tailor/src/tailor-pipeline.ts';
import type { TurnProgress } from '../../../packages/tailor/src/stage-tracker.ts';
import type { FactLike, ProposedChange, ResumeBlock } from '../../../packages/tailor/src/types.ts';
import type { JobRequirement } from '../../../packages/search/src/types.ts';
import { claimTask, completeTask, earlierTransmission, failTask, holdsLease, inTransaction, markDispatched, MAX_ATTEMPTS, withHeartbeat } from './lease.ts';
import type { LeaseDeps, LeasedTask } from './lease.ts';

// tailor_resume 작업: (JD 점검 요청 | 사용자 메시지) → 단계별 파이프라인(S1-18) → 답변 + 검증한 변경 제안 + 단계 요약 저장.
// - 대화 요청은 공고 스냅샷·확정 경력·base revision에 고정한다. 늦게 도착한 응답은 현재 문서를 바꾸지 않고 stale 제안으로 남긴다.
// - 근거 범위를 넘는 변경은 저장하지 않고 확인 질문으로 돌린다. 사실 확인 변경은 사용자 메시지 안의 문장만 허용한다.
// - 단계 경계마다 진행 기록을 세션에 남긴다(lease 확인). stages가 없으면 기존 단일 호출(②·④ 생략)로 동작한다.

export type TailorWorkerDeps = LeaseDeps & { provider: ChatProvider; stages?: TailorStageProvider; beforeComplete?: (task: LeasedTask) => void | Promise<void> };
export type TailorRunResult = 'idle' | 'succeeded' | 'failed' | 'lease_lost';
type Input = { session_id: string; message_id: string | null; base_resume_revision_id: string; base_content_hash: string; chat_provider_mode?: string };
type Job = { company_name: string; title: string; content_text: string; requirements: JobRequirement[]; content_source?: 'summary' | 'pasted' };
type Messages = { userMessage: string | null; history: ChatTurn[]; userMessages: { id: string; content: string }[] };
type Context = Messages & { input: Input; blocks: ResumeBlock[]; facts: FactLike[]; job: Job; checks: ChatRequirementCheck[] };
type Answer = { reply: string; changes: ProposedChange[]; questions: string[]; turn: TailorTurn };

const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;

// 사용자 문장 판정·제안 검사는 단계별 파이프라인(S1-18)과 함께 쓰도록 packages/tailor로 옮겼다. 기존 import 경로를 유지한다.
export { userSentenceFor, screenChanges };

function parseInput(json: string): Input | null {
  try {
    const input = JSON.parse(json) as Input;
    const message = input.message_id === null || typeof input.message_id === 'string';
    return typeof input.session_id === 'string' && message && typeof input.base_resume_revision_id === 'string' ? input : null;
  } catch { return null; }
}

// 대화 맥락: 이 메시지(JD 점검이면 요청 시점)까지의 기록. 근거 검토는 이 세션에서 사용자가 쓴 메시지만 근거로 본다.
function loadMessages(deps: TailorWorkerDeps, ws: string, input: Input): Messages | null {
  const rows = deps.db.prepare('SELECT id, role, content FROM ce7_messages WHERE workspace_id = ? AND session_id = ? ORDER BY created_at_ms, rowid').all(ws, input.session_id)
    .map(row => ({ id: String(row.id), role: row.role as ChatTurn['role'], content: String(row.content) }));
  const at = input.message_id === null ? rows.length : rows.findIndex(row => row.id === input.message_id && row.role === 'user');
  if (at < 0) return null;
  const upto = input.message_id === null ? rows : rows.slice(0, at + 1);
  return {
    userMessage: input.message_id === null ? null : rows[at].content,
    history: rows.slice(0, at).slice(-20).map(row => ({ role: row.role, content: row.content })),
    userMessages: upto.filter(row => row.role === 'user').map(row => ({ id: row.id, content: row.content })),
  };
}

function loadContext(deps: TailorWorkerDeps, task: LeasedTask): Context | string {
  const input = parseInput(task.inputJson);
  if (!input) return 'TASK_INPUT_INVALID';
  if (input.chat_provider_mode !== undefined && input.chat_provider_mode !== deps.provider.mode) return 'PROVIDER_MODE_MISMATCH';
  const { db } = deps;
  const ws = task.workspaceId;
  const session = db.prepare('SELECT job_snapshot_id, job_text FROM ce7_tailoring_sessions WHERE workspace_id = ? AND id = ?').get(ws, input.session_id);
  const base = db.prepare('SELECT blocks_json, content_hash, fact_revision_id FROM ce7_resume_revisions WHERE workspace_id = ? AND id = ? AND session_id = ?').get(ws, input.base_resume_revision_id, input.session_id);
  const messages = loadMessages(deps, ws, input);
  if (!session || !base || !messages) return 'TAILOR_CONTEXT_MISSING';
  if (base.content_hash !== input.base_content_hash) return 'BASE_REVISION_MISMATCH';
  const facts = db.prepare('SELECT facts_json FROM ce7_fact_revisions WHERE workspace_id = ? AND id = ?').get(ws, base.fact_revision_id);
  const job = db.prepare('SELECT company_name, title, content_text, requirements_json FROM ce7_job_snapshots WHERE workspace_id = ? AND id = ?').get(ws, session.job_snapshot_id);
  if (!facts || !job) return 'TAILOR_CONTEXT_MISSING';
  return {
    input, ...messages, blocks: JSON.parse(String(base.blocks_json)) as ResumeBlock[], facts: JSON.parse(String(facts.facts_json)) as FactLike[],
    // 붙여넣은 공고 본문이 있으면 그 글을 쓴다. 스냅샷의 요구 목록은 요약 기준이라 비우고 본문에서 다시 읽는다(S1-28).
    job: typeof session.job_text === 'string' && session.job_text
      ? { company_name: String(job.company_name), title: String(job.title), content_text: session.job_text, requirements: [], content_source: 'pasted' }
      : { company_name: String(job.company_name), title: String(job.title), content_text: String(job.content_text), requirements: JSON.parse(String(job.requirements_json)) as JobRequirement[] },
    checks: latestChecks(deps, ws, input.session_id),
  };
}

// 가장 최근 JD 점검의 요구사항 판정. 답변 턴의 수정안 작성이 어느 요구를 겨냥할지 정하는 자료로만 쓴다.
function latestChecks(deps: TailorWorkerDeps, ws: string, sessionId: string): ChatRequirementCheck[] {
  const rows = deps.db.prepare("SELECT result_json FROM ce7_messages WHERE workspace_id = ? AND session_id = ? AND role = 'assistant' AND result_json IS NOT NULL ORDER BY created_at_ms DESC, rowid DESC LIMIT 20").all(ws, sessionId);
  for (const row of rows) {
    try {
      const turn = JSON.parse(String(row.result_json)) as { kind?: string; requirements?: ChatRequirementCheck[] };
      if (turn.kind === 'jd_check' && Array.isArray(turn.requirements) && turn.requirements.length > 0) {
        return turn.requirements.map(item => ({ requirement: String(item.requirement), importance: item.importance, status: item.status, note: String(item.note ?? '') }));
      }
    } catch { /* 형식이 틀린 기록은 건너뛴다 */ }
  }
  return [];
}

// 진행 기록은 짧은 transaction으로 저장하고, lease를 잃었으면 저장하지 않는다(false → 파이프라인 중단).
function saveProgress(deps: TailorWorkerDeps, task: LeasedTask, sessionId: string, progress: TurnProgress<TailorStageKey>): boolean {
  return inTransaction(deps.db, () => {
    if (!holdsLease(deps, task)) return false;
    deps.db.prepare('UPDATE ce7_tailoring_sessions SET progress_json = ? WHERE workspace_id = ? AND id = ?').run(JSON.stringify(progress), task.workspaceId, sessionId);
    return true;
  });
}

export async function runTailorTask(deps: TailorWorkerDeps, taskId?: string): Promise<TailorRunResult> {
  const task = claimTask(deps, 'tailor_resume', taskId);
  if (!task) return 'idle';
  const earlier = earlierTransmission(task);
  const failWith = (code: string, transmission = earlier): TailorRunResult => failTask(deps, task, code, transmission) ? 'failed' : 'lease_lost';
  if (task.previousTransmission === 'dispatched' && deps.provider.mode === 'live') return failWith('PROVIDER_TRANSMISSION_UNKNOWN', 'unknown');
  if (task.generation > MAX_ATTEMPTS) return failWith('TAILOR_ATTEMPTS_EXCEEDED');
  const context = loadContext(deps, task);
  if (typeof context === 'string') return failWith(context);
  if (!markDispatched(deps, task)) return holdsLease(deps, task) ? failWith('CANCELED_BY_USER') : 'lease_lost';

  const result = await runTailorPipeline({
    chat: deps.provider, stages: deps.stages ?? null, taskId: task.taskId, now: deps.now,
    report: progress => saveProgress(deps, task, context.input.session_id, progress),
    invoke: work => withHeartbeat(deps, task, work),
    call: { workspaceId: task.workspaceId, taskId: task.taskId, leaseGeneration: task.generation },
  }, { job: context.job, facts: context.facts, blocks: context.blocks, history: context.history, message: context.userMessage, userMessages: context.userMessages, checks: context.checks });
  if (result.kind === 'lease_lost') return 'lease_lost';
  // live: provider가 알려 준 전송 상태를 남긴다(불명이면 재시도하지 않는다). 호출이 나가지 않았으면 이전 상태를 유지한다.
  if (result.kind === 'failed') return failWith(result.code, result.transmission === 'not_dispatched' ? earlier : result.transmission);
  // 턴은 성공했지만 근거 검토 호출이 불명이면 작업 전송 상태도 불명으로 남긴다.
  const sent = result.transmission === 'unknown' ? 'unknown' : 'completed';
  try {
    if (deps.beforeComplete) await deps.beforeComplete(task);
    return saveAnswer(deps, task, context, result, sent);
  } catch (error) {
    // 저장 중 예외로 작업이 running에 머물지 않게 한다(응답은 이미 받았음).
    console.error('TAILOR_SAVE_FAILED', error instanceof Error ? error.message : 'unknown');
    return failWith('TAILOR_SAVE_FAILED', sent);
  }
}

function saveAnswer(deps: TailorWorkerDeps, task: LeasedTask, context: Context, answer: Answer, sent: 'completed' | 'unknown'): TailorRunResult {
  return inTransaction(deps.db, () => {
    if (!holdsLease(deps, task)) return 'lease_lost';
    const now = deps.now();
    const ws = task.workspaceId;
    const messageId = newId('msg');
    deps.db.prepare("INSERT INTO ce7_messages (id, workspace_id, session_id, role, content, base_resume_revision_id, result_json, created_at_ms) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?)")
      .run(messageId, ws, context.input.session_id, answer.reply.trim() || '응답을 만들었어요.', context.input.base_resume_revision_id, JSON.stringify(answer.turn), now);
    let proposalId: string | null = null;
    const current = deps.db.prepare(`SELECT s.current_resume_revision_id AS id, r.state FROM ce7_tailoring_sessions s
      LEFT JOIN ce7_resume_revisions r ON r.workspace_id = s.workspace_id AND r.id = s.current_resume_revision_id WHERE s.workspace_id = ? AND s.id = ?`).get(ws, context.input.session_id);
    if (answer.changes.length) {
      proposalId = newId('proposal');
      // 응답을 만드는 동안 문서가 바뀌었으면 현재 문서를 건드리지 않고 다시 비교가 필요한 제안으로 남긴다.
      const state = current?.id === context.input.base_resume_revision_id ? 'proposed' : 'stale';
      deps.db.prepare('INSERT INTO ce7_edit_proposals (id, workspace_id, session_id, base_resume_revision_id, base_content_hash, changes_json, questions_json, state, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(proposalId, ws, context.input.session_id, context.input.base_resume_revision_id, context.input.base_content_hash, JSON.stringify(answer.changes), JSON.stringify(answer.questions), state, now);
    }
    // 현재 문서가 확정(final)이면 세션은 'ready'를 유지한다. 새 제안을 적용하면 새 draft가 생기며 editing이 된다.
    if (current?.state !== 'final') {
      const waiting = answer.questions.length > 0 || answer.changes.some(change => change.needs_fact_confirmation);
      deps.db.prepare("UPDATE ce7_tailoring_sessions SET state = ? WHERE workspace_id = ? AND id = ? AND state <> 'closed'").run(waiting ? 'waiting_user' : 'editing', ws, context.input.session_id);
    }
    completeTask(deps, task, 'succeeded', null, { assistant_message_id: messageId, proposal_id: proposalId, questions: answer.questions }, sent);
    return 'succeeded';
  });
}
