import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readConfig, readLinerApiKey } from '../apps/api/src/config.ts';
import { createLinerChatProvider } from '../packages/liner/src/chat.ts';
import { createLinerLedger, readLinerUsage } from '../apps/worker/src/liner-ledger.ts';
import { startApi, login, client } from '../tests/helpers/s01-harness.mjs';
import { startTailoring, say } from '../tests/helpers/s04-harness.mjs';
import { confirmFixture } from '../tests/helpers/s02-harness.mjs';
import { createLinerReviewProvider } from '../packages/liner/src/review.ts';
import { runReviewTask } from '../apps/worker/src/review-task.ts';

// S4-14 Liner 대화 실호출 확인(유료). 합성 이력서를 실제 API 경로로 확정 → mock 검색(유료 검색 없음) → 공고 맞춤 대화 1건을 live provider로 보낸다.
// - 한 번 실행에 Liner 대화 요청은 최대 1건이다. 호출 수·예산은 아래 원장 DB에 누적되어 여러 번 실행해도 합계로 막힌다.
// - API 키는 존재 여부만 출력한다. 응답 문장·제안은 합성 이력서에 대한 것이라 출력해도 된다.
// 사용: CHAT_MODE=liner LINER_CHAT_MAX_CALLS=10 LINER_CHAT_BUDGET_MICRO_USD=3000000 node --env-file-if-exists=.env scripts/liner-chat-check.mjs [--usage] [--review[=frontend|backend]] [--message="..."] [--routing=cost|balanced|quality]
//   --review  대화 대신 AI 1차 점검(S1-14) 1건을 합성 이력서(기본 frontend)로 보낸다.
//   --usage  원장 사용량만 출력하고 호출하지 않는다.
//   LINER_CHAT_CHECK_DIR  원장 DB 폴더(기본 .data/liner-chat-check). 지우면 한도 집계가 처음부터 다시 센다.

let config;
try {
  config = readConfig(process.env);
} catch (error) {
  console.error(`LINER_CHAT_CHECK_REFUSED ${error instanceof Error ? error.message : 'invalid config'}`);
  process.exit(2);
}
if (!config.chat) {
  console.error('LINER_CHAT_CHECK_REFUSED: CHAT_MODE=liner와 LINER_CHAT_MAX_CALLS·LINER_CHAT_BUDGET_MICRO_USD를 명령줄에 지정하세요.');
  process.exit(2);
}
const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const message = arg('message') ?? '이 공고에 맞춰 이력서를 고쳐줘. 공고에서 중요한 기술이 먼저 보이게 해줘.';
const routing = arg('routing') ?? config.chat.routing;
if (!['cost', 'balanced', 'quality'].includes(routing)) { console.error('LINER_CHAT_CHECK_REFUSED: --routing은 cost·balanced·quality'); process.exit(2); }

