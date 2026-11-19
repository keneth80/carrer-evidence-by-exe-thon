import type { DatabaseSync } from 'node:sqlite';
import { iso } from '../http.ts';

// 모든 조회는 서버가 인증한 workspace_id를 조건에 포함한다. 다른 workspace 자료는 없는 것으로 보인다.

export type DocumentRow = {
  id: string; workspace_id: string; input_kind: 'text_pdf' | 'pasted_text' | 'docx'; filename: string; mime_type: string;
  byte_size: number; sha256: string; object_key: string; data_origin: 'user' | 'synthetic';
  extraction_status: string; error_code: string | null; current_fact_revision_id: string | null; created_at_ms: number;
};

export function getDocument(db: DatabaseSync, workspaceId: string, documentId: string): DocumentRow | undefined {
  return db.prepare('SELECT * FROM ce7_documents WHERE workspace_id = ? AND id = ?').get(workspaceId, documentId) as DocumentRow | undefined;
}

export function listDocuments(db: DatabaseSync, workspaceId: string): DocumentRow[] {
  return db.prepare('SELECT * FROM ce7_documents WHERE workspace_id = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 100').all(workspaceId) as DocumentRow[];
}

export function documentBody(row: DocumentRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, input_kind: row.input_kind, filename: row.filename, mime_type: row.mime_type,
    byte_size: row.byte_size, sha256: row.sha256, data_origin: row.data_origin, extraction_status: row.extraction_status,
    error_code: row.error_code, created_at: iso(row.created_at_ms),
  };
}

export type TaskRow = {
  id: string; workspace_id: string; kind: string; state: string; input_json: string; result_json: string | null;
  error_code: string | null; cancel_requested: number; provider_transmission: string; lease_owner: string | null;
  lease_generation: number; lease_until_ms: number | null; created_at_ms: number; updated_at_ms: number;
};

export function getTask(db: DatabaseSync, workspaceId: string, taskId: string): TaskRow | undefined {
  return db.prepare('SELECT * FROM ce7_tasks WHERE workspace_id = ? AND id = ?').get(workspaceId, taskId) as TaskRow | undefined;
}

export function latestTaskForDocument(db: DatabaseSync, workspaceId: string, documentId: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM ce7_tasks WHERE workspace_id = ? AND kind = 'extract_resume' AND json_extract(input_json, '$.document_id') = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 1")
    .get(workspaceId, documentId) as TaskRow | undefined;
}

// 작업 종류별 입력·결과 ID. 추출은 문서·추출 초안, 검색은 확정 경력·검색 계획과 검색 결과,
// 대화는 기준 revision·사용자 메시지와 답변·제안, 렌더는 확정 revision과 PDF artifact다.
export function taskBody(row: TaskRow) {
  const input = JSON.parse(row.input_json) as Record<string, unknown>;
  const result = row.result_json ? JSON.parse(row.result_json) as Record<string, unknown> : {};
  const inputIds = [input.document_id, input.fact_revision_id, input.intent_id, input.base_resume_revision_id, input.message_id, input.resume_revision_id, input.attempt_id, input.campaign_id].filter((id): id is string => typeof id === 'string');
  const resultIds = [result.extraction_id, result.search_run_id, result.assistant_message_id, result.proposal_id, result.artifact_id, result.evidence_id, result.review_id].filter((id): id is string => typeof id === 'string');
  return {
    id: row.id, workspace_id: row.workspace_id, kind: row.kind, state: row.state,
    input_revision_ids: inputIds,
    result_ids: resultIds,
    cancel_requested: row.cancel_requested === 1, error_code: row.error_code,
    provider_transmission: row.provider_transmission, created_at: iso(row.created_at_ms), updated_at: iso(row.updated_at_ms),
  };
}

export type ExtractionRow = { id: string; workspace_id: string; document_id: string; source_sha256: string; state: string; facts_json: string; warnings_json: string; created_at_ms: number };

export function latestExtraction(db: DatabaseSync, workspaceId: string, documentId: string): ExtractionRow | undefined {
  return db.prepare('SELECT * FROM ce7_extractions WHERE workspace_id = ? AND document_id = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 1')
    .get(workspaceId, documentId) as ExtractionRow | undefined;
}

export function getExtraction(db: DatabaseSync, workspaceId: string, extractionId: string): ExtractionRow | undefined {
  return db.prepare('SELECT * FROM ce7_extractions WHERE workspace_id = ? AND id = ?').get(workspaceId, extractionId) as ExtractionRow | undefined;
}

export function extractionBody(row: ExtractionRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, document_id: row.document_id, source_sha256: row.source_sha256,
    status: row.state, facts: JSON.parse(row.facts_json), warnings: JSON.parse(row.warnings_json), created_at: iso(row.created_at_ms),
  };
}

export type FactRevisionRow = { id: string; workspace_id: string; document_id: string; revision: number; parent_revision_id: string | null; facts_json: string; content_hash: string; confirmed_at_ms: number; created_at_ms: number };

export function getFactRevision(db: DatabaseSync, workspaceId: string, revisionId: string): FactRevisionRow | undefined {
  return db.prepare('SELECT * FROM ce7_fact_revisions WHERE workspace_id = ? AND id = ?').get(workspaceId, revisionId) as FactRevisionRow | undefined;
}

export function factRevisionBody(row: FactRevisionRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, document_id: row.document_id, revision: row.revision,
    parent_revision_id: row.parent_revision_id, facts: JSON.parse(row.facts_json), content_hash: row.content_hash,
    confirmed_at: iso(row.confirmed_at_ms), created_at: iso(row.created_at_ms),
  };
}

export const extractionSourceKey = (documentId: string, extractionId: string) => `documents/${documentId}/extractions/${extractionId}.source.json`;
