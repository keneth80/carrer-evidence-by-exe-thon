import type { DatabaseSync } from 'node:sqlite';
import { baseBlocks, blocksCanonical } from '../../../../packages/tailor/src/blocks.ts';
import type { FactLike } from '../../../../packages/tailor/src/types.ts';
import { isPlainObject, newId, problem, readJson, sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import type { Config } from '../config.ts';
import { idempotentWrite, readIdempotencyKey } from '../idempotency.ts';
import { getDocument, getFactRevision, getTask, taskBody } from '../resume/repository.ts';
import { getJobSnapshot } from '../search/repository.ts';
import {
  getMessage, getRevision, getSession, insertRevision, listMessages, messageBody, nextRevisionNumber, revisionBlocks, revisionBody, sessionBody,
} from './repository.ts';

// S04 편집 세션: 공고 스냅샷 + 확정 경력 revision + 기본 이력서 revision을 고정하고, 대화 메시지를 영속 작업으로 넘긴다.
// API는 대화 모델을 호출하지 않는다. tailor_resume 작업은 apps/worker가 lease로 실행한다.

export type TailorDeps = { db: DatabaseSync; config: Config };
export const MESSAGE_LIMIT = 2000;
export const contentHash = (blocks: unknown) => sha256Hex(blocksCanonical(blocks as never));

const sessionNotFound = (request: ProductRequest) => problem(request, 404, 'TAILORING_SESSION_NOT_FOUND', '편집 세션을 찾을 수 없습니다.');

function parseBody(request: ProductRequest, limit: number, keys: string): { ok: true; value: Record<string, unknown> } | { ok: false; reply: Reply } {
  const parsed = readJson(request, limit);
  if (!parsed.ok) return parsed;
  if (!isPlainObject(parsed.value) || Object.keys(parsed.value).sort().join() !== keys) {
    return { ok: false, reply: problem(request, 400, 'REQUEST_INVALID', `요청 본문에는 ${keys.split(',').join(', ')}가 필요합니다.`) };
  }
  return { ok: true, value: parsed.value };
}

export function createTailoringSession(deps: TailorDeps, request: ProductRequest, principal: Principal): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const body = parseBody(request, deps.config.limits.jsonBodyBytes, 'fact_revision_id,job_snapshot_id');
  if (!body.ok) return body.reply;
  const { job_snapshot_id: jobId, fact_revision_id: factRevisionId } = body.value;
  if (typeof jobId !== 'string' || typeof factRevisionId !== 'string') return problem(request, 400, 'REQUEST_INVALID', 'ID는 문자열이어야 합니다.');
  const { db } = deps;
  const job = getJobSnapshot(db, principal.workspaceId, jobId);
  if (!job) return problem(request, 404, 'JOB_SNAPSHOT_NOT_FOUND', '공고를 찾을 수 없습니다.');
  const factRevision = getFactRevision(db, principal.workspaceId, factRevisionId);
  if (!factRevision) return problem(request, 404, 'FACT_REVISION_NOT_FOUND', '확정 경력을 찾을 수 없습니다.');
  const facts = JSON.parse(factRevision.facts_json) as FactLike[];
  const blocks = baseBlocks(facts);
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, jobId, factRevisionId]));

  return idempotentWrite(db, request, principal.workspaceId, 'create_tailoring_session', key.key, requestHash, () => {
    const current = getDocument(db, principal.workspaceId, factRevision.document_id)?.current_fact_revision_id ?? null;
    if (current !== factRevisionId) return problem(request, 409, 'FACT_REVISION_NOT_CURRENT', '경력이 새 버전으로 저장되었습니다. 최신 경력으로 다시 검색한 뒤 시작하세요.', { current_revision_id: current });
    const now = request.nowMs;
    const sessionId = newId('tailor');
    db.prepare("INSERT INTO ce7_tailoring_sessions (id, workspace_id, job_snapshot_id, fact_revision_id, current_resume_revision_id, revision, state, created_at_ms) VALUES (?, ?, ?, ?, NULL, 0, 'editing', ?)")
      .run(sessionId, principal.workspaceId, jobId, factRevisionId, now);
    // 첫 revision은 확정 경력 문장을 그대로 옮긴 기본 이력서다.
    insertRevision(db, { id: newId('resume'), workspace_id: principal.workspaceId, session_id: sessionId, job_snapshot_id: jobId, fact_revision_id: factRevisionId,
      revision: 1, parent_revision_id: null, blocks_json: JSON.stringify(blocks), content_hash: contentHash(blocks), created_at_ms: now });
    const saved = getSession(db, principal.workspaceId, sessionId);
    return { status: 201, body: saved ? sessionBody(saved) : null };
  });
}

