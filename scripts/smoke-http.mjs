import assert from 'node:assert/strict';
import { openDatabase } from '../packages/db/src/index.ts';
import { readConfig } from '../apps/api/src/config.ts';
import { createApiServer } from '../apps/api/src/server.ts';
import { createObjectStore } from '../apps/api/src/resume/storage.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 비어 있는 port와 memory DB를 사용하여 기존 개발 프로세스·DB를 보존한다.
const config = { ...readConfig({}), port: 0 };
const db = openDatabase(':memory:');
const objects = mkdtempSync(join(tmpdir(), 'smoke-objects-'));
const server = createApiServer(config, db, { store: createObjectStore(objects), schedule: () => {} });
const checks = [];
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  for (const [path, options, expected] of [
    ['/api/health', {}, 200],
    ['/api/starter/preview?remote=required', {}, 200],
    ['/api/starter/preview?remote=preferred', {}, 200],
    ['/api/starter/preview?remote=invalid', {}, 400],
    ['/api/v1/demo/submissions', { method: 'POST' }, 501],
    ['/api/health', { headers: { Origin: 'https://unknown.example' } }, 403],
  ]) {
    const response = await fetch(base + path, options);
    const body = await response.json();
    assert.equal(response.status, expected);
    if (path.endsWith('remote=required')) assert.deepEqual(body.items.map(item => item.assessment.decision), ['review', 'needs_information', 'hold']);
    if (path.endsWith('remote=preferred')) assert.deepEqual(body.items.map(item => item.assessment.decision), ['review', 'review', 'review']);
    checks.push({ path, status: response.status });
  }
  // S01 로컬 개발 세션: 연결 → 제품 세션 조회 → 세션 없는 조회 거절.
  const login = await fetch(base + '/api/v1/local-dev/session', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: 'smoke' }) });
  assert.equal(login.status, 201);
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const session = await fetch(base + '/api/v1/product-session', { headers: { Cookie: cookie } });
  assert.equal(session.status, 200);
  assert.equal((await fetch(base + '/api/v1/resume-documents')).status, 401);
  // S02: 세션 없는 검색 조회 거절, 세션이 있어도 남의/없는 검색은 404.
  assert.equal((await fetch(base + '/api/v1/resume-searches/search_x')).status, 401);
  assert.equal((await fetch(base + '/api/v1/resume-searches/search_x', { headers: { Cookie: cookie } })).status, 404);
  // S04: 세션 없는 편집 세션·파일 조회 거절.
  assert.equal((await fetch(base + '/api/v1/tailoring-sessions/tailor_x')).status, 401);
  assert.equal((await fetch(base + '/api/v1/artifacts/artifact_x/content', { headers: { Cookie: cookie } })).status, 404);
  checks.push({ path: '/api/v1/local-dev/session', status: 201 }, { path: '/api/v1/product-session', status: 200 }, { path: '/api/v1/resume-documents (no session)', status: 401 },
    { path: '/api/v1/resume-searches/{id} (no session)', status: 401 }, { path: '/api/v1/resume-searches/{id} (unknown)', status: 404 },
    { path: '/api/v1/tailoring-sessions/{id} (no session)', status: 401 }, { path: '/api/v1/artifacts/{id}/content (unknown)', status: 404 });
  console.log(JSON.stringify({ status: 'PASS', actual_http_requests: checks.length, checks, external_requests: 0 }, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve));
  db.close();
  rmSync(objects, { recursive: true, force: true });
}

