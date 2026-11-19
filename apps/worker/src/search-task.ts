import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import type { SearchProvider, ProviderResult } from '../../../packages/search/src/provider.ts';
import { SearchProviderError } from '../../../packages/search/src/provider.ts';
import type { Condition, JobDraft, QueryPlan } from '../../../packages/search/src/types.ts';

// search_jobs 영속 작업 실행기. claim → (transaction 밖) provider 호출 → lease 조건 CAS로 결과 저장.
// - lease owner·generation·만료를 저장 transaction 안에서 다시 확인한다. lease를 잃은 실행의 결과는 버린다.
// - provider 호출 중에는 DB transaction을 잡지 않고 heartbeat로 lease만 연장한다. lease를 잃으면 호출을 중단한다.
// - 중지 요청이 있으면 전송 직전 CAS에서 막아 새 전송을 하지 않는다.
// - live provider로 전송한 뒤 결과를 모른 채 끊긴 작업은 자동 재시도하지 않고 'unknown'으로 남긴다.

export type SearchWorkerDeps = {
  db: DatabaseSync;
  owner: string;
  leaseMs: number;
  now: () => number;
  provider: SearchProvider;
  // 테스트에서 provider 호출 뒤·저장 전 상태를 바꾸기 위한 선택적 hook.
  beforeComplete?: (claim: SearchClaim) => void | Promise<void>;
};

export const MAX_SEARCH_ATTEMPTS = 3;

export type SearchClaim = {
  taskId: string; workspaceId: string; searchRunId: string; generation: number;
  queries: QueryPlan[]; conditions: Condition[]; maxCandidates: number; previousTransmission: string;
  // claim 시점에 실행할 수 없다고 판정한 이유. 있으면 provider를 부르지 않고 실패로 마무리한다.
  rejection: string | null;
};
type TaskInput = { intent_id: string; intent_hash: string; fact_revision_id: string; search_run_id: string; max_candidates: number; provider_mode?: string };
export type RunResult = 'idle' | 'succeeded' | 'failed' | 'canceled' | 'lease_lost';
type Transmission = 'not_dispatched' | 'dispatched' | 'completed' | 'unknown';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
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

const READY = "kind = 'search_jobs' AND cancel_requested = 0 AND available_at_ms <= ? AND (state = 'queued' OR (state = 'running' AND lease_until_ms < ?))";

// 실행 중 중지를 요청했지만 worker가 사라져 lease가 끝난 작업은 다시 실행하지 않고 중지로 마무리한다.
// 전송까지 했는지 모르는 작업은 전송 상태를 unknown으로 남긴다.
function finalizeAbandonedCancels(db: DatabaseSync, now: number) {
  const rows = db.prepare(`UPDATE ce7_tasks SET state = 'canceled', error_code = 'CANCELED_BY_USER', lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ?,
    provider_transmission = CASE WHEN provider_transmission = 'dispatched' THEN 'unknown' ELSE provider_transmission END
    WHERE kind = 'search_jobs' AND state = 'running' AND cancel_requested = 1 AND lease_until_ms < ? RETURNING workspace_id, id`).all(now, now);
  for (const row of rows) db.prepare("UPDATE ce7_search_runs SET state = 'canceled' WHERE workspace_id = ? AND task_id = ?").run(row.workspace_id, row.id);
}

