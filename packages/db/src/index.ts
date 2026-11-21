import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

export const contractSchemaUrl = new URL('../../../contracts/v0.4/schema.sql', import.meta.url);
export const resumeWorkflowMigrationUrl = new URL('../../../contracts/v0.7/migrations/007_resume_workflow.sql', import.meta.url);
export const browserApplyMigrationUrl = new URL('../../../contracts/v0.7/migrations/008_browser_apply.sql', import.meta.url);
export const docxIntakeMigrationUrl = new URL('../../../contracts/v0.7/migrations/009_docx_intake.sql', import.meta.url);
export const resumeReviewMigrationUrl = new URL('../../../contracts/v0.7/migrations/010_resume_review.sql', import.meta.url);
export const resumeSupplementMigrationUrl = new URL('../../../contracts/v0.7/migrations/011_resume_supplement.sql', import.meta.url);
export const supplementProgressMigrationUrl = new URL('../../../contracts/v0.7/migrations/012_supplement_progress.sql', import.meta.url);
export const tailoringProgressMigrationUrl = new URL('../../../contracts/v0.7/migrations/013_tailoring_progress.sql', import.meta.url);
export const tailoringJobTextMigrationUrl = new URL('../../../contracts/v0.7/migrations/014_tailoring_job_text.sql', import.meta.url);
const metaTable = '_starter_schema';
const BASELINE_VERSION = 'v0.4';
const BASELINE_TABLES = 17;

export type Migration = { version: string; sql: string; tablesAfter: number };

// 알려진 버전 순서. 새 migration은 이 목록 끝에 추가하고, 이미 적용한 SQL bytes는 바꾸지 않는다.
let cachedMigrations: Migration[] | null = null;
export function defaultMigrations(): Migration[] {
  cachedMigrations ??= [
    { version: 'v0.7', sql: readFileSync(resumeWorkflowMigrationUrl, 'utf8'), tablesAfter: 46 },
    // S05 브라우저 지원: 실행기 연결·폼 관측·시도 실행 토큰·외부 지원 기록·자체 폼 사이트 접수 저장소(DECISIONS S5-01).
    { version: 'v0.7.1', sql: readFileSync(browserApplyMigrationUrl, 'utf8'), tablesAfter: 52 },
    // Word(.docx) 이력서 원본: ce7_documents의 형식 CHECK만 넓힌다(DECISIONS S1-12). 표 수는 그대로다.
    { version: 'v0.7.2', sql: readFileSync(docxIntakeMigrationUrl, 'utf8'), tablesAfter: 52 },
    // AI 1차 점검: ce7_tasks kind에 review_resume 추가(표 재생성) + 결과 표 ce8_resume_reviews(DECISIONS S1-14).
    { version: 'v0.7.3', sql: readFileSync(resumeReviewMigrationUrl, 'utf8'), tablesAfter: 53 },
    // 기본 이력서 보완 대화: ce7_tasks kind에 supplement_resume 추가(표 재생성) + 세션·메시지 표(DECISIONS S1-16).
    { version: 'v0.7.4', sql: readFileSync(resumeSupplementMigrationUrl, 'utf8'), tablesAfter: 55 },
    // 보완 대화 단계별 진행 기록: ce8_supplement_sessions에 progress_json 열 추가(표 재생성 없음, DECISIONS S1-17).
    { version: 'v0.7.5', sql: readFileSync(supplementProgressMigrationUrl, 'utf8'), tablesAfter: 55 },
    // 공고 맞춤 대화 단계별 진행·턴 결과: ce7_tailoring_sessions.progress_json, ce7_messages.result_json 열 추가(표 재생성 없음, DECISIONS S1-18).
    { version: 'v0.7.6', sql: readFileSync(tailoringProgressMigrationUrl, 'utf8'), tablesAfter: 55 },
    // 붙여넣은 공고 본문: ce7_tailoring_sessions.job_text 열 추가(표 재생성 없음, DECISIONS S1-28). 계약 v0.7.7·v0.7.8은 migration이 없었다.
    { version: 'v0.7.9', sql: readFileSync(tailoringJobTextMigrationUrl, 'utf8'), tablesAfter: 55 },
  ];
  return cachedMigrations.map(migration => ({ ...migration }));
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function databaseObjectsDigest(db: DatabaseSync): string {
  const objects = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND tbl_name <> ? AND name <> ? ORDER BY type,name").all(metaTable, metaTable);
  return sha256(JSON.stringify(objects));
}

function domainTableCount(db: DatabaseSync): number {
  const row = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> ?").get(metaTable);
  return Number(row?.count ?? 0);
}

function applyMigration(db: DatabaseSync, migration: Migration) {
  // trigger 본문의 BEGIN ... END는 허용하고, transaction 제어문만 거절한다.
  if (/^\s*(BEGIN(\s+(DEFERRED|IMMEDIATE|EXCLUSIVE|TRANSACTION))?\s*;|COMMIT\b|END\s+TRANSACTION\b|ROLLBACK\b|SAVEPOINT\b|RELEASE\b|VACUUM\b)/im.test(migration.sql)) throw new Error(`MIGRATION_OWNS_TRANSACTION: ${migration.version}`);
  db.exec(migration.sql);
  db.prepare(`INSERT INTO ${metaTable} VALUES (?, ?, ?)`).run(migration.version, sha256(migration.sql), databaseObjectsDigest(db));
}

function initializeEmpty(db: DatabaseSync, schema: string, migrations: Migration[]) {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  // v0.4 SQL begins its transaction. Baseline, migrations and metadata commit together.
  if (!/COMMIT;\s*$/.test(schema)) throw new Error('UNSUPPORTED_BASELINE_SQL');
  db.exec(schema.replace(/COMMIT;\s*$/, ''));
  db.exec(`CREATE TABLE ${metaTable} (version TEXT PRIMARY KEY, sha256 TEXT NOT NULL, objects_sha256 TEXT NOT NULL)`);
  db.prepare(`INSERT INTO ${metaTable} VALUES (?, ?, ?)`).run(BASELINE_VERSION, sha256(schema), databaseObjectsDigest(db));
  for (const migration of migrations) applyMigration(db, migration);
  db.exec('COMMIT');
}

type MetaRow = { version: string; sha256: string; objects_sha256: string };

function verifyApplied(db: DatabaseSync, schema: string, migrations: Migration[]): MetaRow[] {
  const rows = db.prepare(`SELECT version,sha256,objects_sha256 FROM ${metaTable}`).all() as MetaRow[];
  const baseline = rows.find(row => row.version === BASELINE_VERSION);
  if (baseline?.sha256 !== sha256(schema)) throw new Error('SCHEMA_DRIFT: write an explicit migration; no reset was performed');
  const known = new Map(migrations.map(migration => [migration.version, migration]));
  for (const row of rows) {
    if (row.version === BASELINE_VERSION) continue;
    const migration = known.get(row.version);
    if (!migration) throw new Error(`UNKNOWN_SCHEMA_VERSION: ${row.version}; this runtime is older than the database; no reset was performed`);
    if (row.sha256 !== sha256(migration.sql)) throw new Error(`MIGRATION_DRIFT: ${row.version} SQL changed after it was applied; no reset was performed`);
  }
  const applied = migrations.filter(migration => rows.some(row => row.version === migration.version));
  const expectedPrefix = migrations.slice(0, applied.length).map(migration => migration.version);
  if (applied.map(migration => migration.version).join() !== expectedPrefix.join()) throw new Error('MIGRATION_ORDER_INVALID: no reset was performed');
  const head = applied.length ? rows.find(row => row.version === applied[applied.length - 1].version) : baseline;
  if (head?.objects_sha256 !== databaseObjectsDigest(db)) throw new Error('DATABASE_OBJECT_DRIFT: table/index/trigger/view definitions changed; no reset was performed');
  return rows;
}

function migratePending(db: DatabaseSync, schema: string, migrations: Migration[]) {
  db.exec('BEGIN IMMEDIATE');
  try {
    // 다른 프로세스가 먼저 적용했을 수 있으므로 쓰기 잠금 안에서 다시 확인한다.
    const rows = verifyApplied(db, schema, migrations);
    for (const migration of migrations) {
      if (!rows.some(row => row.version === migration.version)) applyMigration(db, migration);
    }
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('FOREIGN_KEY_CHECK_FAILED');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`MIGRATION_FAILED: rolled back, database left at previous version; ${message}`);
  }
}

