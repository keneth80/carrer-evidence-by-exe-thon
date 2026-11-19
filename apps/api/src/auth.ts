import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.ts';
import { header, iso, isPlainObject, newId, problem, readJson, sha256Hex } from './http.ts';
import type { ProductRequest, Reply } from './http.ts';

// 로컬 개발 세션: 127.0.0.1에서만 열리는 API가 profile 이름으로 principal을 만든다.
// 운영 사용자 인증이 아니며 S09에서 로그인 제공자로 교체한다. workspace는 항상 서버가 세션에서 정한다.

export const SESSION_COOKIE = 'ce_session';
export const CSRF_COOKIE = 'ce_csrf';
const PROFILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export type Principal = { workspaceId: string; principalId: string; mode: 'authenticated' | 'synthetic_local'; expiresAtMs: number; csrfHash: string };

function parseCookies(request: ProductRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header(request, 'cookie') ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

function sessionCookies(token: string, csrf: string, maxAgeSeconds: number): string[] {
  return [
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`,
    `${CSRF_COOKIE}=${csrf}; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`,
  ];
}

export function productSessionBody(principal: Principal, liveSearch = false) {
  return {
    workspace_id: principal.workspaceId,
    mode: principal.mode,
    capabilities: { resume_upload: true, live_search: liveSearch, browser_apply: false, auto_submit: false },
    expires_at: iso(principal.expiresAtMs),
  };
}

export function authenticate(db: DatabaseSync, request: ProductRequest): Principal | Reply {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return problem(request, 401, 'SESSION_REQUIRED', '로그인이 필요합니다.');
  const row = db.prepare(`SELECT w.id AS workspace_id, w.csrf_token_hash, w.expires_at_ms, p.id AS principal_id, p.mode
    FROM workspaces w JOIN ce7_workspace_owners o ON o.workspace_id = w.id JOIN ce7_principals p ON p.id = o.principal_id
    WHERE w.session_token_hash = ?`).get(sha256Hex(token));
  if (!row) return problem(request, 401, 'SESSION_INVALID', '세션이 없거나 종료되었습니다. 다시 연결하세요.');
  if (Number(row.expires_at_ms) <= request.nowMs) return problem(request, 401, 'SESSION_EXPIRED', '세션이 만료되었습니다. 다시 연결하세요.');
  return { workspaceId: String(row.workspace_id), principalId: String(row.principal_id), mode: row.mode as Principal['mode'], expiresAtMs: Number(row.expires_at_ms), csrfHash: String(row.csrf_token_hash) };
}

export function isReply(value: unknown): value is Reply {
  return isPlainObject(value) && typeof value.status === 'number';
}

// 쿠키 인증 쓰기 요청: 정확한 Origin과 CSRF header(쿠키 값과 별도 전송)를 모두 요구한다.
export function checkWrite(config: Config, request: ProductRequest, principal: Principal): Reply | null {
  if (header(request, 'origin') !== config.origin) return problem(request, 403, 'ORIGIN_REQUIRED', '허용된 화면에서 보낸 요청이 아닙니다.');
  const csrf = header(request, 'x-csrf-token') ?? '';
  const expected = Buffer.from(principal.csrfHash, 'hex');
  const actual = Buffer.from(sha256Hex(csrf), 'hex');
  if (!/^[a-f0-9]{64}$/.test(csrf) || !timingSafeEqual(expected, actual)) return problem(request, 403, 'CSRF_INVALID', '요청 확인 값이 올바르지 않습니다. 화면을 새로고침하세요.');
  return null;
}

function findWorkspace(db: DatabaseSync, subject: string): string | undefined {
  const row = db.prepare('SELECT o.workspace_id FROM ce7_principals p JOIN ce7_workspace_owners o ON o.principal_id = p.id WHERE p.auth_subject = ? ORDER BY o.created_at_ms LIMIT 1').get(subject);
  return row ? String(row.workspace_id) : undefined;
}

export function localDevLogin(db: DatabaseSync, config: Config, request: ProductRequest): Reply {
  if (header(request, 'origin') !== config.origin) return problem(request, 403, 'ORIGIN_REQUIRED', '허용된 화면에서 보낸 요청이 아닙니다.');
  const parsed = readJson(request, 4096);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).join() !== 'profile' || typeof body.profile !== 'string' || !PROFILE_PATTERN.test(body.profile)) {
    return problem(request, 400, 'PROFILE_INVALID', 'profile은 영문 소문자·숫자·-·_ 1~32자입니다.');
  }
  const subject = `local-dev:${body.profile}`;
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  const now = request.nowMs;
  const expires = now + config.limits.sessionTtlMs;
  db.exec('BEGIN IMMEDIATE');
  try {
    let workspaceId = findWorkspace(db, subject);
    if (workspaceId) {
      db.prepare('UPDATE workspaces SET session_token_hash = ?, csrf_token_hash = ?, expires_at_ms = ?, updated_at_ms = ? WHERE id = ?')
        .run(sha256Hex(token), sha256Hex(csrf), expires, now, workspaceId);
    } else {
      workspaceId = newId('ws');
      const principalId = newId('principal');
      db.prepare('INSERT INTO workspaces (id, session_token_hash, csrf_token_hash, revision, current_context_id, created_at_ms, expires_at_ms, budget_limit_micro_usd, updated_at_ms) VALUES (?, ?, ?, 0, NULL, ?, ?, 0, ?)')
        .run(workspaceId, sha256Hex(token), sha256Hex(csrf), now, expires, now);
      db.prepare("INSERT INTO ce7_principals (id, auth_subject, mode, created_at_ms) VALUES (?, ?, 'authenticated', ?)").run(principalId, subject, now);
      db.prepare('INSERT INTO ce7_workspace_owners (workspace_id, principal_id, created_at_ms) VALUES (?, ?, ?)').run(workspaceId, principalId, now);
    }
    db.exec('COMMIT');
    const principal: Principal = { workspaceId, principalId: '', mode: 'authenticated', expiresAtMs: expires, csrfHash: sha256Hex(csrf) };
    return {
      status: 201,
      headers: { 'Set-Cookie': sessionCookies(token, csrf, Math.floor(config.limits.sessionTtlMs / 1000)) },
      body: { session: productSessionBody(principal, config.mode === 'live'), auth_method: 'local_dev_loopback', profile: body.profile, csrf_token: csrf },
    };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export function localDevLogout(db: DatabaseSync, config: Config, request: ProductRequest, principal: Principal): Reply {
  const denied = checkWrite(config, request, principal);
  if (denied) return denied;
  // 세션 token hash를 임의 값으로 바꿔 기존 쿠키를 무효화한다. 자료와 workspace는 유지한다.
  db.prepare('UPDATE workspaces SET session_token_hash = ?, updated_at_ms = ? WHERE id = ?').run(sha256Hex(randomBytes(32)), request.nowMs, principal.workspaceId);
  return { status: 204, headers: { 'Set-Cookie': sessionCookies('', '', 0) } };
}
