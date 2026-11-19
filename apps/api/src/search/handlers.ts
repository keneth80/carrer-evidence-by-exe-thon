import type { DatabaseSync } from 'node:sqlite';
import { validateConditions } from '../../../../packages/search/src/conditions.ts';
import { buildQueryPlans } from '../../../../packages/search/src/intent.ts';
import type { FactLike } from '../../../../packages/search/src/types.ts';
import { isPlainObject, newId, problem, readJson, sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import type { Config } from '../config.ts';
import { idempotentWrite, readIdempotencyKey } from '../idempotency.ts';
import { getDocument, getFactRevision, getTask, taskBody } from '../resume/repository.ts';
import { getIntent, getJobSnapshot, getSearchRun, intentBody, jobSnapshotBody, searchRunBody } from './repository.ts';

// S02: 확정 경력 → SearchIntent → 영속 검색 작업(worker가 실행) → 공고 스냅샷 조회.
// API는 작업을 저장만 하고 provider를 호출하지 않는다. 실행·결과 저장은 apps/worker가 lease로 맡는다.

export type SearchDeps = { db: DatabaseSync; config: Config };

export function createSearchIntent(deps: SearchDeps, request: ProductRequest, principal: Principal): Reply {
  const keyCheck = readIdempotencyKey(request);
  if ('reply' in keyCheck) return keyCheck.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const value = parsed.value;
  if (!isPlainObject(value) || Object.keys(value).sort().join() !== 'conditions,fact_revision_id' || typeof value.fact_revision_id !== 'string') {
    return problem(request, 400, 'SEARCH_INTENT_REQUEST_INVALID', 'fact_revision_id와 conditions가 필요합니다.');
  }
  const conditions = validateConditions(value.conditions);
  if (!conditions.ok) return problem(request, 422, conditions.code, conditions.message, conditions.index === undefined ? undefined : { condition_index: conditions.index });
  const { db } = deps;
  const factRevisionId = value.fact_revision_id;
  const revision = getFactRevision(db, principal.workspaceId, factRevisionId);
  // 확인 전 추출 초안은 fact revision이 아니므로 여기서 함께 거절된다.
  if (!revision) return problem(request, 404, 'FACT_REVISION_NOT_FOUND', '확정 경력을 찾을 수 없습니다. 추출 내용을 먼저 확인·저장하세요.');
  const facts = JSON.parse(revision.facts_json) as FactLike[];
  const plans = buildQueryPlans(facts);
  if (!plans.ok) return problem(request, 422, plans.code, plans.message);
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, factRevisionId, conditions.conditions]));

  return idempotentWrite(db, request, principal.workspaceId, 'create_search_intent', keyCheck.key, requestHash, () => {
    // 다른 화면에서 경력을 새로 확정했다면 이전 버전으로 검색 계획을 만들지 않는다.
    const current = getDocument(db, principal.workspaceId, revision.document_id)?.current_fact_revision_id ?? null;
    if (current !== factRevisionId) {
      return problem(request, 409, 'FACT_REVISION_NOT_CURRENT', '경력이 새 버전으로 저장되었습니다. 최신 확정 경력으로 다시 시작하세요.', { current_revision_id: current });
    }
    const id = newId('intent');
    const contentHash = sha256Hex(JSON.stringify({ fact_revision_id: factRevisionId, facts_hash: revision.content_hash, conditions: conditions.conditions, queries: plans.queries }));
    db.prepare('INSERT INTO ce7_search_intents (id, workspace_id, fact_revision_id, conditions_json, queries_json, content_hash, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, principal.workspaceId, factRevisionId, JSON.stringify(conditions.conditions), JSON.stringify(plans.queries), contentHash, request.nowMs);
    const saved = getIntent(db, principal.workspaceId, id);
    return { status: 201, body: saved ? intentBody(saved) : null };
  });
}

export function getSearchIntent(deps: SearchDeps, request: ProductRequest, principal: Principal, intentId: string): Reply {
  const row = getIntent(deps.db, principal.workspaceId, intentId);
  return row ? { status: 200, body: intentBody(row) } : problem(request, 404, 'SEARCH_INTENT_NOT_FOUND', '검색 계획을 찾을 수 없습니다.');
}

