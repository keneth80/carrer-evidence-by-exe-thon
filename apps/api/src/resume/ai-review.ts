import type { DatabaseSync } from 'node:sqlite';
import { iso, isPlainObject, newId, problem, readJson, sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import type { Config } from '../config.ts';
import { idempotentWrite, readIdempotencyKey } from '../idempotency.ts';
import { getFactRevision, getTask, taskBody } from './repository.ts';

// AI 1차 점검(DECISIONS S1-14): 확정 경력 한 버전에 대한 review_resume 작업을 만들고 결과를 돌려준다.
// 결과는 안내·질문이며 확정 경력을 바꾸지 않는다. 같은 버전에 진행 중인 점검이 있으면 새로 만들지 않는다(유료 호출 중복 방지).

export type AiReviewDeps = { db: DatabaseSync; config: Config };
type ReviewRow = { id: string; workspace_id: string; fact_revision_id: string; task_id: string; provider_mode: 'mock' | 'live'; state: 'queued' | 'succeeded' | 'failed'; result_json: string | null; error_code: string | null; created_at_ms: number; updated_at_ms: number };

export function reviewBody(row: ReviewRow) {
  const result = row.result_json ? JSON.parse(row.result_json) as { summary: string | null; items: unknown[] } : { summary: null, items: [] };
  return {
    id: row.id, workspace_id: row.workspace_id, fact_revision_id: row.fact_revision_id, task_id: row.task_id, provider_mode: row.provider_mode,
    state: row.state, summary: result.summary, items: result.items, error_code: row.error_code, created_at: iso(row.created_at_ms), updated_at: iso(row.updated_at_ms),
  };
}

export function createResumeAiReview(deps: AiReviewDeps, request: ProductRequest, principal: Principal, revisionId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  if (!isPlainObject(parsed.value) || Object.keys(parsed.value).length > 0) return problem(request, 400, 'REQUEST_INVALID', '요청 본문은 빈 객체({})입니다.');
  const { db } = deps;
  if (!getFactRevision(db, principal.workspaceId, revisionId)) return problem(request, 404, 'FACT_REVISION_NOT_FOUND', '확정 경력을 찾을 수 없습니다.');
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname]));
  return idempotentWrite(db, request, principal.workspaceId, 'create_resume_ai_review', key.key, requestHash, () => {
    const pending = db.prepare(`SELECT r.id FROM ce8_resume_reviews r JOIN ce7_tasks t ON t.workspace_id = r.workspace_id AND t.id = r.task_id
      WHERE r.workspace_id = ? AND r.fact_revision_id = ? AND r.state = 'queued' AND t.state IN ('queued','running') LIMIT 1`).get(principal.workspaceId, revisionId);
    if (pending) return problem(request, 409, 'REVIEW_PENDING', '이 경력 버전의 점검을 이미 진행 중입니다.', { review_id: String(pending.id) });
    const now = request.nowMs;
    const reviewId = newId('review');
    const taskId = newId('task');
    const providerMode = deps.config.chatMode;
    const inputJson = JSON.stringify({ review_id: reviewId, fact_revision_id: revisionId, chat_provider_mode: providerMode });
    db.prepare(`INSERT INTO ce7_tasks (id, workspace_id, kind, state, input_json, input_hash, result_json, error_code, cancel_requested, provider_transmission, lease_owner, lease_generation, lease_until_ms, available_at_ms, created_at_ms, updated_at_ms)
      VALUES (?, ?, 'review_resume', 'queued', ?, ?, NULL, NULL, 0, 'not_dispatched', NULL, 0, NULL, ?, ?, ?)`).run(taskId, principal.workspaceId, inputJson, sha256Hex(inputJson), now, now, now);
    db.prepare("INSERT INTO ce8_resume_reviews (id, workspace_id, fact_revision_id, task_id, provider_mode, state, result_json, error_code, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL, ?, ?)")
      .run(reviewId, principal.workspaceId, revisionId, taskId, providerMode, now, now);
    const task = getTask(db, principal.workspaceId, taskId);
    return { status: 202, body: { task: task ? taskBody(task) : null, resource_id: reviewId } };
  });
}

export function getResumeAiReview(deps: AiReviewDeps, request: ProductRequest, principal: Principal, reviewId: string): Reply {
  const row = deps.db.prepare(`SELECT r.*, t.state AS task_state, t.error_code AS task_error FROM ce8_resume_reviews r JOIN ce7_tasks t ON t.workspace_id = r.workspace_id AND t.id = r.task_id
    WHERE r.workspace_id = ? AND r.id = ?`).get(principal.workspaceId, reviewId) as (ReviewRow & { task_state: string; task_error: string | null }) | undefined;
  if (!row) return problem(request, 404, 'REVIEW_NOT_FOUND', '점검 결과를 찾을 수 없습니다.');
  // 작업을 중지했으면 점검 행은 queued로 남는다. 화면에는 실패(중지)로 보여 준다.
  if (row.state === 'queued' && (row.task_state === 'canceled' || row.task_state === 'failed')) return { status: 200, body: { ...reviewBody(row), state: 'failed', error_code: row.task_error ?? 'CANCELED_BY_USER' } };
  return { status: 200, body: reviewBody(row) };
}
