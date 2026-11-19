import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readConfig, readLinerApiKey } from '../apps/api/src/config.ts';
import { createLinerWebSearchProvider } from '../packages/liner/src/web-search.ts';
import { createLinerLedger, readLinerUsage } from '../apps/worker/src/liner-ledger.ts';
import { runSearchTask } from '../apps/worker/src/search-task.ts';
import { startApi, login, client } from '../tests/helpers/s01-harness.mjs';
import { confirmFixture, createSearch, jobsOf, workerDeps } from '../tests/helpers/s02-harness.mjs';

// S03 Liner live 실호출 확인(유료). 합성 이력서 1개를 실제 API 경로로 확정하고 검색 작업 1건을 live worker로 실행한다.
// - 한 번 실행에 Liner 요청은 최대 2건이다. 호출 수·예산 한도는 아래 원장 DB에 누적되므로 여러 번 실행해도 합계로 막힌다.
// - API 키는 존재 여부만 출력한다. 포트를 쓰지 않는 임시 서버(127.0.0.1:임의 포트)로 돌려 실행 중인 개발 서버와 겹치지 않는다.
// 사용: LINER_MODE=live LINER_MAX_CALLS=20 LINER_BUDGET_MICRO_USD=10000000 node --env-file-if-exists=.env scripts/liner-live-check.mjs [--usage] [--resume=frontend|backend]
//   --usage  원장 사용량만 출력하고 호출하지 않는다.
//   LINER_CHECK_DIR  원장 DB 폴더(기본 .data/liner-live-check). 지우면 한도 집계도 처음부터 다시 센다.

let config;
try {
  config = readConfig(process.env);
} catch (error) {
  console.error(`LINER_LIVE_CHECK_REFUSED ${error instanceof Error ? error.message : 'invalid config'}`);
  process.exit(2);
}
if (!config.liner) {
  console.error('LINER_LIVE_CHECK_REFUSED: LINER_MODE=live와 LINER_MAX_CALLS·LINER_BUDGET_MICRO_USD를 명령줄에 지정하세요.');
  process.exit(2);
}
const resumeArg = process.argv.find(arg => arg.startsWith('--resume='))?.slice('--resume='.length) ?? 'frontend';
if (!['frontend', 'backend'].includes(resumeArg)) { console.error('LINER_LIVE_CHECK_REFUSED: --resume은 frontend 또는 backend'); process.exit(2); }

const folder = resolve(process.env.LINER_CHECK_DIR ?? '.data/liner-live-check');
mkdirSync(folder, { recursive: true });
const api = await startApi(folder);
const printUsage = label => {
  const usage = readLinerUsage(api.db);
  console.log(`${label}: 호출 ${usage.calls} / ${config.liner.maxCalls} · 예약 ${usage.reserved_micro_usd} / ${config.liner.budgetMicroUsd} micro-USD · 확인 비용 ${usage.verified_micro_usd} micro-USD · 결과 불명 ${usage.unknown_calls}건`);
};
try {
  console.log(`LINER_API_KEY: ${process.env.LINER_API_KEY?.trim() ? 'present' : 'missing'} · 원장 DB: ${folder}`);
  printUsage('원장 사용량(실행 전)');
  if (!process.argv.includes('--usage')) {
    // 이 API가 만드는 검색 실행을 live로 표시한다(LINER_MODE=live로 띄운 API와 같다).
    api.config.mode = 'live';
    const http = client(api, await login(api, `liner-check-${Date.now()}`));
    const { revision } = await confirmFixture(api, http, resumeArg);
    const search = await createSearch(http, revision.id);
    console.log(`검색어(합성 이력서 ${resumeArg}, 앞 2개만 전송): ${search.intent.queries.slice(0, 2).map(item => `"${item.query} 채용"`).join(', ')}`);
    const owner = `liner-check-${randomUUID()}`;
    const ledger = createLinerLedger({ db: api.db, owner, now: Date.now, ...config.liner });
    const provider = createLinerWebSearchProvider({ apiKey: readLinerApiKey(process.env), fetch: globalThis.fetch, ledger });
    const result = await runSearchTask(workerDeps(api, { owner, provider }), search.taskId);
    const task = (await http.get(`/api/v1/product-tasks/${search.taskId}`)).body;
    const { search: run, jobs } = await jobsOf(http, search.searchId);
    console.log(`작업 ${result} · 검색 ${run.state}/${run.outcome ?? '-'} · provider_mode ${run.provider_mode} · error_code ${task.error_code ?? '-'} · transmission ${task.provider_transmission}`);
    jobs.forEach((job, index) => console.log(`${index + 1}. ${job.title} | ${job.company_name} | ${job.site_id} | ${job.canonical_url} | ${job.data_origin}`));
    const rows = api.db.prepare("SELECT status, reserved_micro_usd, verified_micro_usd, lease_generation, request_hash FROM ce7_provider_calls WHERE provider = 'liner' AND task_id = ? ORDER BY created_at_ms, rowid").all(search.taskId);
    rows.forEach(row => console.log(`원장: ${row.status} · 예약 ${row.reserved_micro_usd} · 확인 ${row.verified_micro_usd ?? '-'} · generation ${row.lease_generation} · hash ${String(row.request_hash).slice(0, 12)}…`));
    printUsage('원장 사용량(실행 후)');
    if (result !== 'succeeded') process.exitCode = 1;
  }
} finally {
  await api.stop();
}