export function getTailoringSession(deps: TailorDeps, request: ProductRequest, principal: Principal, sessionId: string): Reply {
  const session = getSession(deps.db, principal.workspaceId, sessionId);
  return session ? { status: 200, body: sessionBody(session) } : sessionNotFound(request);
}

export function listTailoringMessages(deps: TailorDeps, request: ProductRequest, principal: Principal, sessionId: string): Reply {
  if (!getSession(deps.db, principal.workspaceId, sessionId)) return sessionNotFound(request);
  return { status: 200, body: { items: listMessages(deps.db, principal.workspaceId, sessionId).map(messageBody), next_cursor: null } };
}

function pendingTask(db: DatabaseSync, workspaceId: string, sessionId: string) {
  return db.prepare("SELECT id FROM ce7_tasks WHERE workspace_id = ? AND kind = 'tailor_resume' AND state IN ('queued','running') AND json_extract(input_json, '$.session_id') = ? LIMIT 1").get(workspaceId, sessionId);
}

function enqueueTailor(deps: TailorDeps, principal: Principal, input: Record<string, unknown>, now: number) {
  const taskId = newId('task');
  const inputJson = JSON.stringify({ ...input, chat_provider_mode: deps.config.chatMode });
  deps.db.prepare(`INSERT INTO ce7_tasks (id, workspace_id, kind, state, input_json, input_hash, result_json, error_code, cancel_requested, provider_transmission, lease_owner, lease_generation, lease_until_ms, available_at_ms, created_at_ms, updated_at_ms)
    VALUES (?, ?, 'tailor_resume', 'queued', ?, ?, NULL, NULL, 0, 'not_dispatched', NULL, 0, NULL, ?, ?, ?)`).run(taskId, principal.workspaceId, inputJson, sha256Hex(inputJson), now, now, now);
  return getTask(deps.db, principal.workspaceId, taskId);
}