const folder = resolve(process.env.LINER_CHAT_CHECK_DIR ?? '.data/liner-chat-check');
mkdirSync(folder, { recursive: true });
const api = await startApi(folder);
const printUsage = label => {
  const usage = readLinerUsage(api.db, 'chat');
  console.log(`${label}: 대화 호출 ${usage.calls} / ${config.chat.maxCalls} · 예약 ${usage.reserved_micro_usd} / ${config.chat.budgetMicroUsd} micro-USD · 확인 비용 ${usage.verified_micro_usd} micro-USD · 결과 불명 ${usage.unknown_calls}건`);
};
try {
  console.log(`LINER_API_KEY: ${process.env.LINER_API_KEY?.trim() ? 'present' : 'missing'} · 원장 DB: ${folder} · routing ${routing}`);
  printUsage('원장 사용량(실행 전)');
  const reviewArg = process.argv.find(item => item === '--review' || item.startsWith('--review='));
  if (reviewArg && !process.argv.includes('--usage')) {
    const resume = reviewArg.includes('=') ? reviewArg.split('=')[1] : 'frontend';
    if (!['frontend', 'backend'].includes(resume)) throw new Error('--review은 frontend 또는 backend');
    api.config.chatMode = 'live';
    const http = client(api, await login(api, `liner-review-check-${Date.now()}`));
    const { revision } = await confirmFixture(api, http, resume);
    const accepted = (await http.post(`/api/v1/resume-fact-revisions/${revision.id}/ai-reviews`, { json: {} })).body;
    const owner = `liner-review-check-${randomUUID()}`;
    const ledger = createLinerLedger({ db: api.db, owner, now: Date.now, maxCalls: config.chat.maxCalls, budgetMicroUsd: config.chat.budgetMicroUsd });
    const provider = createLinerReviewProvider({
      apiKey: readLinerApiKey(process.env), fetch: globalThis.fetch, ledger, routing,
      onUsage: usage => console.log(`사용량: 답한 모델 ${usage.model} · 입력 ${usage.prompt_tokens} · 출력 ${usage.completion_tokens} 토큰 · ${usage.micro_usd} micro-USD`),
    });
    const startedAt = Date.now();
    const result = await runReviewTask({ db: api.db, owner, leaseMs: config.limits.tailorLeaseMs, now: Date.now, provider }, accepted.task.id);
    const review = (await http.get(`/api/v1/resume-ai-reviews/${accepted.resource_id}`)).body;
    console.log(`AI 점검(합성 ${resume}) ${result} · ${((Date.now() - startedAt) / 1000).toFixed(1)}초 · state ${review.state} · error_code ${review.error_code ?? '-'}`);
    if (review.summary) console.log(`요약: ${review.summary}`);
    review.items.forEach((item, index) => console.log(`${index + 1}. ${item.title} — ${item.detail}${item.question ? ` / 질문: ${item.question}` : ''} (사실 ${item.fact_ids.length}개)`));
    printUsage('원장 사용량(실행 후)');
    if (result !== 'succeeded') process.exitCode = 1;
  } else if (!process.argv.includes('--usage')) {
    api.config.chatMode = 'live';
    const http = client(api, await login(api, `liner-chat-check-${Date.now()}`));
    const started = await startTailoring(api, http);
    console.log(`합성 공고: ${started.job.company_name} · ${started.job.title} (${started.job.data_origin})`);
    console.log(`보낸 메시지: ${message}`);
    const owner = `liner-chat-check-${randomUUID()}`;
    const ledger = createLinerLedger({ db: api.db, owner, now: Date.now, maxCalls: config.chat.maxCalls, budgetMicroUsd: config.chat.budgetMicroUsd });
    const provider = createLinerChatProvider({
      apiKey: readLinerApiKey(process.env), fetch: globalThis.fetch, ledger, routing,
      onUsage: usage => console.log(`사용량: 답한 모델 ${usage.model} · 입력 ${usage.prompt_tokens} · 출력 ${usage.completion_tokens} 토큰 · ${usage.micro_usd} micro-USD`),
    });
    const startedAt = Date.now();
    const { result, task, proposal } = await say(api, http, started.session.id, message, { owner, provider });
    console.log(`작업 ${result} · ${((Date.now() - startedAt) / 1000).toFixed(1)}초 · error_code ${task.error_code ?? '-'} · transmission ${task.provider_transmission}`);
    const reply = api.db.prepare("SELECT content FROM ce7_messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at_ms DESC LIMIT 1").get(started.session.id);
    if (reply) console.log(`AI 답변: ${reply.content}`);
    const result_json = api.db.prepare('SELECT result_json FROM ce7_tasks WHERE id = ?').get(task.id)?.result_json;
    const questions = result_json ? JSON.parse(String(result_json)).questions ?? [] : [];
    (proposal?.changes ?? []).forEach((change, index) => console.log(`제안 ${index + 1}. ${change.operation} ${change.block_id}: ${change.before ?? '-'} → ${change.after ?? '-'} (근거 ${change.fact_ids.length}개 · ${change.reason})`));
    if (!proposal) console.log('통과한 변경 제안 없음');
    questions.forEach(text => console.log(`질문/제외: ${text}`));
    printUsage('원장 사용량(실행 후)');
    if (result !== 'succeeded') process.exitCode = 1;
  }
} finally {
  await api.stop();
}
