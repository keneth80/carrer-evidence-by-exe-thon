import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { LinerLedger } from '../../../packages/liner/src/web-search.ts';

// Liner 유료 호출 원장. ce7_provider_calls(migration 007)를 그대로 쓴다.
// 개발 계정 하나를 공유하므로 호출 수·예산 한도는 workspace와 무관하게 이 DB 전체의 liner 행으로 센다.
// 예약은 실패·결과 불명이어도 되돌리지 않는다(접수 불명 호출의 한도를 근거 없이 돌려주지 않는다).

export const LINER_PROVIDER = 'liner';

export type LinerLedgerDeps = { db: DatabaseSync; owner: string; now: () => number; maxCalls: number; budgetMicroUsd: number };

// 검색(search)과 대화(chat)는 사용자 승인 한도가 따로라 purpose별로 센다.
export function readLinerUsage(db: DatabaseSync, purpose: 'search' | 'chat' = 'search') {
  const row = db.prepare(`SELECT count(*) AS calls, coalesce(sum(reserved_micro_usd), 0) AS reserved, coalesce(sum(verified_micro_usd), 0) AS verified,
    coalesce(sum(status = 'unknown'), 0) AS unknown FROM ce7_provider_calls WHERE provider = ? AND purpose = ?`).get(LINER_PROVIDER, purpose);
  return { calls: Number(row?.calls), reserved_micro_usd: Number(row?.reserved), verified_micro_usd: Number(row?.verified), unknown_calls: Number(row?.unknown) };
}

export function createLinerLedger(deps: LinerLedgerDeps): LinerLedger {
  const { db } = deps;
  return {
    reserve(call, requestHash, reserveMicroUsd, purpose = 'search') {
      db.exec('BEGIN IMMEDIATE');
      try {
        const now = deps.now();
        // 중지 요청·lease 상실 뒤에는 새 유료 요청을 예약하지 않는다.
        const leased = db.prepare("SELECT 1 FROM ce7_tasks WHERE workspace_id = ? AND id = ? AND state = 'running' AND lease_owner = ? AND lease_generation = ? AND lease_until_ms > ? AND cancel_requested = 0")
          .get(call.workspaceId, call.taskId, deps.owner, call.leaseGeneration, now);
        const usage = readLinerUsage(db, purpose);
        const refusal = !leased ? 'LINER_LEASE_NOT_HELD' as const
          : usage.calls >= deps.maxCalls ? 'LINER_CALL_LIMIT' as const
            : usage.reserved_micro_usd + reserveMicroUsd > deps.budgetMicroUsd ? 'LINER_BUDGET_LIMIT' as const : null;
        if (refusal) { db.exec('ROLLBACK'); return { ok: false, code: refusal }; }
        const callId = `pcall_${randomUUID().replaceAll('-', '')}`;
        db.prepare(`INSERT INTO ce7_provider_calls (id, workspace_id, task_id, provider, purpose, request_hash, status, reserved_micro_usd, verified_micro_usd, lease_generation, created_at_ms, updated_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, NULL, ?, ?, ?)`).run(callId, call.workspaceId, call.taskId, LINER_PROVIDER, purpose, requestHash, reserveMicroUsd, call.leaseGeneration, now, now);
        db.exec('COMMIT');
        return { ok: true, callId };
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    dispatch(callId) {
      const result = db.prepare("UPDATE ce7_provider_calls SET status = 'dispatched', updated_at_ms = ? WHERE id = ? AND status = 'reserved'").run(deps.now(), callId);
      return Number(result.changes) === 1;
    },
    settle(callId, status, verifiedMicroUsd) {
      db.prepare("UPDATE ce7_provider_calls SET status = ?, verified_micro_usd = ?, updated_at_ms = ? WHERE id = ? AND status IN ('reserved','dispatched')")
        .run(status, verifiedMicroUsd, deps.now(), callId);
    },
  };
}