// 사용자 메시지를 먼저 저장하고 응답 생성 작업을 만든다. 화면이 본 revision이 현재와 다르면 거절한다.
export function postTailoringMessage(deps: TailorDeps, request: ProductRequest, principal: Principal, sessionId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const body = parseBody(request, deps.config.limits.jsonBodyBytes, 'content,expected_resume_revision_id');
  if (!body.ok) return body.reply;
  const { content, expected_resume_revision_id: expected } = body.value;
  if (typeof content !== 'string' || !content.trim() || content.length > MESSAGE_LIMIT) return problem(request, 400, 'MESSAGE_INVALID', `메시지는 1~${MESSAGE_LIMIT}자입니다.`);
  if (expected !== null && typeof expected !== 'string') return problem(request, 400, 'REQUEST_INVALID', 'expected_resume_revision_id가 필요합니다.');
  const { db } = deps;
  const session = getSession(db, principal.workspaceId, sessionId);
  if (!session) return sessionNotFound(request);
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, content.trim(), expected]));

  return idempotentWrite(db, request, principal.workspaceId, 'post_tailoring_message', key.key, requestHash, () => {
    const fresh = getSession(db, principal.workspaceId, sessionId)!;
    if (fresh.state === 'closed') return problem(request, 409, 'TAILORING_SESSION_CLOSED', '닫힌 편집 세션입니다.');
    if (fresh.current_resume_revision_id !== expected) return problem(request, 409, 'RESUME_REVISION_CONFLICT', '다른 변경이 있어 최신 문서를 다시 불러와야 합니다.', { current_resume_revision_id: fresh.current_resume_revision_id });
    // 응답 순서를 지키기 위해 세션당 한 번에 하나의 응답만 생성한다.
    if (pendingTask(db, principal.workspaceId, sessionId)) return problem(request, 409, 'RESPONSE_PENDING', '이전 메시지의 응답을 만드는 중입니다. 잠시 후 보내 주세요.');
    const base = getRevision(db, principal.workspaceId, fresh.current_resume_revision_id ?? '');
    if (!base) return problem(request, 409, 'RESUME_REVISION_MISSING', '편집할 문서가 없습니다.');
    const now = request.nowMs;
    const messageId = newId('msg');
    db.prepare("INSERT INTO ce7_messages (id, workspace_id, session_id, role, content, base_resume_revision_id, created_at_ms) VALUES (?, ?, ?, 'user', ?, ?, ?)")
      .run(messageId, principal.workspaceId, sessionId, content.trim(), base.id, now);
    const task = enqueueTailor(deps, principal, { session_id: sessionId, message_id: messageId, base_resume_revision_id: base.id, base_content_hash: base.content_hash }, now);
    return { status: 202, body: { task: task ? taskBody(task) : null, resource_id: messageId } };
  });
}

// JD 맞춤 점검(S1-18): 사용자 메시지 없이 ① 요구사항 대조 → ② AI 점검 작업을 만든다. 문서는 바꾸지 않고 질문만 낸다.
export function requestJdCheck(deps: TailorDeps, request: ProductRequest, principal: Principal, sessionId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const body = parseBody(request, deps.config.limits.jsonBodyBytes, 'expected_resume_revision_id');
  if (!body.ok) return body.reply;
  const expected = body.value.expected_resume_revision_id;
  if (typeof expected !== 'string') return problem(request, 400, 'REQUEST_INVALID', 'expected_resume_revision_id가 필요합니다.');
  const { db } = deps;
  if (!getSession(db, principal.workspaceId, sessionId)) return sessionNotFound(request);
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, expected]));
  return idempotentWrite(db, request, principal.workspaceId, 'request_jd_check', key.key, requestHash, () => {
    const fresh = getSession(db, principal.workspaceId, sessionId)!;
    if (fresh.state === 'closed') return problem(request, 409, 'TAILORING_SESSION_CLOSED', '닫힌 편집 세션입니다.');
    if (fresh.current_resume_revision_id !== expected) return problem(request, 409, 'RESUME_REVISION_CONFLICT', '다른 변경이 있어 최신 문서를 다시 불러와야 합니다.', { current_resume_revision_id: fresh.current_resume_revision_id });
    if (pendingTask(db, principal.workspaceId, sessionId)) return problem(request, 409, 'RESPONSE_PENDING', '이전 요청의 응답을 만드는 중입니다. 잠시 후 다시 요청해 주세요.');
    const base = getRevision(db, principal.workspaceId, expected);
    if (!base) return problem(request, 409, 'RESUME_REVISION_MISSING', '점검할 문서가 없습니다.');
    const task = enqueueTailor(deps, principal, { session_id: sessionId, message_id: null, base_resume_revision_id: base.id, base_content_hash: base.content_hash }, request.nowMs);
    return { status: 202, body: { task: task ? taskBody(task) : null, resource_id: sessionId } };
  });
}

