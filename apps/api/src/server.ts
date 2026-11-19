import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { describeDatabase } from '../../../packages/db/src/index.ts';
import { buildPreview } from './preview.ts';
import type { Config } from './config.ts';
import type { Reply } from './http.ts';
import { routeProductRequest } from './product.ts';
import type { ProductDeps } from './product.ts';
import { routeExecutorRequest } from './apply/executor.ts';
import { routeDemoSiteRequest } from './demo-site/routes.ts';

// 실행기(Chrome 확장) 경로는 확장 origin에서 오며 기기 토큰으로 인증한다. 그 밖의 경로는 앱 origin만 받는다.
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const EXECUTOR_PREFIX = '/api/executor/v1/';
const DEMO_SITE_PREFIX = '/api/demo-site/';

// 테스트는 이 경계를 직접 호출한다. socket/브라우저 검증과 별개이다.
// searchMode: 검색 provider 설정(LINER_MODE). health가 실제 설정과 다른 검색 상태를 말하지 않게 한다.
export async function routeRequest(method: string, target: string, db: DatabaseSync, searchMode: Config['mode'] = 'mock', chatMode: Config['chatMode'] = 'mock'): Promise<Reply> {
  const url = new URL(target, 'http://127.0.0.1');
  if (method === 'GET' && url.pathname === '/api/health') {
    return { status: 200, body: {
      service: 'career-evidence', version: '0.7.0', stage: 's06-similar-prepare', mode: searchMode,
      database: describeDatabase(db),
      target_contract: 'v0.7', resume_intake: 'implemented_local_dev_session', resume_search: 'implemented_mock_provider',
      conversational_editing: chatMode === 'live' ? 'implemented_liner_chat' : 'implemented_mock_chat', resume_pdf: 'implemented_pdf_lib', auto_apply: 'prepare_only_no_submit',
      product_api: 'partial_s06', worker: 'search_tailor_render_observe_discover_mock', live_search: searchMode === 'live' ? 'implemented_liner_web' : 'mock', browser_apply: 'implemented_self_form_chrome',
    } };
  }
  if (method === 'GET' && url.pathname === '/api/starter/preview') {
    const priority = url.searchParams.get('remote') ?? 'required';
    if (priority !== 'required' && priority !== 'preferred') {
      return { status: 400, body: { code: 'INVALID_PREVIEW_PRIORITY', message: 'remote는 required 또는 preferred입니다.' } };
    }
    return { status: 200, body: await buildPreview(priority) };
  }
  if (url.pathname.startsWith('/api/v1/')) {
    return { status: 501, body: {
      code: 'PRODUCT_API_NOT_IMPLEMENTED',
      message: '이 /api/v1 경로의 handler는 아직 구현되지 않았습니다. 현재 구현 범위는 S01(이력서 등록·확정), S02(mock 검색), S04(대화형 편집·확정·PDF), S05(자체 테스트 폼 지원·이력)입니다.',
    } };
  }
  return { status: 404, body: { code: 'NOT_FOUND' } };
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;
    req.on('data', (chunk: Buffer) => {
      if (exceeded) return;
      size += chunk.length;
      // 한도를 넘으면 더 읽지 않고 바로 413 처리로 넘긴다. 연결은 응답 뒤 닫는다.
      if (size > limit) { exceeded = true; chunks.length = 0; req.pause(); resolve(null); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

// headOnly: HEAD 요청은 GET과 같은 처리·header를 보내고 본문은 보내지 않는다(파일 메타 확인용).
function send(res: ServerResponse, reply: Reply, headOnly = false) {
  // 자체 테스트 폼의 응답 유실 재현: 아무 응답 없이 연결을 끊는다.
  if (reply.drop) { res.socket?.destroy(); return; }
  for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);
  if (reply.raw) {
    res.setHeader('Content-Type', reply.raw.contentType);
    res.setHeader('Content-Length', String(reply.raw.bytes.length));
    if (reply.raw.filename) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(reply.raw.filename)}`);
    res.writeHead(reply.status);
    res.end(headOnly ? undefined : reply.raw.bytes);
    return;
  }
  res.writeHead(reply.status);
  res.end(reply.body === undefined ? undefined : JSON.stringify(reply.body));
}

export function createApiServer(config: Config, db: DatabaseSync, product?: Omit<ProductDeps, 'db' | 'config'>) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = randomUUID().replaceAll('-', '');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Request-Id', requestId);
    const expectedHost = `${config.host}:${config.port}`;
    let executorPath = false;
    try { executorPath = new URL(req.url ?? '/', 'http://127.0.0.1').pathname.startsWith(EXECUTOR_PREFIX); } catch { /* 형식 오류 주소는 아래에서 처리한다. */ }
    const originAllowed = !req.headers.origin || req.headers.origin === config.origin || (executorPath && EXTENSION_ORIGIN.test(req.headers.origin));
    if (req.headers.host !== expectedHost || !originAllowed) {
      res.writeHead(403); res.end(JSON.stringify({ code: 'LOCAL_ORIGIN_REQUIRED', request_id: requestId })); return;
    }
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const routed = url.pathname.startsWith('/api/v1/') || url.pathname.startsWith(EXECUTOR_PREFIX) || url.pathname.startsWith(DEMO_SITE_PREFIX);
      if (product && routed) {
        const body = await readBody(req, config.limits.pdfBytes + 128 * 1024);
        if (body === null) {
          res.setHeader('Connection', 'close');
          res.once('finish', () => req.destroy());
          send(res, { status: 413, body: { code: 'BODY_TOO_LARGE', message: '요청 본문이 너무 큽니다.', request_id: requestId } });
          return;
        }
        const headOnly = req.method === 'HEAD';
        const request = { method: headOnly ? 'GET' : req.method ?? 'GET', url, headers: req.headers, body, requestId, nowMs: Date.now() };
        const deps = { ...product, db, config };
        const reply = url.pathname.startsWith(EXECUTOR_PREFIX) ? routeExecutorRequest(deps, request)
          : url.pathname.startsWith(DEMO_SITE_PREFIX) ? await routeDemoSiteRequest(deps, request)
            : await routeProductRequest(deps, request);
        if (reply) { send(res, reply, headOnly); return; }
      }
      send(res, await routeRequest(req.method ?? 'GET', req.url ?? '/', db, config.mode, config.chatMode));
    } catch (error) {
      // 원본 내용·요청 본문은 로그에 남기지 않는다.
      console.error('API_INTERNAL_ERROR', requestId, error instanceof Error ? error.message : 'unknown');
      if (!res.headersSent) send(res, { status: 500, body: { code: 'STARTER_INTERNAL_ERROR', message: '서버 오류가 발생했습니다.', request_id: requestId } });
      else res.end();
    }
  });
}
