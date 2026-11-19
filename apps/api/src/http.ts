import type { IncomingHttpHeaders } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

export type Reply = {
  status: number;
  body?: unknown;
  raw?: { bytes: Uint8Array; contentType: string; filename?: string };
  headers?: Record<string, string | string[]>;
  // 자체 테스트 폼의 '응답 유실' 재현 전용: 응답을 보내지 않고 연결을 끊는다.
  drop?: boolean;
};

export type ProductRequest = {
  method: string;
  url: URL;
  headers: IncomingHttpHeaders;
  body: Buffer;
  requestId: string;
  nowMs: number;
};

export function problem(request: ProductRequest, status: number, code: string, message: string, details?: Record<string, unknown>): Reply {
  return { status, body: { code, message, request_id: request.requestId, ...(details ? { details } : {}) } };
}

export function header(request: ProductRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export type JsonResult = { ok: true; value: unknown } | { ok: false; reply: Reply };

export function readJson(request: ProductRequest, limitBytes: number): JsonResult {
  const type = header(request, 'content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) return { ok: false, reply: problem(request, 415, 'JSON_REQUIRED', 'application/json 본문이 필요합니다.') };
  if (request.body.length > limitBytes) return { ok: false, reply: problem(request, 413, 'BODY_TOO_LARGE', '요청 본문이 너무 큽니다.') };
  try {
    return { ok: true, value: JSON.parse(request.body.toString('utf8')) };
  } catch {
    return { ok: false, reply: problem(request, 400, 'INVALID_JSON', 'JSON 형식이 올바르지 않습니다.') };
  }
}

export const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
export const iso = (ms: number) => new Date(ms).toISOString();

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
