import { randomUUID } from 'node:crypto';
import { patternsFor } from '../../../packages/tailor/src/patterns.ts';
import type { ChatTurn } from '../../../packages/tailor/src/provider.ts';
import { runSupplementPipeline } from '../../../packages/tailor/src/supplement-pipeline.ts';
import type { PipelineMode, TurnProgress } from '../../../packages/tailor/src/supplement-pipeline.ts';
import type { SupplementProvider, SupplementTurn, UserMessage } from '../../../packages/tailor/src/supplement.ts';
import type { FactLike } from '../../../packages/tailor/src/types.ts';
import { claimTask, completeTask, earlierTransmission, holdsLease, inTransaction, markDispatched, MAX_ATTEMPTS, withHeartbeat } from './lease.ts';
import type { LeaseDeps, LeasedTask, Transmission } from './lease.ts';

// supplement_resume 작업(DECISIONS S1-16·S1-17): 보완 대화 한 턴 = (첫 턴이면 점검·질문 | 사용자 답변이면 후보·초안·질문).
// 한 턴은 단계별 파이프라인(supplement-pipeline.ts)으로 실행하고, 단계 경계마다 진행 기록을 세션에 남겨 화면이 보여 준다.
// 확정 경력은 바꾸지 않는다. 후보는 사용자 메시지 문장만 남긴다. live 호출이 나간 뒤 lease를 잃고 다시 집히면 재전송하지 않고 불명으로 끝낸다.

// pipeline: staged(기본, 단계별 호출) | single(비교용 한 번 호출, SUPPLEMENT_PIPELINE=single).
export type SupplementWorkerDeps = LeaseDeps & { provider: SupplementProvider; pipeline?: PipelineMode };
export type SupplementRunResult = 'idle' | 'succeeded' | 'failed' | 'lease_lost';
type Input = { session_id: string; message_id: string | null; chat_provider_mode?: string };
type Context = { facts: FactLike[]; userMessages: UserMessage[]; history: ChatTurn[]; message: string | null };

const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;

// 대화 맥락은 문서의 '현재' 확정 경력이다. 대화 중 후보를 경력에 추가하면 다음 턴부터 그 사실을 이미 있는 것으로 본다.
function loadContext(deps: SupplementWorkerDeps, task: LeasedTask, input: Input): Context | string {
  const { db } = deps;
  const ws = task.workspaceId;
  const session = db.prepare('SELECT s.fact_revision_id, d.current_fact_revision_id FROM ce8_supplement_sessions s JOIN ce7_documents d ON d.workspace_id = s.workspace_id AND d.id = s.document_id WHERE s.workspace_id = ? AND s.id = ?').get(ws, input.session_id);
  if (!session) return 'SUPPLEMENT_CONTEXT_MISSING';
  const revisionId = String(session.current_fact_revision_id ?? session.fact_revision_id);
  const facts = db.prepare('SELECT facts_json FROM ce7_fact_revisions WHERE workspace_id = ? AND id = ?').get(ws, revisionId);
  if (!facts) return 'FACT_REVISION_NOT_FOUND';
  const rows = db.prepare('SELECT id, role, content FROM ce8_supplement_messages WHERE workspace_id = ? AND session_id = ? ORDER BY created_at_ms, rowid').all(ws, input.session_id)
    .map(row => ({ id: String(row.id), role: row.role as ChatTurn['role'], content: String(row.content) }));
  const at = input.message_id === null ? rows.length : rows.findIndex(row => row.id === input.message_id && row.role === 'user');
  if (at < 0) return 'SUPPLEMENT_CONTEXT_MISSING';
  const upto = input.message_id === null ? rows : rows.slice(0, at + 1);
  return {
    facts: JSON.parse(String(facts.facts_json)) as FactLike[],
    userMessages: upto.filter(row => row.role === 'user').map(row => ({ id: row.id, content: row.content })),
    history: rows.slice(0, input.message_id === null ? rows.length : at).slice(-20).map(row => ({ role: row.role, content: row.content })),
    message: input.message_id === null ? null : rows[at].content,
  };
}

