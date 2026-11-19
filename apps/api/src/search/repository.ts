import type { DatabaseSync } from 'node:sqlite';
import { iso } from '../http.ts';

// 검색 계획·검색 실행·공고 스냅샷 조회. 모든 조회는 서버가 인증한 workspace_id를 조건에 포함한다.

export type IntentRow = { id: string; workspace_id: string; fact_revision_id: string; conditions_json: string; queries_json: string; content_hash: string; created_at_ms: number };
export type SearchRunRow = { id: string; workspace_id: string; intent_id: string; task_id: string; provider_mode: 'mock' | 'live'; state: string; outcome: string | null; created_at_ms: number };
export type JobSnapshotRow = {
  id: string; workspace_id: string; job_key: string; company_name: string; title: string; canonical_url: string; site_id: string;
  content_text: string; requirements_json: string; content_hash: string; open_status: string; data_origin: string; observed_at_ms: number;
};

export function getIntent(db: DatabaseSync, workspaceId: string, intentId: string): IntentRow | undefined {
  return db.prepare('SELECT * FROM ce7_search_intents WHERE workspace_id = ? AND id = ?').get(workspaceId, intentId) as IntentRow | undefined;
}

export function intentBody(row: IntentRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, fact_revision_id: row.fact_revision_id,
    conditions: JSON.parse(row.conditions_json), queries: JSON.parse(row.queries_json),
    content_hash: row.content_hash, created_at: iso(row.created_at_ms),
  };
}

export function getSearchRun(db: DatabaseSync, workspaceId: string, searchId: string): SearchRunRow | undefined {
  return db.prepare('SELECT * FROM ce7_search_runs WHERE workspace_id = ? AND id = ?').get(workspaceId, searchId) as SearchRunRow | undefined;
}

export function searchRunBody(db: DatabaseSync, row: SearchRunRow) {
  const ids = db.prepare('SELECT job_snapshot_id FROM ce7_search_results WHERE workspace_id = ? AND search_run_id = ? ORDER BY slot').all(row.workspace_id, row.id).map(item => String(item.job_snapshot_id));
  return {
    id: row.id, workspace_id: row.workspace_id, intent_id: row.intent_id, task_id: row.task_id, provider_mode: row.provider_mode,
    state: row.state, job_snapshot_ids: ids, outcome: row.outcome, created_at: iso(row.created_at_ms),
  };
}

export function getJobSnapshot(db: DatabaseSync, workspaceId: string, jobId: string): JobSnapshotRow | undefined {
  return db.prepare('SELECT * FROM ce7_job_snapshots WHERE workspace_id = ? AND id = ?').get(workspaceId, jobId) as JobSnapshotRow | undefined;
}

export function jobSnapshotBody(row: JobSnapshotRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, job_key: row.job_key, company_name: row.company_name, title: row.title,
    canonical_url: row.canonical_url, site_id: row.site_id, content_text: row.content_text, content_hash: row.content_hash,
    open_status: row.open_status, requirements: JSON.parse(row.requirements_json), data_origin: row.data_origin, observed_at: iso(row.observed_at_ms),
  };
}
