import type { DatabaseSync } from 'node:sqlite';

// 영속 작업 공용 lease 도구(tailor_resume·render_resume·submit_application 접수 확인). search_jobs는 S02에서 같은 규칙으로 search-task.ts에 구현돼 있다.
// claim은 한 transaction에서 generation을 올리고, 저장은 owner·generation·만료를 다시 확인한 transaction에서만 한다.

export type LeaseDeps = { db: DatabaseSync; owner: string; leaseMs: number; now: () => number };
export type LeasedTask = { taskId: string; workspaceId: string; generation: number; inputJson: string; previousTransmission: string };
export type Transmission = 'not_dispatched' | 'dispatched' | 'completed' | 'unknown';
export const MAX_ATTEMPTS = 3;

export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = work();
    if (db.isTransaction) db.exec('COMMIT');
    return value;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

const ready = (kind: string) => `kind = '${kind}' AND cancel_requested = 0 AND available_at_ms <= ? AND (state = 'queued' OR (state = 'running' AND lease_until_ms < ?))`;

export function claimTask(deps: LeaseDeps, kind: 'tailor_resume' | 'render_resume' | 'submit_application' | 'discover_similar' | 'review_resume' | 'supplement_resume', taskId?: string): LeasedTask | null {
  const { db } = deps;
  const now = deps.now();
  return inTransaction(db, () => {
    const target = taskId ?? db.prepare(`SELECT id FROM ce7_tasks WHERE ${ready(kind)} ORDER BY created_at_ms, rowid LIMIT 1`).get(now, now)?.id;
    if (typeof target !== 'string') return null;
    const row = db.prepare(`UPDATE ce7_tasks SET state = 'running', lease_owner = ?, lease_generation = lease_generation + 1, lease_until_ms = ?, updated_at_ms = ?
      WHERE id = ? AND ${ready(kind)} RETURNING workspace_id, input_json, lease_generation, provider_transmission`).get(deps.owner, now + deps.leaseMs, now, target, now, now);
    if (!row) return null;
    return { taskId: target, workspaceId: String(row.workspace_id), generation: Number(row.lease_generation), inputJson: String(row.input_json), previousTransmission: String(row.provider_transmission) };
  });
}

export function holdsLease(deps: LeaseDeps, task: LeasedTask): boolean {
  return Boolean(deps.db.prepare("SELECT 1 FROM ce7_tasks WHERE id = ? AND state = 'running' AND lease_owner = ? AND lease_generation = ? AND lease_until_ms > ?").get(task.taskId, deps.owner, task.generation, deps.now()));
}

export function heartbeat(deps: LeaseDeps, task: LeasedTask): boolean {
  const now = deps.now();
  const result = deps.db.prepare("UPDATE ce7_tasks SET lease_until_ms = ?, updated_at_ms = ? WHERE id = ? AND state = 'running' AND lease_owner = ? AND lease_generation = ? AND lease_until_ms > ?")
    .run(now + deps.leaseMs, now, task.taskId, deps.owner, task.generation, now);
  return Number(result.changes) === 1;
}

// 외부 호출 직전 CAS. lease를 가졌고 중지 요청이 없을 때만 전송 상태를 dispatched로 바꾼다.
export function markDispatched(deps: LeaseDeps, task: LeasedTask): boolean {
  const now = deps.now();
  const result = deps.db.prepare("UPDATE ce7_tasks SET provider_transmission = 'dispatched', updated_at_ms = ? WHERE id = ? AND state = 'running' AND lease_owner = ? AND lease_generation = ? AND lease_until_ms > ? AND cancel_requested = 0")
    .run(now, task.taskId, deps.owner, task.generation, now);
  return Number(result.changes) === 1;
}

// 호출 중 heartbeat로 lease를 연장하고, lease를 잃으면 signal을 abort한다. heartbeat 오류로 프로세스를 죽이지 않는다.
export async function withHeartbeat<T>(deps: LeaseDeps, task: LeasedTask, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setInterval(() => {
    try { if (!heartbeat(deps, task)) controller.abort(); } catch (error) { console.error('WORKER_HEARTBEAT_ERROR', error instanceof Error ? error.message : 'unknown'); }
  }, Math.max(50, Math.floor(deps.leaseMs / 3)));
  try { return await work(controller.signal); } finally { clearInterval(timer); }
}

// lease를 가진 실행만 작업을 끝낸다. 호출자가 연 transaction 안에서 쓴다.
export function completeTask(deps: LeaseDeps, task: LeasedTask, state: 'succeeded' | 'failed', code: string | null, result: unknown, transmission: Transmission) {
  deps.db.prepare('UPDATE ce7_tasks SET state = ?, error_code = ?, result_json = ?, provider_transmission = ?, lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ? WHERE id = ?')
    .run(state, code, result === null ? null : JSON.stringify(result), transmission, deps.now(), task.taskId);
}

// lease를 확인한 뒤 실패로 끝낸다. lease를 잃었으면 false.
export function failTask(deps: LeaseDeps, task: LeasedTask, code: string, transmission: Transmission): boolean {
  return inTransaction(deps.db, () => {
    if (!holdsLease(deps, task)) return false;
    completeTask(deps, task, 'failed', code, null, transmission);
    return true;
  });
}

export const earlierTransmission = (task: LeasedTask): Transmission => task.previousTransmission === 'dispatched' ? 'unknown' : task.previousTransmission as Transmission;
