import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDatabase } from '../packages/db/src/index.ts';
import { createMockSupplementProvider } from '../packages/tailor/src/supplement.ts';
import { createLinerSupplementProvider } from '../packages/liner/src/supplement.ts';
import { loadEvalFixtures, runSupplementEval } from '../packages/tailor/src/supplement-eval.ts';
import { createLinerLedger, readLinerUsage } from '../apps/worker/src/liner-ledger.ts';
import { readLinerApiKey } from '../apps/api/src/config.ts';

// 보완 대화 single vs staged 비교 평가(개발용, DECISIONS S1-17). 합성 이력서 3개(fixtures/eval/supplement)만 쓴다.
// 사용: node scripts/supplement-eval.mjs [--provider=mock|liner] [--modes=single,staged] [--fixtures=frontend,backend,data] [--max-calls=N] [--budget-micro-usd=N] [--routing=balanced]
// 호출 수: 이력서 1개당 single 3건(첫 턴 1 + 답변 2), staged 5건(AI 점검 1 + 답변마다 초안·근거 검토 2). 3개 전부 두 방식이면 24건.
//  - mock(기본): 네트워크 없음, 결과가 늘 같다.
//  - liner: 유료 호출. --max-calls가 반드시 있어야 하며, 이 실행 전용 원장(.data/supplement-eval/<시각>/ledger.sqlite)이 호출 수·예산을 넘으면 보내지 않는다.
//    키는 환경 변수 LINER_API_KEY로만 읽는다(npm 실행 시 --env-file). 결과·원장 파일에는 키를 남기지 않는다.
// 결과 JSON은 .data/supplement-eval/에 쓴다(.gitignore).

const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')).map(([key, value]) => [key, value ?? 'true']));
const providerName = args.provider ?? 'mock';
const modes = (args.modes ?? 'single,staged').split(',').filter(mode => mode === 'single' || mode === 'staged');
if (!['mock', 'liner'].includes(providerName) || modes.length === 0) {
  console.error('usage: --provider=mock|liner --modes=single,staged [--max-calls=N]');
  process.exit(2);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve('.data/supplement-eval', stamp);
mkdirSync(outDir, { recursive: true });
const only = args.fixtures ? new Set(args.fixtures.split(',')) : null;
const fixtures = loadEvalFixtures().filter(item => !only || only.has(item.id));
if (fixtures.length === 0) { console.error('NO_FIXTURES: --fixtures 값이 fixtures/eval/supplement의 id와 맞지 않습니다.'); process.exit(2); }

// live 원장: 이 실행 전용 임시 DB. 평가 작업마다 running 상태의 작업 행을 만들어 원장의 lease 확인을 통과시킨다.
function liveSetup() {
  const maxCalls = Number(args['max-calls']);
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1) {
    console.error('LINER_EVAL_MAX_CALLS_REQUIRED: --max-calls=N (정수 1 이상) 없이는 유료 호출을 하지 않습니다.');
    process.exit(2);
  }
  const budgetMicroUsd = Number(args['budget-micro-usd'] ?? 1_000_000);
  const db = openDatabase(join(outDir, 'ledger.sqlite'));
  const H = '0'.repeat(64);
  const far = Date.now() + 24 * 60 * 60 * 1000;
  db.exec('BEGIN');
  db.prepare("INSERT INTO workspaces (id, session_token_hash, csrf_token_hash, revision, created_at_ms, expires_at_ms, updated_at_ms) VALUES ('w_eval', ?, ?, 0, 0, ?, 0)").run('1'.repeat(64), H, far);
  db.prepare("INSERT INTO ce7_principals (id, auth_subject, mode, created_at_ms) VALUES ('p_eval', 'eval:supplement', 'synthetic_local', 0)").run();
  db.prepare("INSERT INTO ce7_workspace_owners (workspace_id, principal_id, created_at_ms) VALUES ('w_eval', 'p_eval', 0)").run();
  for (const mode of modes) for (const fixture of fixtures) {
    db.prepare("INSERT INTO ce7_tasks (id, workspace_id, kind, state, input_json, input_hash, lease_owner, lease_generation, lease_until_ms, available_at_ms, created_at_ms, updated_at_ms) VALUES (?, 'w_eval', 'supplement_resume', 'running', '{}', ?, 'eval', 1, ?, 0, 0, 0)")
      .run(`task_eval_${fixture.id}_${mode}`, H, far);
  }
  db.exec('COMMIT');
  const ledger = createLinerLedger({ db, owner: 'eval', now: Date.now, maxCalls, budgetMicroUsd });
  const usage = [];
  const provider = createLinerSupplementProvider({ apiKey: readLinerApiKey(), fetch, ledger, routing: args.routing ?? 'balanced', onUsage: item => usage.push(item) });
  return { db, provider, usage, limits: { maxCalls, budgetMicroUsd }, callFor: (fixture, mode) => ({ workspaceId: 'w_eval', taskId: `task_eval_${fixture}_${mode}`, leaseGeneration: 1 }) };
}

const live = providerName === 'liner' ? liveSetup() : null;
const report = await runSupplementEval({ fixtures, provider: live ? live.provider : createMockSupplementProvider(), modes, callFor: live?.callFor });
const ledger = live ? { limits: live.limits, usage: readLinerUsage(live.db, 'chat'), models: live.usage.map(item => ({ model: item.model, micro_usd: item.micro_usd })) } : null;
live?.db.close();
const file = join(outDir, `report-${providerName}.json`);
writeFileSync(file, JSON.stringify({ provider: providerName, modes, fixtures: fixtures.map(item => item.id), ...report, ledger }, null, 2));
console.log(JSON.stringify({ provider: providerName, summary: report.summary, ledger: ledger && { calls: ledger.usage.calls, verified_micro_usd: ledger.usage.verified_micro_usd, unknown_calls: ledger.usage.unknown_calls }, report: file }, null, 2));
