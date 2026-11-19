import type { DatabaseSync } from 'node:sqlite';
import { iso } from '../http.ts';
import type { ProposedChange, ResumeBlock } from '../../../../packages/tailor/src/types.ts';

// 편집 세션·메시지·제안·공고별 이력서 revision·렌더 파일 조회. 모든 조회는 인증된 workspace_id로 제한한다.

export type SessionRow = { id: string; workspace_id: string; job_snapshot_id: string; fact_revision_id: string; current_resume_revision_id: string | null; revision: number; state: string; created_at_ms: number; progress_json?: string | null };
export type MessageRow = { id: string; workspace_id: string; session_id: string; role: 'user' | 'assistant'; content: string; base_resume_revision_id: string | null; created_at_ms: number; result_json?: string | null };
export type RevisionRow = {
  id: string; workspace_id: string; session_id: string; job_snapshot_id: string; fact_revision_id: string; revision: number; parent_revision_id: string | null;
  blocks_json: string; content_hash: string; state: 'draft' | 'final'; finalized_at_ms: number | null; finalization_source: string | null; created_at_ms: number;
};
export type ProposalRow = { id: string; workspace_id: string; session_id: string; base_resume_revision_id: string; base_content_hash: string; changes_json: string; questions_json: string; state: string; created_at_ms: number };
export type ArtifactRow = { id: string; workspace_id: string; resume_revision_id: string; filename: string; mime_type: string; byte_size: number; sha256: string; object_key: string; created_at_ms: number };

export const getSession = (db: DatabaseSync, workspaceId: string, id: string) =>
  db.prepare('SELECT * FROM ce7_tailoring_sessions WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as SessionRow | undefined;
export const getRevision = (db: DatabaseSync, workspaceId: string, id: string) =>
  db.prepare('SELECT * FROM ce7_resume_revisions WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as RevisionRow | undefined;
export const getProposal = (db: DatabaseSync, workspaceId: string, id: string) =>
  db.prepare('SELECT * FROM ce7_edit_proposals WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as ProposalRow | undefined;
export const getArtifact = (db: DatabaseSync, workspaceId: string, id: string) =>
  db.prepare('SELECT * FROM ce7_artifacts WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as ArtifactRow | undefined;
export const getMessage = (db: DatabaseSync, workspaceId: string, id: string) =>
  db.prepare('SELECT * FROM ce7_messages WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as MessageRow | undefined;

export function listMessages(db: DatabaseSync, workspaceId: string, sessionId: string): MessageRow[] {
  return db.prepare('SELECT * FROM ce7_messages WHERE workspace_id = ? AND session_id = ? ORDER BY created_at_ms, rowid LIMIT 500').all(workspaceId, sessionId) as MessageRow[];
}

export function listProposals(db: DatabaseSync, workspaceId: string, sessionId: string): ProposalRow[] {
  return db.prepare('SELECT * FROM ce7_edit_proposals WHERE workspace_id = ? AND session_id = ? ORDER BY created_at_ms, rowid LIMIT 500').all(workspaceId, sessionId) as ProposalRow[];
}

export function sessionBody(row: SessionRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, job_snapshot_id: row.job_snapshot_id, fact_revision_id: row.fact_revision_id,
    current_resume_revision_id: row.current_resume_revision_id, revision: row.revision, state: row.state, created_at: iso(row.created_at_ms),
    // 최근 턴의 단계별 진행 기록(v0.7.6, S1-18). progress.task_id가 진행 중 작업과 같을 때만 그 턴의 진행이다.
    progress: row.progress_json ? JSON.parse(row.progress_json) as unknown : null,
  };
}

// turn: assistant 메시지의 턴 결과(v0.7.6, S1-18 — 요구사항 점검표·질문·단계 요약·뺀 수정안). 사용자 메시지와 이전 답변은 null.
export function messageBody(row: MessageRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, session_id: row.session_id, role: row.role, content: row.content, base_resume_revision_id: row.base_resume_revision_id,
    turn: row.result_json ? JSON.parse(row.result_json) as unknown : null, created_at: iso(row.created_at_ms),
  };
}

export const revisionBlocks = (row: RevisionRow) => JSON.parse(row.blocks_json) as ResumeBlock[];

export function revisionBody(row: RevisionRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, session_id: row.session_id, job_snapshot_id: row.job_snapshot_id, fact_revision_id: row.fact_revision_id,
    revision: row.revision, parent_revision_id: row.parent_revision_id, blocks: revisionBlocks(row), content_hash: row.content_hash, state: row.state,
    finalized_at: row.finalized_at_ms === null ? null : iso(row.finalized_at_ms), finalization_source: row.finalization_source, created_at: iso(row.created_at_ms),
  };
}

export function proposalBody(row: ProposalRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, session_id: row.session_id, base_resume_revision_id: row.base_resume_revision_id, base_content_hash: row.base_content_hash,
    changes: JSON.parse(row.changes_json) as ProposedChange[], state: row.state, unresolved_questions: JSON.parse(row.questions_json) as string[], created_at: iso(row.created_at_ms),
  };
}

export function artifactBody(row: ArtifactRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, resume_revision_id: row.resume_revision_id, mime_type: 'application/pdf', filename: row.filename,
    byte_size: row.byte_size, sha256: row.sha256, download_path: `/api/v1/artifacts/${row.id}/content`, created_at: iso(row.created_at_ms),
  };
}

// 새 revision 저장. 세션의 현재 revision과 세션 revision 번호를 함께 올린다(호출자가 transaction을 연다).
export function insertRevision(db: DatabaseSync, row: Omit<RevisionRow, 'state' | 'finalized_at_ms' | 'finalization_source'>) {
  db.prepare(`INSERT INTO ce7_resume_revisions (id, workspace_id, session_id, job_snapshot_id, fact_revision_id, revision, parent_revision_id, blocks_json, content_hash, state, finalized_at_ms, finalization_source, created_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, NULL, ?)`)
    .run(row.id, row.workspace_id, row.session_id, row.job_snapshot_id, row.fact_revision_id, row.revision, row.parent_revision_id, row.blocks_json, row.content_hash, row.created_at_ms);
  db.prepare("UPDATE ce7_tailoring_sessions SET current_resume_revision_id = ?, revision = revision + 1, state = 'editing' WHERE workspace_id = ? AND id = ?").run(row.id, row.workspace_id, row.session_id);
}

export function nextRevisionNumber(db: DatabaseSync, workspaceId: string, sessionId: string): number {
  return Number(db.prepare('SELECT coalesce(max(revision), 0) AS n FROM ce7_resume_revisions WHERE workspace_id = ? AND session_id = ?').get(workspaceId, sessionId)?.n ?? 0) + 1;
}