// 공고 본문 붙여넣기(DECISIONS S1-28): 실시간 검색 공고는 요약만 있어 요구사항을 제대로 읽지 못한다.
// 본문은 세션에만 둔다(공고 스냅샷은 그대로). 다음 JD 점검·수정 턴부터 이 본문을 쓴다. 본문은 자료이며 지시가 아니다.
export const JOB_TEXT_LIMITS = { min: 50, max: 20000 } as const;
export function putSessionJobText(deps: TailorDeps, request: ProductRequest, principal: Principal, sessionId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const body = parseBody(request, deps.config.limits.jsonBodyBytes, 'content_text');
  if (!body.ok) return body.reply;
  const raw = body.value.content_text;
  if (typeof raw !== 'string') return problem(request, 400, 'REQUEST_INVALID', 'content_text는 문자열이어야 합니다.');
  // 제어 문자는 빼고 줄바꿈은 살린다(요구사항 목록의 줄 구분).
  const text = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < JOB_TEXT_LIMITS.min || text.length > JOB_TEXT_LIMITS.max) return problem(request, 400, 'JOB_TEXT_LENGTH', `공고 본문은 ${JOB_TEXT_LIMITS.min}자 이상 ${JOB_TEXT_LIMITS.max}자 이하로 붙여넣어 주세요.`);
  const { db } = deps;
  if (!getSession(db, principal.workspaceId, sessionId)) return sessionNotFound(request);
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, text]));
  return idempotentWrite(db, request, principal.workspaceId, 'put_session_job_text', key.key, requestHash, () => {
    const fresh = getSession(db, principal.workspaceId, sessionId)!;
    if (fresh.state === 'closed') return problem(request, 409, 'TAILORING_SESSION_CLOSED', '닫힌 편집 세션입니다.');
    if (pendingTask(db, principal.workspaceId, sessionId)) return problem(request, 409, 'RESPONSE_PENDING', '이전 요청의 응답을 만드는 중입니다. 잠시 후 다시 요청해 주세요.');
    db.prepare('UPDATE ce7_tailoring_sessions SET job_text = ? WHERE workspace_id = ? AND id = ?').run(text, principal.workspaceId, sessionId);
    return { status: 200, body: sessionBody(getSession(db, principal.workspaceId, sessionId)!) };
  });
}

// 응답 생성에 실패한 메시지만 다시 처리한다. 사용자 메시지·문서는 그대로 둔다.
export function retryTailoringMessage(deps: TailorDeps, request: ProductRequest, principal: Principal, sessionId: string, messageId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const { db } = deps;
  const session = getSession(db, principal.workspaceId, sessionId);
  const message = getMessage(db, principal.workspaceId, messageId);
  if (!session || !message || message.session_id !== sessionId || message.role !== 'user') return problem(request, 404, 'MESSAGE_NOT_FOUND', '메시지를 찾을 수 없습니다.');
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname]));
  return idempotentWrite(db, request, principal.workspaceId, 'retry_tailoring_message', key.key, requestHash, () => {
    const latestUser = db.prepare("SELECT id FROM ce7_messages WHERE workspace_id = ? AND session_id = ? AND role = 'user' ORDER BY created_at_ms DESC, rowid DESC LIMIT 1").get(principal.workspaceId, sessionId);
    // 이전 메시지를 다시 처리하면 답변 순서가 꼬이고 제안은 항상 stale이 되므로 마지막 메시지만 허용한다.
    if (latestUser?.id !== messageId) return problem(request, 409, 'RETRY_NOT_LATEST', '마지막으로 보낸 메시지만 다시 시도할 수 있습니다.');
    const last = db.prepare("SELECT state FROM ce7_tasks WHERE workspace_id = ? AND kind = 'tailor_resume' AND json_extract(input_json, '$.message_id') = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 1").get(principal.workspaceId, messageId);
    if (last?.state !== 'failed') return problem(request, 409, 'RETRY_NOT_NEEDED', '실패한 응답만 다시 시도할 수 있습니다.', { state: last?.state ?? null });
    if (pendingTask(db, principal.workspaceId, sessionId)) return problem(request, 409, 'RESPONSE_PENDING', '다른 응답을 만드는 중입니다.');
    const base = getRevision(db, principal.workspaceId, message.base_resume_revision_id ?? '');
    if (!base) return problem(request, 409, 'RESUME_REVISION_MISSING', '메시지의 기준 문서가 없습니다.');
    const task = enqueueTailor(deps, principal, { session_id: sessionId, message_id: messageId, base_resume_revision_id: base.id, base_content_hash: base.content_hash }, request.nowMs);
    return { status: 202, body: { task: task ? taskBody(task) : null, resource_id: messageId } };
  });
}

