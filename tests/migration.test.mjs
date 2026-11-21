import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, describeDatabase, defaultMigrations, contractSchemaUrl } from '../packages/db/src/index.ts';
import { tempFolder } from './helpers/s01-harness.mjs';

// v0.4 DB를 지우지 않고 v0.7 추가 migration을 명시적으로 적용하는지 확인한다.
const baseline = readFileSync(contractSchemaUrl, 'utf8');

test('existing v0.4 database migrates to v0.7 in place and keeps its rows', () => {
  const { folder, cleanup } = tempFolder('migrate-');
  const path = join(folder, 'app.sqlite');
  try {
    let db = openDatabase(path, baseline, []);
    assert.equal(describeDatabase(db).domain_tables, 17);
    db.prepare("INSERT INTO workspaces (id, session_token_hash, csrf_token_hash, created_at_ms, expires_at_ms, updated_at_ms) VALUES ('legacy', ?, ?, 1, 2, 1)").run('a'.repeat(64), 'b'.repeat(64));
    db.close();

    db = openDatabase(path);
    const described = describeDatabase(db);
    assert.equal(described.contract_version, 'v0.7.9');
    assert.deepEqual(described.applied_versions, ['v0.4', 'v0.7', 'v0.7.1', 'v0.7.2', 'v0.7.3', 'v0.7.4', 'v0.7.5', 'v0.7.6', 'v0.7.9']);
    assert.equal(described.domain_tables, 55);
    assert.equal(db.prepare("SELECT id FROM workspaces WHERE id='legacy'").get().id, 'legacy');
    db.close();

    db = openDatabase(path);
    assert.deepEqual(describeDatabase(db), described, 'reopen is a no-op');
    db.close();
  } finally { cleanup(); }
});

test('an existing v0.7 database gains the v0.7.1 browser-apply tables in place and keeps its rows', () => {
  const { folder, cleanup } = tempFolder('migrate-071-');
  const path = join(folder, 'app.sqlite');
  try {
    let db = openDatabase(path, baseline, defaultMigrations().slice(0, 1));
    assert.deepEqual(describeDatabase(db).applied_versions.slice(0, 2), ['v0.4', 'v0.7']);
    assert.equal(describeDatabase(db).domain_tables, 46);
    db.prepare("INSERT INTO ce7_principals (id, auth_subject, mode, created_at_ms) VALUES ('p1', 'subject-1', 'authenticated', 1)").run();
    db.close();
    db = openDatabase(path);
    const described = describeDatabase(db);
    assert.deepEqual(described.applied_versions, ['v0.4', 'v0.7', 'v0.7.1', 'v0.7.2', 'v0.7.3', 'v0.7.4', 'v0.7.5', 'v0.7.6', 'v0.7.9']);
    assert.equal(described.domain_tables, 55);
    assert.equal(db.prepare("SELECT id FROM ce7_principals WHERE id='p1'").get().id, 'p1');
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='demo_site_submissions'").get());
    db.close();
  } finally { cleanup(); }
});

