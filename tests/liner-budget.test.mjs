import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLinerLedger } from '../apps/worker/src/liner-ledger.ts';

// Liner 예산 한도 계산(DECISIONS S4-18). 예약은 최악 비용(최대 응답 토큰 × 최고 단가)이라 실제 비용보다 몇 배 크다.
// 끝난 호출 중 실제 비용이 확인된 것(성공의 사용량, 처리되지 않은 실패의 0)은 실제 비용으로 세고,
// 보내는 중이거나 결과를 알 수 없는 호출은 예약 그대로 센다(근거 없이 한도를 돌려주지 않는다).

const NOW = 1_000_000;
function setup({ budget = 500_000, maxCalls = 20 } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ce7_tasks (id TEXT, workspace_id TEXT, state TEXT, lease_owner TEXT, lease_generation INTEGER, lease_until_ms INTEGER, cancel_requested INTEGER);
    CREATE TABLE ce7_provider_calls (id TEXT, workspace_id TEXT, task_id TEXT, provider TEXT, purpose TEXT, request_hash TEXT, status TEXT,
      reserved_micro_usd INTEGER, verified_micro_usd INTEGER, lease_generation INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER);
    INSERT INTO ce7_tasks VALUES ('t1', 'w1', 'running', 'worker', 1, ${NOW + 60_000}, 0);`);
  const ledger = createLinerLedger({ db, owner: 'worker', now: () => NOW, maxCalls, budgetMicroUsd: budget });
  const call = { workspaceId: 'w1', taskId: 't1', leaseGeneration: 1 };
  const reserve = micro => ledger.reserve(call, `hash-${Math.random()}`, micro, 'chat');
  const finish = (micro, status, verified) => { const r = reserve(micro); assert.equal(r.ok, true); ledger.dispatch(r.callId); if (status) ledger.settle(r.callId, status, verified); return r; };
  return { db, ledger, reserve, finish };
}

test('a succeeded call counts its verified cost, not its worst-case reservation', () => {
  const { reserve, finish } = setup({ budget: 500_000 });
  finish(400_000, 'succeeded', 60_000);
  // 예약 합계로 세면 400,000 + 400,000 > 500,000으로 거절됐다(사용자 화면의 LINER_BUDGET_LIMIT).
  assert.equal(reserve(400_000).ok, true);
});

test('calls without a known outcome keep their full reservation', () => {
  const unknown = setup({ budget: 500_000 });
  unknown.finish(400_000, 'unknown', null);
  assert.deepEqual(unknown.reserve(400_000), { ok: false, code: 'LINER_BUDGET_LIMIT' });

  const inFlight = setup({ budget: 500_000 });
  inFlight.finish(400_000, null);
  assert.deepEqual(inFlight.reserve(400_000), { ok: false, code: 'LINER_BUDGET_LIMIT' });

  const reservedOnly = setup({ budget: 500_000 });
  assert.equal(reservedOnly.reserve(400_000).ok, true);
  assert.deepEqual(reservedOnly.reserve(400_000), { ok: false, code: 'LINER_BUDGET_LIMIT' });
});

test('a call the provider did not process (settled failed with 0) releases its reservation', () => {
  const { reserve, finish } = setup({ budget: 500_000 });
  finish(400_000, 'failed', 0);
  assert.equal(reserve(400_000).ok, true);
});

test('verified costs still add up to the budget, and the call-count limit is unchanged', () => {
  const budget = setup({ budget: 500_000 });
  budget.finish(200_000, 'succeeded', 200_000);
  budget.finish(200_000, 'succeeded', 200_000);
  assert.deepEqual(budget.reserve(200_000), { ok: false, code: 'LINER_BUDGET_LIMIT' }, '400,000 spent + 200,000 reserved > 500,000');
  assert.equal(budget.reserve(100_000).ok, true, '400,000 + 100,000 = 500,000 is allowed');

  const calls = setup({ budget: 10_000_000, maxCalls: 2 });
  calls.finish(100_000, 'succeeded', 1_000);
  calls.finish(100_000, 'failed', 0);
  assert.deepEqual(calls.reserve(100_000), { ok: false, code: 'LINER_CALL_LIMIT' });
});

test('search and chat budgets stay separate', () => {
  const { db, ledger, finish } = setup({ budget: 500_000 });
  finish(450_000, 'unknown', null);
  const search = ledger.reserve({ workspaceId: 'w1', taskId: 't1', leaseGeneration: 1 }, 'search-hash', 400_000, 'search');
  assert.equal(search.ok, true);
  assert.equal(db.prepare("SELECT count(*) AS n FROM ce7_provider_calls WHERE purpose = 'search'").get().n, 1);
});
