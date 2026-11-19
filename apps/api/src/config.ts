import { resolve } from 'node:path';

// live 검색은 키와 호출 수·예산 한도가 모두 있을 때만 켠다. 오류에는 값 대신 변수 이름만 쓴다(키 노출 방지).
function readLiner(env: NodeJS.ProcessEnv) {
  const mode = env.LINER_MODE ?? 'mock';
  if (mode === 'mock') return { mode: 'mock' as const, liner: null };
  if (mode !== 'live') throw new Error('LINER_MODE_INVALID: LINER_MODE must be mock or live');
  if (!env.LINER_API_KEY?.trim()) throw new Error('LINER_API_KEY_REQUIRED: LINER_MODE=live needs LINER_API_KEY');
  const maxCalls = Number(env.LINER_MAX_CALLS);
  if (!/^\d+$/.test(env.LINER_MAX_CALLS ?? '') || !Number.isSafeInteger(maxCalls) || maxCalls < 1) {
    throw new Error('LINER_MAX_CALLS_INVALID: LINER_MODE=live needs LINER_MAX_CALLS as an integer >= 1');
  }
  const budgetMicroUsd = Number(env.LINER_BUDGET_MICRO_USD);
  if (!/^\d+$/.test(env.LINER_BUDGET_MICRO_USD ?? '') || !Number.isSafeInteger(budgetMicroUsd) || budgetMicroUsd < 1) {
    throw new Error('LINER_BUDGET_INVALID: LINER_MODE=live needs LINER_BUDGET_MICRO_USD as an integer > 0');
  }
  return { mode: 'live' as const, liner: { maxCalls, budgetMicroUsd } };
}

// 대화 수정 provider(DECISIONS S4-14). CHAT_MODE=liner면 Liner Router API를 쓰며, 검색과 별도인 호출 수·예산 한도가 모두 있어야 한다.
const positiveInt = (value: string | undefined) => /^\d+$/.test(value ?? '') && Number.isSafeInteger(Number(value)) && Number(value) >= 1;
function readChat(env: NodeJS.ProcessEnv) {
  const mode = env.CHAT_MODE ?? 'mock';
  if (mode === 'mock') return { chatMode: 'mock' as const, chat: null };
  if (mode !== 'liner') throw new Error('CHAT_MODE_INVALID: CHAT_MODE must be mock or liner');
  if (!env.LINER_API_KEY?.trim()) throw new Error('LINER_API_KEY_REQUIRED: CHAT_MODE=liner needs LINER_API_KEY');
  if (!positiveInt(env.LINER_CHAT_MAX_CALLS)) throw new Error('LINER_CHAT_MAX_CALLS_INVALID: CHAT_MODE=liner needs LINER_CHAT_MAX_CALLS as an integer >= 1');
  if (!positiveInt(env.LINER_CHAT_BUDGET_MICRO_USD)) throw new Error('LINER_CHAT_BUDGET_INVALID: CHAT_MODE=liner needs LINER_CHAT_BUDGET_MICRO_USD as an integer > 0');
  const routing = (env.LINER_CHAT_ROUTING ?? 'balanced') as 'cost' | 'balanced' | 'quality';
  if (!['cost', 'balanced', 'quality'].includes(routing)) throw new Error('LINER_CHAT_ROUTING_INVALID: cost, balanced or quality');
  return { chatMode: 'live' as const, chat: { maxCalls: Number(env.LINER_CHAT_MAX_CALLS), budgetMicroUsd: Number(env.LINER_CHAT_BUDGET_MICRO_USD), routing } };
}

// 보완 대화 실행 방식(DECISIONS S1-17): staged(기본, 규칙 점검 → AI 점검 / 초안 → 근거 검토) 또는 single(비교용 한 번 호출).
function readSupplementPipeline(env: NodeJS.ProcessEnv): 'staged' | 'single' {
  const value = env.SUPPLEMENT_PIPELINE ?? 'staged';
  if (value !== 'staged' && value !== 'single') throw new Error('SUPPLEMENT_PIPELINE_INVALID: staged or single');
  return value;
}

// 키 값은 설정 객체에 담지 않는다(설정이 로그·응답으로 새지 않게). live provider를 만드는 worker만 읽는다.
export function readLinerApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.LINER_API_KEY?.trim();
  if (!key) throw new Error('LINER_API_KEY_REQUIRED: LINER_MODE=live or CHAT_MODE=liner needs LINER_API_KEY');
  return key;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const { mode, liner } = readLiner(env);
  const port = Number(env.API_PORT ?? '4311');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_API_PORT');
  const origin = env.DEMO_ORIGIN ?? 'http://127.0.0.1:4310';
  if (origin !== 'http://127.0.0.1:4310') throw new Error('STARTER_ORIGIN_FIXED: update web/extension/API together for a different origin');
  // 외부 채용사이트 브라우저 지원 스위치. 자체 테스트 폼(S05)은 로컬 개발 범위라 이 값과 무관하며, 외부 사이트 adapter는 아직 없다.
  if (env.BROWSER_APPLY_ENABLED && env.BROWSER_APPLY_ENABLED !== 'false') {
    throw new Error('BROWSER_APPLY_NOT_IMPLEMENTED');
  }
  const { chatMode, chat } = readChat(env);
  // 운영 로그인 제공자는 S09 범위다. 현재는 loopback 전용 로컬 개발 세션만 허용한다.
  const authMode = env.AUTH_MODE ?? 'local_dev';
  if (authMode !== 'local_dev') throw new Error('AUTH_PROVIDER_NOT_IMPLEMENTED: only AUTH_MODE=local_dev on 127.0.0.1 is available');
  if (env.NODE_ENV === 'production') throw new Error('LOCAL_DEV_AUTH_NOT_FOR_PRODUCTION: production login provider is not implemented (S09)');
  return {
    mode,
    liner,
    chatMode,
    chat,
    supplementPipeline: readSupplementPipeline(env),
    authMode: 'local_dev' as const,
    port,
    origin,
    host: '127.0.0.1',
    databasePath: resolve(env.DATABASE_PATH ?? '.data/career-evidence.sqlite'),
    objectDir: resolve(env.OBJECT_DIR ?? '.data/objects'),
    limits: {
      pdfBytes: 5 * 1024 * 1024,
      pastedCharacters: 100_000,
      jsonBodyBytes: 1024 * 1024,
      sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
      extractionLeaseMs: 60_000,
      // 검색 worker lease. heartbeat가 leaseMs/3마다 연장하며, 끊기면 만료 후 다른 worker가 다시 집는다.
      searchLeaseMs: 30_000,
      workerPollMs: 1_000,
      tailorLeaseMs: 60_000,
      renderLeaseMs: 60_000,
      // S05 브라우저 지원: 1회 연결 코드·수동 제출 권한·폼 관측값의 유효 시간, 전송 뒤 실행기 보고가 없을 때 '접수 불명'으로 바꾸는 시간.
      pairingTtlMs: 10 * 60_000,
      authorizationTtlMs: 15 * 60_000,
      observationMaxAgeMs: 30 * 60_000,
      dispatchReportTimeoutMs: 3 * 60_000,
      observeLeaseMs: 30_000,
      observeMinDispatchAgeMs: 60_000,
    },
  };
}

export type Config = ReturnType<typeof readConfig>;