test('v0.7.2 rebuilds ce7_documents for DOCX in place: linked extraction/fact rows, triggers and checks survive', () => {
  const { folder, cleanup } = tempFolder('migrate-072-');
  const path = join(folder, 'app.sqlite');
  const H = 'a'.repeat(64);
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  try {
    let db = openDatabase(path, baseline, defaultMigrations().slice(0, 2));
    const insert = (table, values) => db.prepare(`INSERT INTO ${table} (${Object.keys(values)}) VALUES (${Object.keys(values).map(() => '?')})`).run(...Object.values(values));
    db.exec('BEGIN');
    insert('workspaces', { id: 'w1', session_token_hash: 'b'.repeat(64), csrf_token_hash: H, revision: 0, created_at_ms: 0, expires_at_ms: 9, updated_at_ms: 0 });
    insert('ce7_principals', { id: 'p1', auth_subject: 'test:w1', mode: 'synthetic_local', created_at_ms: 0 });
    insert('ce7_workspace_owners', { workspace_id: 'w1', principal_id: 'p1', created_at_ms: 0 });
    insert('ce7_documents', { id: 'd1', workspace_id: 'w1', input_kind: 'text_pdf', filename: 's.pdf', mime_type: 'application/pdf', byte_size: 1, sha256: H, object_key: 'o1', data_origin: 'synthetic', extraction_status: 'extracted', created_at_ms: 0 });
    insert('ce7_extractions', { id: 'e1', workspace_id: 'w1', document_id: 'd1', source_sha256: H, state: 'review_required', facts_json: '[]', warnings_json: '[]', created_at_ms: 1 });
    insert('ce7_fact_revisions', { id: 'f1', workspace_id: 'w1', document_id: 'd1', revision: 1, facts_json: '[]', content_hash: H, confirmed_at_ms: 1, created_at_ms: 1 });
    db.exec("UPDATE ce7_documents SET current_fact_revision_id = 'f1' WHERE id = 'd1'");
    db.exec('COMMIT');
    assert.throws(() => insert('ce7_documents', { id: 'early', workspace_id: 'w1', input_kind: 'docx', filename: 's.docx', mime_type: DOCX, byte_size: 1, sha256: H, object_key: 'early', data_origin: 'synthetic', extraction_status: 'uploaded', created_at_ms: 0 }), /CHECK constraint failed/);
    db.close();

    db = openDatabase(path);
    assert.deepEqual(describeDatabase(db).applied_versions, ['v0.4', 'v0.7', 'v0.7.1', 'v0.7.2', 'v0.7.3', 'v0.7.4', 'v0.7.5', 'v0.7.6', 'v0.7.9']);
    assert.equal(describeDatabase(db).domain_tables, 55);
    assert.equal(db.prepare("SELECT current_fact_revision_id AS f FROM ce7_documents WHERE id = 'd1'").get().f, 'f1');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA defer_foreign_keys').get().defer_foreign_keys, 0, 'defer flag does not leak past the migration');
    assert.equal(db.prepare("SELECT count(*) AS n FROM temp.sqlite_master").get().n, 0, 'no copy table left behind');
    assert.throws(() => db.exec(`UPDATE ce7_documents SET sha256 = '${'c'.repeat(64)}' WHERE id = 'd1'`), /IMMUTABLE_PAYLOAD/);
    assert.throws(() => db.exec("DELETE FROM ce7_documents WHERE id = 'd1'"), /FOREIGN KEY/);
    const insert2 = (values) => db.prepare(`INSERT INTO ce7_documents (${Object.keys(values)}) VALUES (${Object.keys(values).map(() => '?')})`).run(...Object.values(values));
    const docx = { workspace_id: 'w1', input_kind: 'docx', filename: 's.docx', byte_size: 1, sha256: H, data_origin: 'synthetic', extraction_status: 'uploaded', created_at_ms: 0 };
    insert2({ ...docx, id: 'd2', object_key: 'o2', mime_type: DOCX });
    assert.throws(() => insert2({ ...docx, id: 'd3', object_key: 'o3', mime_type: 'application/pdf' }), /CHECK constraint failed/);
    assert.throws(() => insert2({ ...docx, id: 'd4', object_key: 'o4', mime_type: DOCX, data_origin: 'user' }), /AUTHENTICATED_OWNER_REQUIRED/);
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare("SELECT count(*) AS n FROM ce7_documents").get().n, 2, 'reopen is a no-op');
    db.close();
  } finally { cleanup(); }
});

