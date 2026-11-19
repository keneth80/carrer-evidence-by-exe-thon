import type { DatabaseSync } from 'node:sqlite';
import { validateConfirmedFacts, factsContentHash } from '../../../../packages/resume/src/confirm.ts';
import type { StatementLookup } from '../../../../packages/resume/src/confirm.ts';
import type { ResumeFact } from '../../../../packages/resume/src/types.ts';
import type { SourceText } from '../../../../packages/resume/src/source.ts';
import { iso, isPlainObject, newId, problem, readJson, sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import type { Config } from '../config.ts';
import { readIdempotencyKey, replayIfStored, storeResponse } from '../idempotency.ts';
import {
  documentBody, extractionBody, extractionSourceKey, factRevisionBody, getDocument, getExtraction, getFactRevision,
  getTask, latestExtraction, latestTaskForDocument, listDocuments, taskBody,
} from './repository.ts';
import type { DocumentRow } from './repository.ts';
import type { ObjectStore } from './storage.ts';

// 추출 초안 확인과 확정 경력 revision. 확인 전 초안은 확정 경력으로 조회되지 않는다.

export type ReviewDeps = { db: DatabaseSync; config: Config; store: ObjectStore };

const notFound = (request: ProductRequest) => problem(request, 404, 'DOCUMENT_NOT_FOUND', '문서를 찾을 수 없습니다.');

function summary(db: DatabaseSync, document: DocumentRow) {
  const task = latestTaskForDocument(db, document.workspace_id, document.id);
  return { document: documentBody(document), current_fact_revision_id: document.current_fact_revision_id, latest_task: task ? taskBody(task) : null };
}

export function listResumeDocuments(deps: ReviewDeps, principal: Principal): Reply {
  return { status: 200, body: { items: listDocuments(deps.db, principal.workspaceId).map(row => summary(deps.db, row)) } };
}

export function getResumeDocument(deps: ReviewDeps, request: ProductRequest, principal: Principal, documentId: string): Reply {
  const document = getDocument(deps.db, principal.workspaceId, documentId);
  return document ? { status: 200, body: documentBody(document) } : notFound(request);
}

function pending(request: ProductRequest, document: DocumentRow): Reply {
  return problem(request, 409, 'EXTRACTION_PENDING', '아직 내용을 읽고 있습니다.', { extraction_status: document.extraction_status });
}

export function getExtractionDraft(deps: ReviewDeps, request: ProductRequest, principal: Principal, documentId: string): Reply {
  const document = getDocument(deps.db, principal.workspaceId, documentId);
  if (!document) return notFound(request);
  const extraction = latestExtraction(deps.db, principal.workspaceId, documentId);
  return extraction ? { status: 200, body: extractionBody(extraction) } : pending(request, document);
}

function readSource(deps: ReviewDeps, workspaceId: string, documentId: string, extractionId: string): SourceText | null {
  try {
    return JSON.parse(deps.store.read(workspaceId, extractionSourceKey(documentId, extractionId)).toString('utf8')) as SourceText;
  } catch {
    return null;
  }
}

export function getSourceText(deps: ReviewDeps, request: ProductRequest, principal: Principal, documentId: string): Reply {
  const document = getDocument(deps.db, principal.workspaceId, documentId);
  if (!document) return notFound(request);
  const extraction = latestExtraction(deps.db, principal.workspaceId, documentId);
  if (!extraction) return pending(request, document);
  const source = readSource(deps, principal.workspaceId, documentId, extraction.id);
  if (!source) return problem(request, 409, 'SOURCE_TEXT_UNAVAILABLE', '읽은 원문이 없습니다. 텍스트를 붙여넣어 새로 등록하세요.', { error_code: document.error_code });
  return { status: 200, body: { document_id: documentId, extraction_id: extraction.id, input_kind: source.input_kind, pages: source.pages } };
}

export function getProductTask(deps: ReviewDeps, request: ProductRequest, principal: Principal, taskId: string): Reply {
  const task = getTask(deps.db, principal.workspaceId, taskId);
  return task ? { status: 200, body: taskBody(task) } : problem(request, 404, 'TASK_NOT_FOUND', '작업을 찾을 수 없습니다.');
}

export function getResumeFactRevision(deps: ReviewDeps, request: ProductRequest, principal: Principal, revisionId: string): Reply {
  const revision = getFactRevision(deps.db, principal.workspaceId, revisionId);
  return revision ? { status: 200, body: factRevisionBody(revision) } : problem(request, 404, 'FACT_REVISION_NOT_FOUND', '확정 경력을 찾을 수 없습니다.');
}

// 대화 진술 근거: 같은 문서의 편집 세션에서 사용자가 쓴 메시지만 인정한다. 이미 확정된 진술은 처음 확인한 시각을 유지한다.
function statementLookup(db: DatabaseSync, workspaceId: string, document: DocumentRow, nowMs: number): StatementLookup {
  const previous = document.current_fact_revision_id ? getFactRevision(db, workspaceId, document.current_fact_revision_id) : undefined;
  const earlier = new Map<string, string>();
  for (const fact of previous ? JSON.parse(previous.facts_json) as ResumeFact[] : []) {
    for (const item of fact.evidence) if (item.kind === 'user_statement') earlier.set(`${item.message_id}\u0000${item.quote}`, item.confirmed_at);
  }
  return {
    message: id => {
      // 같은 문서(이 문서의 확정 경력으로 시작한 편집 세션)에서 사용자가 쓴 메시지만 근거로 인정한다.
      const row = db.prepare(`SELECT m.content FROM ce7_messages m
        JOIN ce7_tailoring_sessions s ON s.workspace_id = m.workspace_id AND s.id = m.session_id
        JOIN ce7_fact_revisions f ON f.workspace_id = s.workspace_id AND f.id = s.fact_revision_id
        WHERE m.workspace_id = ? AND m.id = ? AND m.role = 'user' AND f.document_id = ?`).get(workspaceId, id, document.id)
        // 기본 이력서 보완 대화(S1-16)의 사용자 메시지도 같은 문서 것만 인정한다. assistant 메시지는 근거가 아니다.
        ?? db.prepare(`SELECT m.content FROM ce8_supplement_messages m
          JOIN ce8_supplement_sessions s ON s.workspace_id = m.workspace_id AND s.id = m.session_id
          WHERE m.workspace_id = ? AND m.id = ? AND m.role = 'user' AND s.document_id = ?`).get(workspaceId, id, document.id);
      return row ? { content: String(row.content) } : undefined;
    },
    confirmedAt: (id, quote) => earlier.get(`${id}\u0000${quote}`) ?? iso(nowMs),
  };
}

type ConfirmBody = { extraction_id: string; expected_parent_revision_id: string | null; facts: unknown };

function parseConfirm(value: unknown): ConfirmBody | null {
  if (!isPlainObject(value) || Object.keys(value).sort().join() !== 'expected_parent_revision_id,extraction_id,facts') return null;
  if (typeof value.extraction_id !== 'string') return null;
  if (value.expected_parent_revision_id !== null && typeof value.expected_parent_revision_id !== 'string') return null;
  return value as ConfirmBody;
}

export function confirmFacts(deps: ReviewDeps, request: ProductRequest, principal: Principal, documentId: string): Reply {
  const keyCheck = readIdempotencyKey(request);
  if ('reply' in keyCheck) return keyCheck.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parseConfirm(parsed.value);
  if (!body) return problem(request, 400, 'CONFIRM_REQUEST_INVALID', 'extraction_id, expected_parent_revision_id, facts가 필요합니다.');
  const { db } = deps;
  const operation = 'confirm_resume_facts';

  const document = getDocument(db, principal.workspaceId, documentId);
  if (!document) return notFound(request);
  const extraction = getExtraction(db, principal.workspaceId, body.extraction_id);
  if (!extraction || extraction.document_id !== documentId) return problem(request, 422, 'EXTRACTION_NOT_FOR_DOCUMENT', '이 문서의 추출 결과가 아닙니다.');
  const source = readSource(deps, principal.workspaceId, documentId, extraction.id);
  if (!source) return problem(request, 409, 'SOURCE_TEXT_UNAVAILABLE', '읽은 원문이 없어 근거를 확인할 수 없습니다. 텍스트를 붙여넣어 새로 등록하세요.');
  const checked = validateConfirmedFacts(body.facts, documentId, source, statementLookup(db, principal.workspaceId, document, request.nowMs));
  if (!checked.ok) return problem(request, 422, checked.code, checked.message, checked.index === undefined ? undefined : { fact_index: checked.index });
  // 검증·정규화한 내용으로 hash를 만든다. key 순서만 다른 같은 요청은 같은 요청으로 본다.
  // 진술 근거의 확인 시각은 서버가 정하므로 같은 요청 판정에서는 뺀다(재시도가 409가 되지 않게).
  const hashable = checked.facts.map(fact => ({ ...fact, evidence: fact.evidence.map(item => item.kind === 'user_statement' ? { ...item, confirmed_at: '' } : item) }));
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, body.extraction_id, body.expected_parent_revision_id, hashable]));
  const replay = replayIfStored(db, request, principal.workspaceId, operation, keyCheck.key, requestHash);
  if (replay) return replay;

  const now = request.nowMs;
  db.exec('BEGIN IMMEDIATE');
  try {
    const raced = replayIfStored(db, request, principal.workspaceId, operation, keyCheck.key, requestHash);
    if (raced) { db.exec('ROLLBACK'); return raced; }
    const current = getDocument(db, principal.workspaceId, documentId)?.current_fact_revision_id ?? null;
    if (current !== body.expected_parent_revision_id) {
      db.exec('ROLLBACK');
      return problem(request, 409, 'FACT_REVISION_CONFLICT', '다른 화면에서 먼저 확정했습니다. 최신 내용을 다시 불러오세요.', { current_revision_id: current });
    }
    const parent = current ? getFactRevision(db, principal.workspaceId, current) : undefined;
    const revisionId = newId('facts');
    db.prepare('INSERT INTO ce7_fact_revisions (id, workspace_id, document_id, revision, parent_revision_id, facts_json, content_hash, confirmed_at_ms, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(revisionId, principal.workspaceId, documentId, (parent?.revision ?? 0) + 1, current, JSON.stringify(checked.facts), factsContentHash(checked.facts), now, now);
    db.prepare("UPDATE ce7_documents SET current_fact_revision_id = ?, extraction_status = 'extracted', error_code = NULL WHERE workspace_id = ? AND id = ?")
      .run(revisionId, principal.workspaceId, documentId);
    const saved = getFactRevision(db, principal.workspaceId, revisionId);
    const reply = { status: 201, body: saved ? factRevisionBody(saved) : null };
    storeResponse(db, principal.workspaceId, operation, keyCheck.key, requestHash, reply, now);
    db.exec('COMMIT');
    return reply;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