function readInput(db: DatabaseSync, workspaceId: string, inputJson: string, providerMode: string) {
  const input = JSON.parse(inputJson) as TaskInput;
  if (typeof input.search_run_id !== 'string' || typeof input.intent_id !== 'string') throw new Error('TASK_INPUT_INVALID');
  const intent = db.prepare('SELECT queries_json, conditions_json, content_hash FROM ce7_search_intents WHERE workspace_id = ? AND id = ?').get(workspaceId, input.intent_id);
  // 검색 계획은 불변 기록이지만, 작업 입력에 고정한 hash와 다르면 실행하지 않는다.
  const valid = Boolean(intent) && intent?.content_hash === input.intent_hash;
  // 작업을 만든 API의 provider 모드와 이 worker의 provider가 다르면 mock/live 표시가 어긋나므로 실행하지 않는다.
  const modeMismatch = input.provider_mode !== undefined && input.provider_mode !== providerMode;
  return {
    input,
    queries: valid ? JSON.parse(String(intent?.queries_json)) as QueryPlan[] : [],
    conditions: valid ? JSON.parse(String(intent?.conditions_json)) as Condition[] : [],
    rejection: !valid ? 'SEARCH_INTENT_MISMATCH' : modeMismatch ? 'PROVIDER_MODE_MISMATCH' : null,
  };
}

export function claimSearchTask(deps: SearchWorkerDeps, taskId?: string): SearchClaim | null {
  const { db } = deps;
  const now = deps.now();
  return inTransaction(db, () => {
    finalizeAbandonedCancels(db, now);
    const target = taskId ?? db.prepare(`SELECT id FROM ce7_tasks WHERE ${READY} ORDER BY created_at_ms, rowid LIMIT 1`).get(now, now)?.id;
    if (typeof target !== 'string') return null;
    const row = db.prepare(`UPDATE ce7_tasks SET state = 'running', lease_owner = ?, lease_generation = lease_generation + 1, lease_until_ms = ?, updated_at_ms = ?
      WHERE id = ? AND ${READY} RETURNING workspace_id, input_json, lease_generation, provider_transmission`).get(deps.owner, now + deps.leaseMs, now, target, now, now);
    if (!row) return null;
    const workspaceId = String(row.workspace_id);
    const base = { taskId: target, workspaceId, generation: Number(row.lease_generation), previousTransmission: String(row.provider_transmission) };
    let parsed;
    try {
      parsed = readInput(db, workspaceId, String(row.input_json), deps.provider.mode);
    } catch {
      // 깨진 입력이 대기열 맨 앞을 계속 막지 않도록 같은 transaction에서 실패로 끝낸다.
      db.prepare("UPDATE ce7_tasks SET state = 'failed', error_code = 'TASK_INPUT_INVALID', lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ? WHERE id = ?").run(now, target);
      db.prepare("UPDATE ce7_search_runs SET state = 'failed' WHERE workspace_id = ? AND task_id = ?").run(workspaceId, target);
      return null;
    }
    db.prepare("UPDATE ce7_search_runs SET state = 'running' WHERE workspace_id = ? AND id = ? AND state IN ('queued','running')").run(workspaceId, parsed.input.search_run_id);
    return {
      ...base, searchRunId: parsed.input.search_run_id, queries: parsed.queries, conditions: parsed.conditions,
      maxCandidates: parsed.input.max_candidates, rejection: parsed.rejection,
    };
  });
}

function holdsLease(db: DatabaseSync, claim: SearchClaim, owner: string, now: number): boolean {
  return Boolean(db.prepare("SELECT 1 FROM ce7_tasks WHERE id = ? AND state = 'running' AND lease_owner = ? AND lease_generation = ? AND lease_until_ms > ?").get(claim.taskId, owner, claim.generation, now));
}

export function heartbeat(deps: SearchWorkerDeps, claim: SearchClaim): boolean {
  const now = deps.now();
  const result = deps.db.prepare("UPDATE ce7_tasks SET lease_until_ms = ?, updated_at_ms = ? WHERE id = ? AND state = 'running' AND lease_owner = ? AND lease_generation = ? AND lease_until_ms > ?")
    .run(now + deps.leaseMs, now, claim.taskId, deps.owner, claim.generation, now);
  return Number(result.changes) === 1;
}