export function openDatabase(path: string, schema = readFileSync(contractSchemaUrl, 'utf8'), migrations: Migration[] = defaultMigrations()): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: 5000 });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const foreignKeys = db.prepare('PRAGMA foreign_keys').get();
    if (foreignKeys?.foreign_keys !== 1) throw new Error('FOREIGN_KEYS_UNAVAILABLE');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if (tables.length === 0) {
      initializeEmpty(db, schema, migrations);
    } else {
      if (!tables.some(row => row.name === metaTable)) throw new Error('UNMANAGED_DATABASE: use a new path or write an explicit migration; no reset was performed');
      const rows = verifyApplied(db, schema, migrations);
      if (migrations.some(migration => !rows.some(row => row.version === migration.version))) migratePending(db, schema, migrations);
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    }
    const expectedTables = migrations.length ? migrations[migrations.length - 1].tablesAfter : BASELINE_TABLES;
    if (domainTableCount(db) !== expectedTables) throw new Error('SCHEMA_TABLE_COUNT_MISMATCH');
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('FOREIGN_KEY_CHECK_FAILED');
    return db;
  } catch (error) {
    try { if (db.isTransaction) db.exec('ROLLBACK'); } catch { /* Preserve the first failure. */ }
    db.close();
    throw error;
  }
}

export function describeDatabase(db: DatabaseSync) {
  const rows = db.prepare(`SELECT version,sha256,objects_sha256 FROM ${metaTable}`).all() as MetaRow[];
  const order = [BASELINE_VERSION, ...defaultMigrations().map(migration => migration.version)];
  const applied = order.filter(version => rows.some(row => row.version === version));
  const head = rows.find(row => row.version === applied[applied.length - 1]);
  return {
    contract_version: applied[applied.length - 1],
    applied_versions: applied,
    domain_tables: domainTableCount(db),
    foreign_keys: db.prepare('PRAGMA foreign_keys').get()?.foreign_keys === 1,
    schema_sha256: rows.find(row => row.version === BASELINE_VERSION)?.sha256,
    database_object_sha256: head?.objects_sha256,
  };
}
