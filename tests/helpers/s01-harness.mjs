import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../packages/db/src/index.ts';
import { readConfig } from '../../apps/api/src/config.ts';
import { createApiServer } from '../../apps/api/src/server.ts';
import { createObjectStore } from '../../apps/api/src/resume/storage.ts';
import { runExtractionTask } from '../../apps/api/src/resume/extraction.ts';

// 실제 HTTP socket으로 S01 경로를 호출한다. 임시 폴더의 DB·파일만 사용한다.
export const ORIGIN = 'http://127.0.0.1:4310';

export function tempFolder(prefix) {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  return { folder, cleanup: () => rmSync(folder, { recursive: true, force: true }) };
}

export async function startApi(folder, { autoExtract = true, linerMessages } = {}) {
  const config = { ...readConfig({}), port: 0, databasePath: join(folder, 'app.sqlite'), objectDir: join(folder, 'objects') };
  const db = openDatabase(config.databasePath);
  const store = createObjectStore(config.objectDir);
  const extraction = { db, store, owner: `test-${randomUUID()}`, leaseMs: config.limits.extractionLeaseMs, now: Date.now };
  const pending = [];
  const schedule = taskId => { if (autoExtract) pending.push(runExtractionTask(extraction, taskId)); };
  const server = createApiServer(config, db, { store, schedule, linerMessages });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  return {
    base, db, store, extraction, config,
    settle: () => Promise.all(pending.splice(0)),
    stop: () => new Promise(resolve => server.close(() => { db.close(); resolve(); })),
  };
}

export async function login(api, profile) {
  const response = await fetch(`${api.base}/api/v1/local-dev/session`, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }),
  });
  if (response.status !== 201) throw new Error(`login failed ${response.status}`);
  const cookies = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const body = await response.json();
  return { cookie: cookies, csrf: body.csrf_token, workspaceId: body.session.workspace_id };
}

export function client(api, user) {
  const request = async (method, path, { body, json, headers = {}, key, raw = false } = {}) => {
    const init = { method, headers: { Cookie: user?.cookie ?? '', ...headers } };
    if (method !== 'GET') {
      init.headers.Origin ??= ORIGIN;
      if (user) init.headers['X-CSRF-Token'] ??= user.csrf;
      init.headers['Idempotency-Key'] ??= key ?? `key-${randomUUID()}`;
    }
    if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
    if (body !== undefined) init.body = body;
    const response = await fetch(api.base + path, init);
    const payload = raw ? Buffer.from(await response.arrayBuffer()) : response.status === 204 ? null : await response.json();
    return { status: response.status, body: payload, headers: response.headers };
  };
  return {
    get: (path, options) => request('GET', path, options),
    post: (path, options) => request('POST', path, options),
    patch: (path, options) => request('PATCH', path, options),
    del: (path, options) => request('DELETE', path, options),
    upload: (path, bytes, filename, options = {}) => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
      return request('POST', path, { ...options, body: form });
    },
  };
}