// 전송 직전 CAS: lease를 가졌고 중지 요청이 없을 때만 dispatched로 바꾼다.
function markDispatched(deps: SearchWorkerDeps, claim: SearchClaim): 'dispatched' | 'canceled' | 'lease_lost' {
  return inTransaction(deps.db, () => {
    const now = deps.now();
    const result = deps.db.prepare("UPDATE ce7_tasks SET provider_transmission = 'dispatched', updated_at_ms = ? WHERE id = ? AND state = 'running' AND lease_owner = ? AND lease_generation = ? AND lease_until_ms > ? AND cancel_requested = 0")
      .run(now, claim.taskId, deps.owner, claim.generation, now);
    if (Number(result.changes) === 1) return 'dispatched';
    return holdsLease(deps.db, claim, deps.owner, now) ? 'canceled' : 'lease_lost';
  });
}

type Final = { state: 'succeeded'; result: ProviderResult } | { state: 'failed'; code: string; transmission: Transmission } | { state: 'canceled'; transmission: Transmission };

export function snapshotHash(job: JobDraft): string {
  return sha256(JSON.stringify([job.job_key, job.company_name, job.title, job.canonical_url, job.site_id, job.content_text, job.requirements, job.open_status, job.data_origin]));
}

// 화면에서 링크로 쓰므로 http(s) 주소의 공고만 저장한다.
export const safeUrl = (url: string) => { try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; } };

