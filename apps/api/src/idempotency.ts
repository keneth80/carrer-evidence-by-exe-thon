import type { DatabaseSync } from 'node:sqlite';
import { header, problem } from './http.ts';
import type { ProductRequest, Reply } from './http.ts';

// workspace + operation + Idempotency-Key로 쓰기 요청 중복을 막는다(contracts/v0.7/SERVICE_RULES.md).
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

export type IdempotencyCheck = { key: string } | { reply: Reply };

export function readIdempotencyKey(request: ProductRequest): IdempotencyCheck {
  const key = header(request, 'idempotency-key') ?? '';
  if (!KEY_PATTERN.test(key)) return { reply: problem(request, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header(8~128자)가 필요합니다.') };
  return { key };
}

// 같은 key·같은 요청이면 저장한 응답을 다시 돌려주고, 다른 내용이면 409다.
export function replayIfStored(db: DatabaseSync, request: ProductRequest, workspaceId: string, operation: string, key: string, requestHash: string): Reply | null {
  const row = db.prepare('SELECT request_hash, response_json FROM ce7_request_keys WHERE workspace_id = ? AND operation = ? AND idempotency_key = ?').get(workspaceId, operation, key);
  if (!row) return null;
  if (row.request_hash !== requestHash) return problem(request, 409, 'IDEMPOTENCY_KEY_REUSED', '같은 Idempotency-Key를 다른 요청에 사용했습니다.');
  const stored = JSON.parse(String(row.response_json)) as { status: number; body: unknown };
  return { status: stored.status, body: stored.body, headers: { 'Idempotent-Replay': 'true' } };
}

export function storeResponse(db: DatabaseSync, workspaceId: string, operation: string, key: string, requestHash: string, reply: { status: number; body: unknown }, nowMs: number) {
  db.prepare('INSERT INTO ce7_request_keys (workspace_id, operation, idempotency_key, request_hash, response_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)')
    .run(workspaceId, operation, key, requestHash, JSON.stringify({ status: reply.status, body: reply.body }), nowMs);
}

type Body = { status: number; body: unknown };

// 같은 Idempotency-Key 재요청은 저장한 응답을 돌려준다. 쓰기와 응답 저장은 한 transaction이다.
export function idempotentWrite(db: DatabaseSync, request: ProductRequest, workspaceId: string, operation: string, key: string, requestHash: string, write: () => Body | Reply): Reply {
  const replay = replayIfStored(db, request, workspaceId, operation, key, requestHash);
  if (replay) return replay;
  db.exec('BEGIN IMMEDIATE');
  try {
    const raced = replayIfStored(db, request, workspaceId, operation, key, requestHash);
    if (raced) { db.exec('ROLLBACK'); return raced; }
    const reply = write();
    if (reply.status >= 400) { db.exec('ROLLBACK'); return reply; }
    storeResponse(db, workspaceId, operation, key, requestHash, { status: reply.status, body: reply.body }, request.nowMs);
    db.exec('COMMIT');
    return reply;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

