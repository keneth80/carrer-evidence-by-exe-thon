import { hasReconciler, insertEvidence, reconcileSelfForm, setAttemptState } from '../../api/src/apply/reconcile.ts';
import { closeExpiredPrepared, getAttempt, getAuthorization } from '../../api/src/apply/repository.ts';
import type { AttemptRow } from '../../api/src/apply/repository.ts';
import { claimTask, completeTask, failTask, holdsLease, inTransaction, MAX_ATTEMPTS } from './lease.ts';
import type { LeaseDeps } from './lease.ts';

// submit_application(action=observe) 작업: 전송했지만 결과를 모르는 시도의 접수 여부를 조회한다. 다시 제출하지 않는다.
// 자체 테스트 폼은 사이트 저장소를 직접 대조하고, 기록이 없으면 접수 키를 닫아 미접수로 확정한다.
// 외부 사이트는 조회 수단이 없으므로 상태를 바꾸지 않는다(접수 불명 유지, 사용자 확인 필요).

export type ObserveRunResult = 'idle' | 'succeeded' | 'failed' | 'lease_lost';

export function runObserveTask(deps: LeaseDeps, taskId?: string): ObserveRunResult {
  const task = claimTask(deps, 'submit_application', taskId);
  if (!task) return 'idle';
  const fail = (code: string): ObserveRunResult => failTask(deps, task, code, 'not_dispatched') ? 'failed' : 'lease_lost';
  if (task.generation > MAX_ATTEMPTS) return fail('OBSERVE_ATTEMPTS_EXCEEDED');
  let input: { action?: unknown; attempt_id?: unknown };
  try { input = JSON.parse(task.inputJson); } catch { return fail('TASK_INPUT_INVALID'); }
  if (input.action !== 'observe' || typeof input.attempt_id !== 'string') return fail('TASK_INPUT_INVALID');
  const attemptId = input.attempt_id;
  return inTransaction(deps.db, (): ObserveRunResult => {
    if (!holdsLease(deps, task)) return 'lease_lost';
    const attempt = getAttempt(deps.db, task.workspaceId, attemptId);
    if (!attempt) { completeTask(deps, task, 'failed', 'ATTEMPT_MISSING', null, 'not_dispatched'); return 'failed'; }
    const auth = getAuthorization(deps.db, task.workspaceId, attempt.authorization_id)!;
    const outcome = hasReconciler(auth.site_id)
      ? reconcileSelfForm(deps.db, task.workspaceId, attemptId, { seal: true, nowMs: deps.now() })
      : { state: attempt.state, evidenceId: null };
    completeTask(deps, task, 'succeeded', null, { attempt_id: attemptId, state: outcome.state, evidence_id: outcome.evidenceId }, 'not_dispatched');
    return 'succeeded';
  });
}

// 만료된 대기 시도를 닫고, 전송(dispatched) 뒤 실행기 보고가 정해진 시간 안에 없으면 접수 불명으로 바꾼다. 자체 폼은 기록이 있으면 접수로 확정한다(봉인하지 않음).
export function sweepStaleDispatches(deps: { db: LeaseDeps['db']; now: () => number; reportTimeoutMs: number }): number {
  // 승인이 만료되었는데 실행되지 않은 대기 시도는 전송 전 중단으로 닫아 새 승인을 막지 않게 한다.
  let changed = inTransaction(deps.db, () => closeExpiredPrepared(deps.db, deps.now()));
  const cutoff = deps.now() - deps.reportTimeoutMs;
  const stale = deps.db.prepare("SELECT * FROM ce7_attempts WHERE state = 'dispatched' AND dispatch_started_at_ms < ? ORDER BY dispatch_started_at_ms LIMIT 20").all(cutoff) as AttemptRow[];
  for (const row of stale) {
    inTransaction(deps.db, () => {
      const attempt = getAttempt(deps.db, row.workspace_id, row.id);
      if (attempt?.state !== 'dispatched') return;
      const auth = getAuthorization(deps.db, row.workspace_id, attempt.authorization_id)!;
      if (hasReconciler(auth.site_id)) reconcileSelfForm(deps.db, row.workspace_id, row.id, { seal: false, nowMs: deps.now() });
      else {
        insertEvidence(deps.db, attempt, { kind: 'no_delivery_proof', conclusion: 'unknown', summary: '전송 뒤 실행기 보고가 없어 접수 여부를 알 수 없습니다.', content: { attempt_id: attempt.id, reason: 'executor_no_report' }, source_url: auth.target_url }, deps.now());
        setAttemptState(deps.db, attempt, 'submission_unknown', 'EXECUTOR_NO_REPORT', deps.now());
      }
      changed += 1;
    });
  }
  return changed;
}