function finish(deps: SearchWorkerDeps, claim: SearchClaim, final: Final): RunResult {
  const { db } = deps;
  return inTransaction(db, () => {
    const now = deps.now();
    if (!holdsLease(db, claim, deps.owner, now)) return 'lease_lost';
    const canceled = final.state === 'canceled' || Number(db.prepare('SELECT cancel_requested FROM ce7_tasks WHERE id = ?').get(claim.taskId)?.cancel_requested) === 1;
    const transmission: Transmission = final.state === 'succeeded' ? 'completed' : final.transmission;
    // result_json은 성공했을 때만 채운다. 검색 실행 ID는 작업 입력에 이미 있다.
    const done = (state: string, code: string | null, result: unknown) => db.prepare('UPDATE ce7_tasks SET state = ?, error_code = ?, result_json = ?, provider_transmission = ?, lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ? WHERE id = ?')
      .run(state, code, result === null ? null : JSON.stringify(result), transmission, now, claim.taskId);
    if (canceled) {
      // 중지 요청 뒤 도착한 결과는 저장하지 않는다. 검색은 외부 효과가 없어 결과 폐기로 충분하다.
      done('canceled', 'CANCELED_BY_USER', null);
      db.prepare("UPDATE ce7_search_runs SET state = 'canceled' WHERE workspace_id = ? AND id = ?").run(claim.workspaceId, claim.searchRunId);
      return 'canceled';
    }
    if (final.state === 'failed') {
      done('failed', final.code, null);
      db.prepare("UPDATE ce7_search_runs SET state = 'failed' WHERE workspace_id = ? AND id = ?").run(claim.workspaceId, claim.searchRunId);
      return 'failed';
    }
    if (final.state !== 'succeeded') return 'lease_lost';
    const insertJob = db.prepare(`INSERT INTO ce7_job_snapshots (id, workspace_id, job_key, company_name, title, canonical_url, site_id, content_text, requirements_json, content_hash, open_status, data_origin, observed_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertSlot = db.prepare('INSERT INTO ce7_search_results (workspace_id, search_run_id, job_snapshot_id, slot) VALUES (?, ?, ?, ?)');
    const ids: string[] = [];
    const jobs = final.result.jobs.filter(job => safeUrl(job.canonical_url)).slice(0, Math.min(10, claim.maxCandidates));
    jobs.forEach((job, index) => {
      const id = newId('job');
      insertJob.run(id, claim.workspaceId, job.job_key, job.company_name, job.title, job.canonical_url, job.site_id, job.content_text, JSON.stringify(job.requirements), snapshotHash(job), job.open_status, job.data_origin, now);
      insertSlot.run(claim.workspaceId, claim.searchRunId, id, index + 1);
      ids.push(id);
    });
    const dropped = final.result.jobs.length > jobs.length && jobs.length < claim.maxCandidates;
    const outcome = ids.length === 0 ? 'empty' : final.result.outcome === 'partial' || dropped ? 'partial' : 'complete';
    done('succeeded', null, { search_run_id: claim.searchRunId, job_snapshot_ids: ids, failed_queries: final.result.failed_queries });
    db.prepare("UPDATE ce7_search_runs SET state = 'succeeded', outcome = ? WHERE workspace_id = ? AND id = ?").run(outcome, claim.workspaceId, claim.searchRunId);
    return 'succeeded';
  });
}

async function callProvider(deps: SearchWorkerDeps, claim: SearchClaim): Promise<Final | 'lease_lost'> {
  // 이전 시도가 전송했다는 기록은 일찍 실패하더라도 지우지 않는다.
  const earlier: Transmission = claim.previousTransmission === 'dispatched' ? 'unknown' : claim.previousTransmission as Transmission;
  // 이전 실행이 live provider로 전송한 뒤 끊겼다면 결과를 알 수 없으므로 다시 보내지 않는다(유료 호출 중복 방지).
  if (claim.previousTransmission === 'dispatched' && deps.provider.mode === 'live') return { state: 'failed', code: 'PROVIDER_TRANSMISSION_UNKNOWN', transmission: 'unknown' };
  if (claim.generation > MAX_SEARCH_ATTEMPTS) return { state: 'failed', code: 'SEARCH_ATTEMPTS_EXCEEDED', transmission: earlier };
  if (claim.rejection) return { state: 'failed', code: claim.rejection, transmission: earlier };
  const dispatch = markDispatched(deps, claim);
  if (dispatch === 'lease_lost') return 'lease_lost';
  if (dispatch === 'canceled') return { state: 'canceled', transmission: earlier };
  const controller = new AbortController();
  const timer = setInterval(() => {
    try {
      if (!heartbeat(deps, claim)) controller.abort();
    } catch (error) {
      // DB가 잠시 바쁘면 다음 주기에 다시 연장한다. worker 프로세스를 죽이지 않는다.
      console.error('WORKER_HEARTBEAT_ERROR', error instanceof Error ? error.message : 'unknown');
    }
  }, Math.max(50, Math.floor(deps.leaseMs / 3)));
  try {
    const call = { workspaceId: claim.workspaceId, taskId: claim.taskId, leaseGeneration: claim.generation };
    const result = await deps.provider.search({ queries: claim.queries, conditions: claim.conditions, maxCandidates: claim.maxCandidates, signal: controller.signal, call });
    return { state: 'succeeded', result };
  } catch (error) {
    // mock은 외부 전송이 없다. live의 알 수 없는 오류는 전송 여부가 불명확하므로 unknown으로 남긴다.
    // provider가 분류한 오류(전송 전 한도 거절·처리 안 됨 확인·결과 불명)는 그 분류를 그대로 기록한다.
    if (error instanceof SearchProviderError) return { state: 'failed', code: error.code, transmission: error.transmission };
    return { state: 'failed', code: 'PROVIDER_FAILED', transmission: deps.provider.mode === 'live' ? 'unknown' : 'completed' };
  } finally {
    clearInterval(timer);
  }
}

// 이미 claim한 작업을 실행한다. claim과 실행 사이에 중지·lease 상실이 끼어드는 경우를 테스트할 수 있게 분리했다.
export async function executeSearchClaim(deps: SearchWorkerDeps, claim: SearchClaim): Promise<RunResult> {
  const final = await callProvider(deps, claim);
  if (final === 'lease_lost') return 'lease_lost';
  if (deps.beforeComplete) await deps.beforeComplete(claim);
  return finish(deps, claim, final);
}

export async function runSearchTask(deps: SearchWorkerDeps, taskId?: string): Promise<RunResult> {
  const claim = claimSearchTask(deps, taskId);
  if (!claim) return 'idle';
  return executeSearchClaim(deps, claim);
}
