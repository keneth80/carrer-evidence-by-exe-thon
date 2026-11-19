import { openDatabase, describeDatabase } from '../packages/db/src/index.ts';
const db = openDatabase(':memory:');
try {
  const result = describeDatabase(db);
  if (result.domain_tables !== 55 || result.contract_version !== 'v0.7.6' || !result.foreign_keys) throw new Error('DATABASE_CHECK_FAILED');
  console.log(JSON.stringify({ status: 'PASS', ...result, metadata_tables: 1, persistent_db_modified: false }, null, 2));
} finally { db.close(); }