function finish(deps: SupplementWorkerDeps, task: LeasedTask, sessionId: string, outcome: { ok: true; turn: SupplementTurn } | { ok: false; code: string }, transmission: Transmission): SupplementRunResult {
  return inTransaction(deps.db, () => {
    if (!holdsLease(deps, task)) return 'lease_lost';
    const now = deps.now();
    if (!outcome.ok) {
      completeTask(deps, task, 'failed', outcome.code, null, transmission);
      return 'failed';
    }
    const messageId = newId('smsg');
    deps.db.prepare("INSERT INTO ce8_supplement_messages (id, workspace_id, session_id, role, content, result_json, task_id, created_at_ms) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?)")
      .run(messageId, task.workspaceId, sessionId, outcome.turn.reply, JSON.stringify(outcome.turn), task.taskId, now);
    deps.db.prepare('UPDATE ce8_supplement_sessions SET updated_at_ms = ? WHERE workspace_id = ? AND id = ?').run(now, task.workspaceId, sessionId);
    completeTask(deps, task, 'succeeded', null, { assistant_message_id: messageId, candidates: outcome.turn.candidates.length }, transmission);
    return 'succeeded';
  });
}

// 진행 기록은 짧은 transaction으로 저장하고, lease를 잃었으면 저장하지 않는다(false → 파이프라인 중단).
function saveProgress(deps: SupplementWorkerDeps, task: LeasedTask, sessionId: string, progress: TurnProgress): boolean {
  return inTransaction(deps.db, () => {
    if (!holdsLease(deps, task)) return false;
    deps.db.prepare('UPDATE ce8_supplement_sessions SET progress_json = ?, updated_at_ms = ? WHERE workspace_id = ? AND id = ?')
      .run(JSON.stringify(progress), deps.now(), task.workspaceId, sessionId);
    return true;
  });
}

function parseInput(json: string): Input | null {
  try {
    const input = JSON.parse(json) as Input;
    return typeof input.session_id === 'string' && input.session_id && (input.message_id === null || typeof input.message_id === 'string') ? input : null;
  } catch { return null; }
}

export async function runSupplementTask(deps: SupplementWorkerDeps, taskId?: string): Promise<SupplementRunResult> {
  const task = claimTask(deps, 'supplement_resume', taskId);
  if (!task) return 'idle';
  const input = parseInput(task.inputJson);
  const fail = (code: string, transmission: Transmission = earlierTransmission(task)) => finish(deps, task, input?.session_id ?? '', { ok: false, code }, transmission);
  if (!input) return fail('TASK_INPUT_INVALID');
  if (input.chat_provider_mode !== undefined && input.chat_provider_mode !== deps.provider.mode) return fail('PROVIDER_MODE_MISMATCH');
  if (task.previousTransmission === 'dispatched' && deps.provider.mode === 'live') return fail('PROVIDER_TRANSMISSION_UNKNOWN', 'unknown');
  if (task.generation > MAX_ATTEMPTS) return fail('SUPPLEMENT_ATTEMPTS_EXCEEDED');
  const context = loadContext(deps, task, input);
  if (typeof context === 'string') return fail(context);
  if (!markDispatched(deps, task)) return holdsLease(deps, task) ? fail('CANCELED_BY_USER') : 'lease_lost';

  const patterns = patternsFor(context.facts.filter(fact => fact.category === 'role').map(fact => fact.statement));
  const result = await runSupplementPipeline({
    provider: deps.provider, mode: deps.pipeline ?? 'staged', taskId: task.taskId, now: deps.now,
    report: progress => saveProgress(deps, task, input.session_id, progress),
    invoke: work => withHeartbeat(deps, task, work),
    call: { workspaceId: task.workspaceId, taskId: task.taskId, leaseGeneration: task.generation },
  }, { facts: context.facts, patterns, history: context.history, message: context.message, userMessages: context.userMessages });
  if (result.kind === 'lease_lost') return 'lease_lost';
  const transmission = result.transmission === 'not_dispatched' ? earlierTransmission(task) : result.transmission;
  if (result.kind === 'failed') return fail(result.code, transmission);
  return finish(deps, task, input.session_id, { ok: true, turn: result.turn }, transmission);
}