export function createResumeSearch(deps: SearchDeps, request: ProductRequest, principal: Principal): Reply {
  const keyCheck = readIdempotencyKey(request);
  if ('reply' in keyCheck) return keyCheck.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const value = parsed.value;
  if (!isPlainObject(value) || Object.keys(value).sort().join() !== 'intent_id,max_candidates' || typeof value.intent_id !== 'string'
    || !Number.isInteger(value.max_candidates) || (value.max_candidates as number) < 1 || (value.max_candidates as number) > 10) {
    return problem(request, 400, 'SEARCH_REQUEST_INVALID', 'intent_id와 1~10 범위의 max_candidates가 필요합니다.');
  }
  const { db } = deps;
  const intent = getIntent(db, principal.workspaceId, value.intent_id);
  if (!intent) return problem(request, 404, 'SEARCH_INTENT_NOT_FOUND', '검색 계획을 찾을 수 없습니다.');
  const maxCandidates = value.max_candidates as number;
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, intent.id, maxCandidates]));

  return idempotentWrite(db, request, principal.workspaceId, 'create_resume_search', keyCheck.key, requestHash, () => {
    // 검색 계획 생성 뒤 경력이 새로 확정됐다면 이전 버전으로 새 검색을 실행하지 않는다(이미 실행한 검색은 보존).
    const revision = getFactRevision(db, principal.workspaceId, intent.fact_revision_id);
    const current = revision ? getDocument(db, principal.workspaceId, revision.document_id)?.current_fact_revision_id ?? null : null;
    if (current !== intent.fact_revision_id) {
      return problem(request, 409, 'FACT_REVISION_NOT_CURRENT', '경력이 새 버전으로 저장되었습니다. 최신 확정 경력으로 다시 검색하세요.', { current_revision_id: current });
    }
    const now = request.nowMs;
    const taskId = newId('task');
    const searchId = newId('search');
    // 작업 입력에 검색 계획 hash·확정 경력 ID·provider 모드를 고정한다. worker는 이 값과 다르면 실행하지 않는다.
    const input = { intent_id: intent.id, intent_hash: intent.content_hash, fact_revision_id: intent.fact_revision_id, search_run_id: searchId, max_candidates: maxCandidates, provider_mode: deps.config.mode };
    const inputJson = JSON.stringify(input);
    db.prepare(`INSERT INTO ce7_tasks (id, workspace_id, kind, state, input_json, input_hash, result_json, error_code, cancel_requested, provider_transmission, lease_owner, lease_generation, lease_until_ms, available_at_ms, created_at_ms, updated_at_ms)
      VALUES (?, ?, 'search_jobs', 'queued', ?, ?, NULL, NULL, 0, 'not_dispatched', NULL, 0, NULL, ?, ?, ?)`)
      .run(taskId, principal.workspaceId, inputJson, sha256Hex(inputJson), now, now, now);
    db.prepare("INSERT INTO ce7_search_runs (id, workspace_id, intent_id, task_id, provider_mode, state, outcome, created_at_ms) VALUES (?, ?, ?, ?, ?, 'queued', NULL, ?)")
      .run(searchId, principal.workspaceId, intent.id, taskId, deps.config.mode, now);
    const task = getTask(db, principal.workspaceId, taskId);
    return { status: 202, body: { task: task ? taskBody(task) : null, resource_id: searchId } };
  });
}

export function getResumeSearch(deps: SearchDeps, request: ProductRequest, principal: Principal, searchId: string): Reply {
  const row = getSearchRun(deps.db, principal.workspaceId, searchId);
  return row ? { status: 200, body: searchRunBody(deps.db, row) } : problem(request, 404, 'SEARCH_NOT_FOUND', '검색을 찾을 수 없습니다.');
}

export function getJob(deps: SearchDeps, request: ProductRequest, principal: Principal, jobId: string): Reply {
  const row = getJobSnapshot(deps.db, principal.workspaceId, jobId);
  return row ? { status: 200, body: jobSnapshotBody(row) } : problem(request, 404, 'JOB_SNAPSHOT_NOT_FOUND', '공고를 찾을 수 없습니다.');
}

// 대기 중이면 바로 중지한다. 실행 중이면 중지 요청만 기록하고 worker가 결과 저장 대신 중지로 마무리한다.
// 전송이 시작된 외부 효과를 취소했다고 단정하지 않는다(SERVICE_RULES).
export function cancelProductTask(deps: SearchDeps, request: ProductRequest, principal: Principal, taskId: string): Reply {
  const keyCheck = readIdempotencyKey(request);
  if ('reply' in keyCheck) return keyCheck.reply;
  const { db } = deps;
  const task = getTask(db, principal.workspaceId, taskId);
  if (!task) return problem(request, 404, 'TASK_NOT_FOUND', '작업을 찾을 수 없습니다.');
  if (task.kind !== 'search_jobs') return problem(request, 409, 'TASK_NOT_CANCELABLE', '이 종류의 작업은 중지할 수 없습니다.');
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname]));

  return idempotentWrite(db, request, principal.workspaceId, 'cancel_task', keyCheck.key, requestHash, () => {
    const now = request.nowMs;
    const current = getTask(db, principal.workspaceId, taskId);
    if (!current || !['queued', 'running'].includes(current.state)) {
      return problem(request, 409, 'TASK_NOT_CANCELABLE', '이미 끝난 작업입니다.', { state: current?.state ?? null });
    }
    if (current.state === 'queued') {
      db.prepare("UPDATE ce7_tasks SET state = 'canceled', cancel_requested = 1, error_code = 'CANCELED_BY_USER', updated_at_ms = ? WHERE workspace_id = ? AND id = ? AND state = 'queued'").run(now, principal.workspaceId, taskId);
      db.prepare("UPDATE ce7_search_runs SET state = 'canceled' WHERE workspace_id = ? AND task_id = ?").run(principal.workspaceId, taskId);
    } else {
      db.prepare('UPDATE ce7_tasks SET cancel_requested = 1, updated_at_ms = ? WHERE workspace_id = ? AND id = ?').run(now, principal.workspaceId, taskId);
    }
    const saved = getTask(db, principal.workspaceId, taskId);
    return { status: 200, body: saved ? taskBody(saved) : null };
  });
}