test('v0.7.3 rebuilds ce7_tasks for review_resume in place: tasks, provider-call children and index survive; review rows are fixed once done', () => {
  const { folder, cleanup } = tempFolder('migrate-073-');
  const path = join(folder, 'app.sqlite');
  const H = 'a'.repeat(64);
  try {
    let db = openDatabase(path, baseline, defaultMigrations().slice(0, 3));
    const insert = (table, values) => db.prepare(`INSERT INTO ${table} (${Object.keys(values)}) VALUES (${Object.keys(values).map(() => '?')})`).run(...Object.values(values));
    db.exec('BEGIN');
    insert('workspaces', { id: 'w1', session_token_hash: 'b'.repeat(64), csrf_token_hash: H, revision: 0, created_at_ms: 0, expires_at_ms: 9, updated_at_ms: 0 });
    insert('ce7_principals', { id: 'p1', auth_subject: 'test:w1', mode: 'synthetic_local', created_at_ms: 0 });
    insert('ce7_workspace_owners', { workspace_id: 'w1', principal_id: 'p1', created_at_ms: 0 });
    insert('ce7_tasks', { id: 't1', workspace_id: 'w1', kind: 'search_jobs', state: 'succeeded', input_json: '{}', input_hash: H, available_at_ms: 0, created_at_ms: 0, updated_at_ms: 0 });
    insert('ce7_provider_calls', { id: 'c1', workspace_id: 'w1', task_id: 't1', provider: 'liner', purpose: 'search', request_hash: H, status: 'succeeded', reserved_micro_usd: 2000, verified_micro_usd: 1000, lease_generation: 1, created_at_ms: 0, updated_at_ms: 0 });
    db.exec('COMMIT');
    assert.throws(() => insert('ce7_tasks', { id: 'early', workspace_id: 'w1', kind: 'review_resume', state: 'queued', input_json: '{}', input_hash: H, available_at_ms: 0, created_at_ms: 0, updated_at_ms: 0 }), /CHECK constraint failed/);
    db.close();

    db = openDatabase(path);
    assert.deepEqual(describeDatabase(db).applied_versions, ['v0.4', 'v0.7', 'v0.7.1', 'v0.7.2', 'v0.7.3', 'v0.7.4', 'v0.7.5', 'v0.7.6', 'v0.7.9']);
    assert.equal(describeDatabase(db).domain_tables, 55);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare("SELECT kind FROM ce7_tasks WHERE id = 't1'").get().kind, 'search_jobs');
    assert.equal(db.prepare("SELECT task_id FROM ce7_provider_calls WHERE id = 'c1'").get().task_id, 't1');
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'ce7_tasks_ready'").get(), 'ready index recreated');
    assert.equal(db.prepare('SELECT count(*) AS n FROM temp.sqlite_master').get().n, 0);
    assert.throws(() => db.exec("DELETE FROM ce7_tasks WHERE id = 't1'"), /FOREIGN KEY/);
    db.prepare("INSERT INTO ce7_tasks (id, workspace_id, kind, state, input_json, input_hash, available_at_ms, created_at_ms, updated_at_ms) VALUES ('t2', 'w1', 'review_resume', 'queued', '{}', ?, 0, 0, 0)").run(H);
    db.exec('BEGIN');
    db.prepare("INSERT INTO ce7_documents (id, workspace_id, input_kind, filename, mime_type, byte_size, sha256, object_key, data_origin, extraction_status, created_at_ms) VALUES ('d1', 'w1', 'pasted_text', 'a.txt', 'text/plain', 1, ?, 'o1', 'synthetic', 'extracted', 0)").run(H);
    db.prepare("INSERT INTO ce7_fact_revisions (id, workspace_id, document_id, revision, facts_json, content_hash, confirmed_at_ms, created_at_ms) VALUES ('f1', 'w1', 'd1', 1, '[]', ?, 1, 1)").run(H);
    db.exec("UPDATE ce7_documents SET current_fact_revision_id = 'f1' WHERE id = 'd1'");
    db.exec('COMMIT');
    db.exec("INSERT INTO ce8_resume_reviews (id, workspace_id, fact_revision_id, task_id, provider_mode, state, result_json, error_code, created_at_ms, updated_at_ms) VALUES ('rv1', 'w1', 'f1', 't2', 'mock', 'queued', NULL, NULL, 0, 0)");
    assert.throws(() => db.exec("UPDATE ce8_resume_reviews SET state = 'succeeded' WHERE id = 'rv1'"), /CHECK constraint failed/, 'success needs a result');
    db.exec(`UPDATE ce8_resume_reviews SET state = 'succeeded', result_json = '{"items":[]}' WHERE id = 'rv1'`);
    assert.throws(() => db.exec("UPDATE ce8_resume_reviews SET result_json = '{}' WHERE id = 'rv1'"), /REVIEW_IMMUTABLE/);
    db.close();
  } finally { cleanup(); }
});

test('a failing migration rolls back completely and leaves v0.4 usable', () => {
  const { folder, cleanup } = tempFolder('migrate-fail-');
  const path = join(folder, 'app.sqlite');
  try {
    openDatabase(path, baseline, []).close();
    const broken = [{ version: 'v0.7', sql: 'CREATE TABLE ce7_partial (id TEXT); INVALID SQL;', tablesAfter: 46 }];
    assert.throws(() => openDatabase(path, baseline, broken), /MIGRATION_FAILED/);
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='ce7_partial'").get(), undefined);
    assert.deepEqual(raw.prepare('SELECT version FROM _starter_schema').all().map(row => row.version), ['v0.4']);
    raw.close();
    const db = openDatabase(path, baseline, []);
    assert.equal(describeDatabase(db).domain_tables, 17);
    db.close();
  } finally { cleanup(); }
});

test('older runtime, edited migration SQL and object drift are refused without reset', () => {
  const { folder, cleanup } = tempFolder('migrate-drift-');
  const path = join(folder, 'app.sqlite');
  try {
    openDatabase(path).close();
    assert.throws(() => openDatabase(path, baseline, []), /UNKNOWN_SCHEMA_VERSION/);
    const edited = defaultMigrations().map(item => ({ ...item, sql: item.sql + '\n-- edited' }));
    assert.throws(() => openDatabase(path, baseline, edited), /MIGRATION_DRIFT/);
    const raw = new DatabaseSync(path); raw.exec('DROP TRIGGER ce7_fact_revisions_immutable'); raw.close();
    assert.throws(() => openDatabase(path), /DATABASE_OBJECT_DRIFT/);
    const after = new DatabaseSync(path);
    assert.equal(after.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'ce7_%'").get().n, 29);
    after.close();
  } finally { cleanup(); }
});
