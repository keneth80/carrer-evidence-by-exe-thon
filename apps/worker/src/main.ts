import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../../../packages/db/src/index.ts';
import { readConfig, readLinerApiKey } from '../../api/src/config.ts';
import { createMockSearchProvider } from '../../../packages/search/src/provider.ts';
import type { SearchProvider } from '../../../packages/search/src/provider.ts';
import { createLinerResearchProvider, createLinerWebSearchProvider } from '../../../packages/liner/src/web-search.ts';
import { createLinerLedger } from './liner-ledger.ts';
import { runSearchTask } from './search-task.ts';
import type { SearchWorkerDeps } from './search-task.ts';
import { createMockChatProvider } from '../../../packages/tailor/src/provider.ts';
import { createLinerChatProvider } from '../../../packages/liner/src/chat.ts';
import { createObjectStore } from '../../api/src/resume/storage.ts';
import { runTailorTask } from './tailor-task.ts';
import { runRenderTask } from './render-task.ts';
import { runObserveTask, sweepStaleDispatches } from './observe-task.ts';
import { runDiscoverTask } from './discover-task.ts';
import { runReviewTask } from './review-task.ts';
import { createMockReviewProvider } from '../../../packages/tailor/src/review-provider.ts';
import { createLinerReviewProvider } from '../../../packages/liner/src/review.ts';
import { runSupplementTask } from './supplement-task.ts';
import { createMockSupplementProvider } from '../../../packages/tailor/src/supplement.ts';
import { createLinerSupplementProvider } from '../../../packages/liner/src/supplement.ts';
import { createMockTailorStageProvider } from '../../../packages/tailor/src/jd-check.ts';
import { createLinerTailorStageProvider } from '../../../packages/liner/src/tailor-stages.ts';

// 영속 작업 worker. API와 같은 DATABASE_PATH·OBJECT_DIR의 search_jobs·tailor_resume·render_resume·submit_application(접수 확인) 작업을 lease로 집어 실행한다.
// 재시작하면 queued 작업과 lease가 만료된 running 작업을 다시 집는다. 검색은 LINER_MODE(mock 기본·live=Liner 웹 검색), 대화는 mock만 허용한다.

const config = readConfig();
const db = openDatabase(config.databasePath);
const owner = `worker-${randomUUID()}`;
// live 호출은 원장 한도(호출 수·예산) 안에서만 나간다. 원장 lease 확인에 이 worker의 owner를 쓴다.
const searchProvider: SearchProvider = config.liner
  ? createLinerWebSearchProvider({ apiKey: readLinerApiKey(), fetch, ledger: createLinerLedger({ db, owner, now: Date.now, ...config.liner }) })
  : createMockSearchProvider();
const deps: SearchWorkerDeps = { db, owner, leaseMs: config.limits.searchLeaseMs, now: Date.now, provider: searchProvider };
// 대화 수정(CHAT_MODE=liner)은 대화 전용 원장 한도 안에서만 나간다. 사용량은 모델·토큰·비용만 남기고 내용은 남기지 않는다.
const linerChat = config.chat ? {
  apiKey: readLinerApiKey(), fetch, routing: config.chat.routing,
  ledger: createLinerLedger({ db, owner, now: Date.now, maxCalls: config.chat.maxCalls, budgetMicroUsd: config.chat.budgetMicroUsd }),
  onUsage: (usage: { model: string; prompt_tokens: number; completion_tokens: number; micro_usd: number }) => console.log(`LINER_CHAT_USAGE model=${usage.model} prompt_tokens=${usage.prompt_tokens} completion_tokens=${usage.completion_tokens} micro_usd=${usage.micro_usd}`),
} : null;
const chatProvider = linerChat ? createLinerChatProvider(linerChat) : createMockChatProvider();
// AI 1차 점검(S1-14)도 같은 대화 원장(purpose=chat) 한도 안에서만 나간다.
const review = { db, owner, leaseMs: config.limits.tailorLeaseMs, now: Date.now, provider: linerChat ? createLinerReviewProvider(linerChat) : createMockReviewProvider() };
// 기본 이력서 보완 대화(S1-16)도 같은 대화 원장(purpose=chat) 한도 안에서만 나간다.
// 단계별(staged)이면 턴마다 유료 호출이 1~2건(첫 턴: AI 점검, 답변 턴: 초안 + 근거 검토) 쓰인다(S1-17).
const supplement = { db, owner, leaseMs: config.limits.tailorLeaseMs, now: Date.now, provider: linerChat ? createLinerSupplementProvider(linerChat) : createMockSupplementProvider(), pipeline: config.supplementPipeline };
// 공고 맞춤 대화(S1-18)는 단계별로 돈다: JD 점검 턴 = AI 점검 1건, 답변 턴 = 수정안 작성 + 근거 검토 2건(같은 대화 원장 purpose=chat).
// 보충 검색(S1-29): 실시간 검색과 실호출 대화가 모두 켜져 있을 때만, 공고 검색과 같은 원장 한도(purpose=search) 안에서 쓴다.
const research = config.liner && linerChat ? createLinerResearchProvider({ apiKey: readLinerApiKey(), fetch, ledger: createLinerLedger({ db, owner, now: Date.now, ...config.liner }) }) : null;
const tailor = { db, owner, leaseMs: config.limits.tailorLeaseMs, now: Date.now, provider: chatProvider, stages: linerChat ? createLinerTailorStageProvider(linerChat) : createMockTailorStageProvider(), research };
const render = { db, owner, leaseMs: config.limits.renderLeaseMs, now: Date.now, store: createObjectStore(config.objectDir) };
const observe = { db, owner, leaseMs: config.limits.observeLeaseMs, now: Date.now };
const sweep = { db, now: Date.now, reportTimeoutMs: config.limits.dispatchReportTimeoutMs };
// 유사 공고 자동 준비(S06)는 한 번에 여러 공고를 처리하므로 유료 대화를 쓰지 않고 mock 규칙 수정만 한다(DECISIONS S4-14).
const discover = { db, owner, leaseMs: config.limits.searchLeaseMs, now: Date.now, search: deps.provider, chat: createMockChatProvider(), store: render.store };

let stopping = false;
const stop = () => { stopping = true; };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

console.log(`Career Evidence worker: search_jobs(provider=${deps.provider.mode}) · tailor_resume(chat=${tailor.provider.mode}, staged) · render_resume(pdf) · submit_application(observe) · discover_similar(prepare, 제출 없음) · review_resume(${review.provider.mode}) · supplement_resume(${supplement.provider.mode}, ${supplement.pipeline})`);
try {
  while (!stopping) {
    let result;
    try {
      const ran = [await runSearchTask(deps), await runTailorTask(tailor), await runRenderTask(render), runObserveTask(observe), await runDiscoverTask(discover), await runReviewTask(review), await runSupplementTask(supplement)];
      const swept = sweepStaleDispatches(sweep);
      result = ran.every(item => item === 'idle') && swept === 0 ? 'idle' : 'worked';
    } catch (error) {
      // 작업 내용·검색어는 로그에 남기지 않는다. lease가 끝나면 다음 claim에서 다시 시도한다.
      console.error('WORKER_TASK_ERROR', error instanceof Error ? error.message : 'unknown');
      result = 'idle';
    }
    if (result === 'idle') await delay(config.limits.workerPollMs);
  }
} finally {
  db.close();
}
