import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { openDatabase, describeDatabase, contractSchemaUrl } from '../packages/db/src/index.ts';
import { routeRequest } from '../apps/api/src/server.ts';
import { readConfig } from '../apps/api/src/config.ts';

test('SQLite baseline plus v0.7 and v0.7.1–v0.7.6 migrations apply 55 domain tables with active foreign keys', () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(describeDatabase(db).domain_tables, 55);
    assert.equal(describeDatabase(db).foreign_keys, true);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('existing database reopens, but a changed baseline is rejected without resetting it', () => {
  const folder = mkdtempSync(join(tmpdir(), 'career-db-'));
  const path = join(folder, 'app.sqlite');
  try {
    let db = openDatabase(path); const original = describeDatabase(db); db.close();
    db = openDatabase(path); assert.deepEqual(describeDatabase(db), original); db.close();
    const changed = '-- changed baseline\n' + readFileSync(contractSchemaUrl, 'utf8');
    assert.throws(() => openDatabase(path, changed), /SCHEMA_DRIFT/);
    db = openDatabase(path); assert.deepEqual(describeDatabase(db), original); db.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('an unrelated database is not overwritten', () => {
  const folder = mkdtempSync(join(tmpdir(), 'career-unmanaged-'));
  const path = join(folder, 'other.sqlite');
  try {
    const existing = new DatabaseSync(path); existing.exec('CREATE TABLE keep_me (value TEXT)'); existing.close();
    assert.throws(() => openDatabase(path), /UNMANAGED_DATABASE/);
    const after = new DatabaseSync(path); assert.ok(after.prepare("SELECT name FROM sqlite_master WHERE name='keep_me'").get()); after.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('removing an approval-protection trigger is detected on reopen', () => {
  const folder = mkdtempSync(join(tmpdir(), 'career-trigger-drift-'));
  const path = join(folder, 'app.sqlite');
  try {
    const db = openDatabase(path);
    db.exec('DROP TRIGGER application_head_revokes_approval');
    db.close();
    assert.throws(() => openDatabase(path), /DATABASE_OBJECT_DRIFT/);
    const after = new DatabaseSync(path);
    assert.equal(after.prepare("SELECT name FROM sqlite_master WHERE name='application_head_revokes_approval'").get(), undefined);
    after.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('failed initial schema transaction leaves no partial tables', () => {
  const folder = mkdtempSync(join(tmpdir(), 'career-invalid-schema-'));
  const path = join(folder, 'app.sqlite');
  try {
    assert.throws(() => openDatabase(path, 'BEGIN; CREATE TABLE partial (id TEXT); INVALID SQL; COMMIT;'));
    const after = new DatabaseSync(path);
    assert.equal(after.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length, 0); after.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('configuration defaults to mock, refuses live without key and caps, and refuses unimplemented apply modes', () => {
  assert.equal(readConfig({}).mode, 'mock');
  assert.throws(() => readConfig({ LINER_MODE: 'live' }), /LINER_API_KEY_REQUIRED/);
  assert.throws(() => readConfig({ BROWSER_APPLY_ENABLED: 'true' }), /BROWSER_APPLY_NOT_IMPLEMENTED/);
  assert.throws(() => readConfig({ API_PORT: '4311oops' }), /INVALID_API_PORT/);
  assert.throws(() => readConfig({ DEMO_ORIGIN: 'https://unknown.example' }), /STARTER_ORIGIN_FIXED/);
});

test('preview distinguishes unknown from gap and preferred conditions keep the warnings', async () => {
  const db = openDatabase(':memory:');
  try {
    const required = await routeRequest('GET', '/api/starter/preview?remote=required', db);
    assert.equal(required.status, 200);
    assert.deepEqual(required.body.items.map(item => item.assessment.decision), ['review','needs_information','hold']);
    const preferred = await routeRequest('GET', '/api/starter/preview?remote=preferred', db);
    assert.deepEqual(preferred.body.items.map(item => item.assessment.decision), ['review','review','review']);
    assert.deepEqual(preferred.body.items.map(item => item.assessment.evaluations[0].state), ['satisfied','unknown','gap']);
    assert.equal(db.prepare('SELECT count(*) AS n FROM tasks').get().n, 0);
  } finally { db.close(); }
});

test('health names unfinished capabilities and product endpoints never return false success', async () => {
  const db = openDatabase(':memory:');
  try {
    const health = await routeRequest('GET', '/api/health', db);
    assert.equal(health.body.worker, 'search_tailor_render_observe_discover_mock');
    assert.equal(health.body.live_search, 'mock');
    assert.equal(health.body.conversational_editing, 'implemented_mock_chat');
    assert.equal(health.body.browser_apply, 'implemented_self_form_chrome');
    assert.equal(health.body.auto_apply, 'prepare_only_no_submit', 'policy-based submission is not implemented');
    for (const [method, path] of [['POST','/api/v1/searches'],['POST','/api/v1/demo/submissions'],['GET','/api/v1/session']]) {
      const response = await routeRequest(method, path, db); assert.equal(response.status, 501);
    }
    assert.equal((await routeRequest('GET','/api/starter/preview?remote=invalid',db)).status, 400);
  } finally { db.close(); }
});

