import { patternsFor } from '../../../packages/tailor/src/patterns.ts';
import { ChatProviderError } from '../../../packages/tailor/src/provider.ts';
import { screenReview } from '../../../packages/tailor/src/review-provider.ts';
import type { ReviewOutput, ReviewProvider } from '../../../packages/tailor/src/review-provider.ts';
import type { FactLike } from '../../../packages/tailor/src/types.ts';
import { claimTask, completeTask, earlierTransmission, holdsLease, inTransaction, markDispatched, MAX_ATTEMPTS, withHeartbeat } from './lease.ts';
import type { LeaseDeps, LeasedTask, Transmission } from './lease.ts';

// review_resume 작업(DECISIONS S1-14): 확정 경력 한 버전 → 점검 provider → 거른 안내·질문을 ce8_resume_reviews에 저장한다.
// 확정 경력은 바꾸지 않는다. live 호출이 나간 뒤 lease를 잃고 다시 집히면 재전송하지 않고 불명으로 끝낸다.

export type ReviewWorkerDeps = LeaseDeps & { provider: ReviewProvider };
export type ReviewRunResult = 'idle' | 'succeeded' | 'failed' | 'lease_lost';
type Input = { review_id: string; fact_revision_id: string; chat_provider_mode?: string };

function finish(deps: ReviewWorkerDeps, task: LeasedTask, reviewId: string, outcome: { ok: true; output: ReviewOutput } | { ok: false; code: string }, transmission: Transmission): ReviewRunResult {
  return inTransaction(deps.db, () => {
    if (!holdsLease(deps, task)) return 'lease_lost';
    const now = deps.now();
    if (outcome.ok) {
      deps.db.prepare("UPDATE ce8_resume_reviews SET state = 'succeeded', result_json = ?, updated_at_ms = ? WHERE workspace_id = ? AND id = ? AND state = 'queued'")
        .run(JSON.stringify(outcome.output), now, task.workspaceId, reviewId);
      completeTask(deps, task, 'succeeded', null, { review_id: reviewId, items: outcome.output.items.length }, transmission);
      return 'succeeded';
    }
    deps.db.prepare("UPDATE ce8_resume_reviews SET state = 'failed', error_code = ?, updated_at_ms = ? WHERE workspace_id = ? AND id = ? AND state = 'queued'")
      .run(outcome.code, now, task.workspaceId, reviewId);
    completeTask(deps, task, 'failed', outcome.code, null, transmission);
    return 'failed';
  });
}

export async function runReviewTask(deps: ReviewWorkerDeps, taskId?: string): Promise<ReviewRunResult> {
  const task = claimTask(deps, 'review_resume', taskId);
  if (!task) return 'idle';
  let input: Input;
  try { input = JSON.parse(task.inputJson) as Input; } catch { input = { review_id: '', fact_revision_id: '' }; }
  const fail = (code: string, transmission: Transmission = earlierTransmission(task)) => finish(deps, task, input.review_id, { ok: false, code }, transmission);
  if (typeof input.review_id !== 'string' || !input.review_id || typeof input.fact_revision_id !== 'string') return fail('TASK_INPUT_INVALID');
  if (input.chat_provider_mode !== undefined && input.chat_provider_mode !== deps.provider.mode) return fail('PROVIDER_MODE_MISMATCH');
  if (task.previousTransmission === 'dispatched' && deps.provider.mode === 'live') return fail('PROVIDER_TRANSMISSION_UNKNOWN', 'unknown');
  if (task.generation > MAX_ATTEMPTS) return fail('REVIEW_ATTEMPTS_EXCEEDED');
  const row = deps.db.prepare('SELECT facts_json FROM ce7_fact_revisions WHERE workspace_id = ? AND id = ?').get(task.workspaceId, input.fact_revision_id);
  if (!row) return fail('FACT_REVISION_NOT_FOUND');
  const facts = JSON.parse(String(row.facts_json)) as FactLike[];
  if (!markDispatched(deps, task)) return holdsLease(deps, task) ? fail('CANCELED_BY_USER') : 'lease_lost';

  let raw: unknown;
  try {
    const patterns = patternsFor(facts.filter(fact => fact.category === 'role').map(fact => fact.statement));
    raw = await withHeartbeat(deps, task, signal => deps.provider.review({ facts, patterns, signal, call: { workspaceId: task.workspaceId, taskId: task.taskId, leaseGeneration: task.generation } }));
  } catch (error) {
    const code = error instanceof ChatProviderError ? error.code : 'REVIEW_PROVIDER_FAILED';
    const transmission = error instanceof ChatProviderError ? (deps.provider.mode === 'live' ? error.transmission : 'completed') : deps.provider.mode === 'live' ? 'unknown' : 'completed';
    return fail(code, transmission === 'not_dispatched' ? earlierTransmission(task) : transmission);
  }
  const output = screenReview(raw, facts);
  if (!output) return fail('REVIEW_OUTPUT_INVALID', 'completed');
  return finish(deps, task, input.review_id, { ok: true, output }, 'completed');
}
