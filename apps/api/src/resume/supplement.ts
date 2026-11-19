import type { DatabaseSync } from 'node:sqlite';
import { iso, isPlainObject, newId, problem, readJson, sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import type { Config } from '../config.ts';
import { idempotentWrite, readIdempotencyKey } from '../idempotency.ts';
import { getDocument, getFactRevision, getTask, taskBody } from './repository.ts';
import type { TaskRow } from './repository.ts';

// 기본 이력서 보완 대화(DECISIONS S1-16). 세션은 문서의 현재 확정 경력 버전에서만 시작하고, 각 턴은 supplement_resume 작업이다.
// API는 모델을 호출하지 않는다. 대화는 경력 사실이 아니며, 사용자 메시지만 기존 확정 API(POST fact-revisions)의 user_statement 근거가 된다.

export type SupplementDeps = { db: DatabaseSync; config: Config };
export const SUPPLEMENT_MESSAGE_LIMIT = 2000;

type SessionRow = { id: string; workspace_id: string; document_id: string; fact_revision_id: string; provider_mode: 'mock' | 'live'; state: 'open' | 'closed'; progress_json: string | null; created_at_ms: number; updated_at_ms: number };
type MessageRow = { id: string; role: 'user' | 'assistant'; content: string; result_json: string | null; created_at_ms: number };

const sessionNotFound = (request: ProductRequest) => problem(request, 404, 'SUPPLEMENT_SESSION_NOT_FOUND', '보완 대화를 찾을 수 없습니다.');

function getSession(db: DatabaseSync, workspaceId: string, sessionId: string): SessionRow | undefined {
  return db.prepare('SELECT * FROM ce8_supplement_sessions WHERE workspace_id = ? AND id = ?').get(workspaceId, sessionId) as SessionRow | undefined;
}

function latestTask(db: DatabaseSync, workspaceId: string, sessionId: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM ce7_tasks WHERE workspace_id = ? AND kind = 'supplement_resume' AND json_extract(input_json, '$.session_id') = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 1")
    .get(workspaceId, sessionId) as TaskRow | undefined;
}

// 세션당 한 번에 한 턴만 만든다(응답 순서를 지키고 유료 호출이 겹치지 않게, S4-02와 같은 규칙).
function hasPending(db: DatabaseSync, workspaceId: string, sessionId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM ce7_tasks WHERE workspace_id = ? AND kind = 'supplement_resume' AND state IN ('queued','running') AND json_extract(input_json, '$.session_id') = ? LIMIT 1").get(workspaceId, sessionId));
}

function enqueueTurn(deps: SupplementDeps, workspaceId: string, sessionId: string, messageId: string | null, now: number): TaskRow | undefined {
  const taskId = newId('task');
  const inputJson = JSON.stringify({ session_id: sessionId, message_id: messageId, chat_provider_mode: deps.config.chatMode });
  deps.db.prepare(`INSERT INTO ce7_tasks (id, workspace_id, kind, state, input_json, input_hash, result_json, error_code, cancel_requested, provider_transmission, lease_owner, lease_generation, lease_until_ms, available_at_ms, created_at_ms, updated_at_ms)
    VALUES (?, ?, 'supplement_resume', 'queued', ?, ?, NULL, NULL, 0, 'not_dispatched', NULL, 0, NULL, ?, ?, ?)`).run(taskId, workspaceId, inputJson, sha256Hex(inputJson), now, now, now);
  return getTask(deps.db, workspaceId, taskId);
}

function messageBody(row: MessageRow) {
  return { id: row.id, role: row.role, content: row.content, turn: row.result_json ? JSON.parse(row.result_json) : null, created_at: iso(row.created_at_ms) };
}

export function createSupplementSession(deps: SupplementDeps, request: ProductRequest, principal: Principal, revisionId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  if (!isPlainObject(parsed.value) || Object.keys(parsed.value).length > 0) return problem(request, 400, 'REQUEST_INVALID', '요청 본문은 빈 객체({})입니다.');
  const { db } = deps;
  const revision = getFactRevision(db, principal.workspaceId, revisionId);
  if (!revision) return problem(request, 404, 'FACT_REVISION_NOT_FOUND', '확정 경력을 찾을 수 없습니다.');
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname]));
  return idempotentWrite(db, request, principal.workspaceId, 'create_supplement_session', key.key, requestHash, () => {
    // 오래된 버전으로 보완을 시작하면 이미 바뀐 경력을 다시 묻게 된다. 현재 버전에서만 시작한다.
    const current = getDocument(db, principal.workspaceId, revision.document_id)?.current_fact_revision_id ?? null;
    if (current !== revisionId) return problem(request, 409, 'FACT_REVISION_NOT_CURRENT', '최신 확정 경력에서만 보완 대화를 시작할 수 있습니다.', { current_revision_id: current });
    const now = request.nowMs;
    const sessionId = newId('supplement');
    db.prepare("INSERT INTO ce8_supplement_sessions (id, workspace_id, document_id, fact_revision_id, provider_mode, state, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)")
      .run(sessionId, principal.workspaceId, revision.document_id, revisionId, deps.config.chatMode, now, now);
    const task = enqueueTurn(deps, principal.workspaceId, sessionId, null, now);
    return { status: 202, body: { task: task ? taskBody(task) : null, resource_id: sessionId } };
  });
}

