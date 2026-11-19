import { randomBytes } from 'node:crypto';
import { SELF_FORM_SITE_ID } from '../../../../packages/apply/src/self-form.ts';
import { iso, isPlainObject, newId, problem, readJson, sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import { idempotentWrite, readIdempotencyKey, replayIfStored, storeResponse } from '../idempotency.ts';
import type { ApplyDeps } from './applications.ts';
import { bindingFingerprint } from './repository.ts';

// 실행기(Chrome 확장) 기기 연결. 웹 화면에서 짧은 유효기간의 1회 코드를 만들고, 확장이 그 코드로 기기 토큰을 받는다.
// 코드·토큰 원문은 저장하지 않는다(hash만). 연결 코드는 idempotency 응답 저장소에도 남기지 않는다:
// 같은 Idempotency-Key로 다시 요청하면 새 코드를 만들지도, 이전 코드를 다시 보여주지도 않고 409를 돌려준다.

export type DeviceRow = { id: string; workspace_id: string; executor: 'chrome' | 'ego'; label: string; token_hash: string; created_at_ms: number; last_seen_at_ms: number; revoked_at_ms: number | null };

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_OPEN_PAIRINGS = 5;

export const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');
export const codeHash = (code: string) => sha256Hex(`pairing|${normalizeCode(code)}`);

export function deviceBody(row: DeviceRow) {
  return { id: row.id, executor: row.executor, label: row.label, created_at: iso(row.created_at_ms), last_seen_at: iso(row.last_seen_at_ms), revoked_at: row.revoked_at_ms === null ? null : iso(row.revoked_at_ms) };
}

export function createExecutorPairing(deps: ApplyDeps, request: ProductRequest, principal: Principal): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).join() !== 'executor' || body.executor !== 'chrome') return problem(request, 400, 'INVALID_PAIRING', "executor는 'chrome'이어야 합니다. Ego 실행기는 아직 연결하지 않습니다.");
  const ws = principal.workspaceId;
  const now = request.nowMs;
  const requestHash = sha256Hex('createExecutorPairing|chrome');
  const replay = replayIfStored(deps.db, request, ws, 'createExecutorPairing', key.key, requestHash);
  if (replay) return replay;
  const open = deps.db.prepare('SELECT count(*) AS count FROM ce8_executor_pairings WHERE workspace_id = ? AND used_at_ms IS NULL AND expires_at_ms > ?').get(ws, now) as { count: number };
  if (Number(open.count) >= MAX_OPEN_PAIRINGS) return problem(request, 429, 'PAIRING_LIMIT', '사용하지 않은 연결 코드가 많습니다. 잠시 뒤 다시 만들어 주세요.');
  const raw = [...randomBytes(8)].map(byte => ALPHABET[byte % ALPHABET.length]).join('');
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const id = newId('pairing');
  const expires = now + deps.config.limits.pairingTtlMs;
  deps.db.exec('BEGIN IMMEDIATE');
  try {
    deps.db.prepare("INSERT INTO ce8_executor_pairings (id, workspace_id, executor, code_hash, created_at_ms, expires_at_ms) VALUES (?, ?, 'chrome', ?, ?, ?)").run(id, ws, codeHash(code), now, expires);
    storeResponse(deps.db, ws, 'createExecutorPairing', key.key, requestHash, { status: 409, body: { code: 'PAIRING_KEY_REUSED', message: '이미 만든 연결 코드는 다시 보여주지 않습니다. 새 코드를 만들어 주세요.' } }, now);
    deps.db.exec('COMMIT');
  } catch (error) {
    if (deps.db.isTransaction) deps.db.exec('ROLLBACK');
    throw error;
  }
  return { status: 201, body: { id, executor: 'chrome', code, expires_at: iso(expires) } };
}

export function listExecutorDevices(deps: ApplyDeps, _request: ProductRequest, principal: Principal): Reply {
  const rows = deps.db.prepare('SELECT * FROM ce8_executor_devices WHERE workspace_id = ? ORDER BY created_at_ms DESC LIMIT 50').all(principal.workspaceId) as DeviceRow[];
  return { status: 200, body: { items: rows.map(deviceBody) } };
}

// 기기 연결 해제: 기기 토큰·사이트 binding을 더 쓰지 못하게 하고, 아직 전송하지 않은 권한·대기 시도를 멈춘다.
// 이미 전송한 시도는 취소했다고 표시하지 않는다(접수 결과 확인은 계속 가능).
export function revokeExecutorDevice(deps: ApplyDeps, request: ProductRequest, principal: Principal, deviceId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const ws = principal.workspaceId;
  if (!deps.db.prepare('SELECT 1 FROM ce8_executor_devices WHERE workspace_id = ? AND id = ?').get(ws, deviceId)) return problem(request, 404, 'DEVICE_NOT_FOUND', '연결된 기기를 찾을 수 없습니다.');
  return idempotentWrite(deps.db, request, ws, `revokeExecutorDevice:${deviceId}`, key.key, sha256Hex(deviceId), () => {
    const device = deps.db.prepare('SELECT * FROM ce8_executor_devices WHERE workspace_id = ? AND id = ?').get(ws, deviceId) as DeviceRow;
    if (device.revoked_at_ms !== null) return { status: 200, body: deviceBody(device) };
    const now = request.nowMs;
    deps.db.prepare('UPDATE ce8_executor_devices SET revoked_at_ms = ? WHERE workspace_id = ? AND id = ?').run(now, ws, deviceId);
    const bindings = deps.db.prepare('SELECT id FROM ce7_account_bindings WHERE workspace_id = ? AND account_fingerprint = ? AND revoked_at_ms IS NULL').all(ws, bindingFingerprint(SELF_FORM_SITE_ID, deviceId)) as { id: string }[];
    for (const binding of bindings) {
      deps.db.prepare('UPDATE ce7_account_bindings SET revoked_at_ms = ? WHERE workspace_id = ? AND id = ?').run(now, ws, binding.id);
      deps.db.prepare('UPDATE ce7_authorizations SET revoked_at_ms = ? WHERE workspace_id = ? AND account_binding_id = ? AND revoked_at_ms IS NULL').run(now, ws, binding.id);
      deps.db.prepare("UPDATE ce7_attempts SET state = 'failed_before_dispatch', error_code = 'EXECUTOR_REVOKED', updated_at_ms = ? WHERE workspace_id = ? AND state = 'prepared' AND authorization_id IN (SELECT id FROM ce7_authorizations WHERE workspace_id = ? AND account_binding_id = ?)").run(now, ws, ws, binding.id);
    }
    return { status: 200, body: deviceBody(deps.db.prepare('SELECT * FROM ce8_executor_devices WHERE id = ?').get(deviceId) as DeviceRow) };
  });
}