// 이전 revision 내용을 새 revision으로 복원한다. 기록은 지우지 않는다.
export function restoreResumeRevision(deps: TailorDeps, request: ProductRequest, principal: Principal, sessionId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const body = parseBody(request, deps.config.limits.jsonBodyBytes, 'expected_resume_revision_id,source_revision_id');
  if (!body.ok) return body.reply;
  const { source_revision_id: sourceId, expected_resume_revision_id: expected } = body.value;
  if (typeof sourceId !== 'string' || typeof expected !== 'string') return problem(request, 400, 'REQUEST_INVALID', 'source_revision_id와 expected_resume_revision_id가 필요합니다.');
  const { db } = deps;
  const session = getSession(db, principal.workspaceId, sessionId);
  const source = getRevision(db, principal.workspaceId, sourceId);
  if (!session || !source || source.session_id !== sessionId) return problem(request, 404, 'RESUME_REVISION_NOT_FOUND', '복원할 버전을 찾을 수 없습니다.');
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, sourceId, expected]));
  return idempotentWrite(db, request, principal.workspaceId, 'restore_resume_revision', key.key, requestHash, () => {
    const fresh = getSession(db, principal.workspaceId, sessionId)!;
    if (fresh.current_resume_revision_id !== expected) return problem(request, 409, 'RESUME_REVISION_CONFLICT', '다른 변경이 있어 최신 문서를 다시 불러와야 합니다.', { current_resume_revision_id: fresh.current_resume_revision_id });
    if (sourceId === expected) return problem(request, 409, 'RESTORE_SAME_REVISION', '이미 현재 버전입니다.');
    const id = newId('resume');
    const blocks = revisionBlocks(source);
    insertRevision(db, { id, workspace_id: principal.workspaceId, session_id: sessionId, job_snapshot_id: fresh.job_snapshot_id, fact_revision_id: source.fact_revision_id,
      revision: nextRevisionNumber(db, principal.workspaceId, sessionId), parent_revision_id: expected, blocks_json: JSON.stringify(blocks), content_hash: contentHash(blocks), created_at_ms: request.nowMs });
    db.prepare("UPDATE ce7_edit_proposals SET state = 'stale' WHERE workspace_id = ? AND session_id = ? AND state = 'proposed'").run(principal.workspaceId, sessionId);
    const saved = getRevision(db, principal.workspaceId, id);
    return { status: 201, body: saved ? revisionBody(saved) : null };
  });
}

// 이 세션의 최근 대화·렌더 작업. 화면이 새로고침 뒤에도 '응답 생성 중'과 '실패(다시 시도)'를 구분하는 데 쓴다.
export function listSessionTasks(deps: TailorDeps, request: ProductRequest, principal: Principal, sessionId: string): Reply {
  if (!getSession(deps.db, principal.workspaceId, sessionId)) return sessionNotFound(request);
  const rows = deps.db.prepare(`SELECT * FROM ce7_tasks WHERE workspace_id = ? AND (
      (kind = 'tailor_resume' AND json_extract(input_json, '$.session_id') = ?)
      OR (kind = 'render_resume' AND json_extract(input_json, '$.resume_revision_id') IN (SELECT id FROM ce7_resume_revisions WHERE workspace_id = ? AND session_id = ?)))
    ORDER BY created_at_ms DESC, rowid DESC LIMIT 50`).all(principal.workspaceId, sessionId, principal.workspaceId, sessionId);
  return { status: 200, body: { items: rows.map(row => taskBody(row as never)) } };
}