export function getSupplementSession(deps: SupplementDeps, request: ProductRequest, principal: Principal, sessionId: string): Reply {
  const { db } = deps;
  const session = getSession(db, principal.workspaceId, sessionId);
  if (!session) return sessionNotFound(request);
  const head = getDocument(db, principal.workspaceId, session.document_id)?.current_fact_revision_id ?? null;
  const messages = db.prepare('SELECT id, role, content, result_json, created_at_ms FROM ce8_supplement_messages WHERE workspace_id = ? AND session_id = ? ORDER BY created_at_ms, rowid')
    .all(principal.workspaceId, sessionId) as MessageRow[];
  const task = latestTask(db, principal.workspaceId, sessionId);
  return {
    status: 200,
    body: {
      id: session.id, workspace_id: session.workspace_id, document_id: session.document_id, fact_revision_id: session.fact_revision_id, head_fact_revision_id: head,
      provider_mode: session.provider_mode, state: session.state, messages: messages.map(messageBody), latest_task: task ? taskBody(task) : null,
      // 최근 턴의 단계별 진행 기록(S1-17). progress.task_id가 latest_task.id와 같을 때만 그 턴의 진행이다.
      progress: session.progress_json ? JSON.parse(session.progress_json) : null,
      created_at: iso(session.created_at_ms), updated_at: iso(session.updated_at_ms),
    },
  };
}

// 사용자 메시지를 먼저 저장하고 응답 작업을 만든다. 이 메시지가 이후 경력 후보의 근거(user_statement)가 된다.
export function postSupplementMessage(deps: SupplementDeps, request: ProductRequest, principal: Principal, sessionId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  if (!isPlainObject(parsed.value) || Object.keys(parsed.value).join() !== 'content') return problem(request, 400, 'REQUEST_INVALID', '요청 본문에는 content만 있어야 합니다.');
  const { content } = parsed.value;
  if (typeof content !== 'string' || !content.trim() || content.length > SUPPLEMENT_MESSAGE_LIMIT) return problem(request, 400, 'MESSAGE_INVALID', `메시지는 1~${SUPPLEMENT_MESSAGE_LIMIT}자입니다.`);
  const { db } = deps;
  if (!getSession(db, principal.workspaceId, sessionId)) return sessionNotFound(request);
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, content.trim()]));
  return idempotentWrite(db, request, principal.workspaceId, 'post_supplement_message', key.key, requestHash, () => {
    if (getSession(db, principal.workspaceId, sessionId)?.state === 'closed') return problem(request, 409, 'SUPPLEMENT_SESSION_CLOSED', '닫힌 보완 대화입니다.');
    if (hasPending(db, principal.workspaceId, sessionId)) return problem(request, 409, 'RESPONSE_PENDING', '이전 응답을 만드는 중입니다. 잠시 후 보내 주세요.');
    const now = request.nowMs;
    const messageId = newId('smsg');
    db.prepare("INSERT INTO ce8_supplement_messages (id, workspace_id, session_id, role, content, result_json, task_id, created_at_ms) VALUES (?, ?, ?, 'user', ?, NULL, NULL, ?)")
      .run(messageId, principal.workspaceId, sessionId, content.trim(), now);
    db.prepare('UPDATE ce8_supplement_sessions SET updated_at_ms = ? WHERE workspace_id = ? AND id = ?').run(now, principal.workspaceId, sessionId);
    const task = enqueueTurn(deps, principal.workspaceId, sessionId, messageId, now);
    return { status: 202, body: { task: task ? taskBody(task) : null, resource_id: messageId } };
  });
}
