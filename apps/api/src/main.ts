import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../../packages/db/src/index.ts';
import { readConfig, readLinerApiKey } from './config.ts';
import { createLinerLedger } from '../../worker/src/liner-ledger.ts';
import { createLinerStructureProvider } from '../../../packages/liner/src/structure.ts';
import { createApiServer } from './server.ts';
import { createObjectStore } from './resume/storage.ts';
import { createLinerMessageCache } from './resume/liner-messages.ts';
import { recoverExtractionTasks, runExtractionTask } from './resume/extraction.ts';
import type { ExtractionDeps } from './resume/extraction.ts';

const config = readConfig();
const db = openDatabase(config.databasePath);
const store = createObjectStore(config.objectDir);
const owner = `api-${randomUUID()}`;
const linerMessages = createLinerMessageCache();
// 분류 보정(S1-30)은 실호출 대화(CHAT_MODE=liner)일 때만, worker와 같은 대화 원장 한도(purpose=chat) 안에서 나간다. mock이면 규칙 분류만 쓴다.
const structure = config.chat ? createLinerStructureProvider({
  apiKey: readLinerApiKey(), fetch, routing: config.chat.routing,
  ledger: createLinerLedger({ db, owner, now: Date.now, maxCalls: config.chat.maxCalls, budgetMicroUsd: config.chat.budgetMicroUsd }),
  onUsage: usage => console.log(`LINER_CHAT_USAGE model=${usage.model} prompt_tokens=${usage.prompt_tokens} completion_tokens=${usage.completion_tokens} micro_usd=${usage.micro_usd}`),
  onMessages: (call, messages) => linerMessages.set(call.taskId, messages),
}) : null;
const extraction: ExtractionDeps = { db, store, owner, leaseMs: config.limits.extractionLeaseMs, now: Date.now, structure };
const logFailure = (error: unknown) => console.error('EXTRACTION_TASK_FAILED', error instanceof Error ? error.message : 'unknown');
const schedule = (taskId: string) => { setImmediate(() => { runExtractionTask(extraction, taskId).catch(logFailure); }); };

const server = createApiServer(config, db, { store, schedule, linerMessages });
server.on('error', error => {
  console.error('API_START_FAILED', error.message);
  db.close();
  process.exitCode = 1;
});
server.listen(config.port, config.host, () => {
  console.log(`Career Evidence API: http://${config.host}:${config.port} (S01 resume intake · S02 search API, run worker for search_jobs · local dev session)`);
  recoverExtractionTasks(extraction).catch(logFailure);
});
// 재시작 전에 남은 작업이나 lease가 만료된 작업을 주기적으로 다시 집는다. S02 worker 도입 전 임시 실행 경로다.
const sweep = setInterval(() => { recoverExtractionTasks(extraction).catch(logFailure); }, 15_000);
sweep.unref();
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(sweep);
  server.close(() => { db.close(); process.exitCode = 0; });
  server.closeIdleConnections();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
