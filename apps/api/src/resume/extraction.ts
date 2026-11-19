import type { DatabaseSync } from 'node:sqlite';
import { extractPdfTextIsolated, ExtractionError } from '../../../../packages/resume/src/pdf.ts';
import { extractDocxTextIsolated } from '../../../../packages/resume/src/docx.ts';
import { extractCandidates } from '../../../../packages/resume/src/candidates.ts';
import { normalizePastedText } from '../../../../packages/resume/src/source.ts';
import type { SourceText } from '../../../../packages/resume/src/source.ts';
import { formatWarning } from '../../../../packages/resume/src/types.ts';
import type { ResumeFact } from '../../../../packages/resume/src/types.ts';
import { newId, sha256Hex } from '../http.ts';
import { extractionSourceKey } from './repository.ts';
import type { DocumentRow } from './repository.ts';
import type { ObjectStore } from './storage.ts';

// extract_resume 작업 실행기. 네트워크·유료 호출이 없는 로컬 추출이라 lease 만료 후 재실행해도 안전하다.
// 결과 저장은 lease owner·generation·만료를 transaction 안에서 다시 확인한다(CLAUDE.md 불변 조건).

export type ExtractionDeps = { db: DatabaseSync; store: ObjectStore; owner: string; leaseMs: number; now: () => number };
// lease를 잃고 다시 집힌 횟수의 상한. 넘으면 무한 재시도 대신 실패로 끝내고 붙여넣기 안내를 보여준다.
export const MAX_EXTRACTION_ATTEMPTS = 3;

type Claim = { taskId: string; workspaceId: string; documentId: string; generation: number };
type Outcome = { status: 'review_required' | 'failed'; facts: ResumeFact[]; warnings: string[]; errorCode: string | null; source: SourceText | null };

function claim(deps: ExtractionDeps, taskId: string): Claim | null {
  const now = deps.now();
  const { db } = deps;
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare(`UPDATE ce7_tasks SET state = 'running', lease_owner = ?, lease_generation = lease_generation + 1, lease_until_ms = ?, updated_at_ms = ?
      WHERE id = ? AND kind = 'extract_resume' AND cancel_requested = 0 AND (state = 'queued' OR (state = 'running' AND lease_until_ms < ?))
      RETURNING workspace_id, input_json, lease_generation`).get(deps.owner, now + deps.leaseMs, now, taskId, now);
    if (!row) { db.exec('ROLLBACK'); return null; }
    const documentId = String((JSON.parse(String(row.input_json)) as { document_id: string }).document_id);
    db.prepare("UPDATE ce7_documents SET extraction_status = 'extracting' WHERE workspace_id = ? AND id = ? AND extraction_status IN ('uploaded','extracting')").run(row.workspace_id, documentId);
    db.exec('COMMIT');
    return { taskId, workspaceId: String(row.workspace_id), documentId, generation: Number(row.lease_generation) };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function failed(code: string, message: string): Outcome {
  return { status: 'failed', facts: [], warnings: [`${code}@- ${message}`], errorCode: code, source: null };
}

async function extract(document: DocumentRow, bytes: Buffer): Promise<Outcome> {
  if (sha256Hex(bytes) !== document.sha256) return failed('SOURCE_HASH_MISMATCH', '저장된 원본 파일이 등록 당시와 다릅니다.');
  let source: SourceText;
  try {
    source = document.input_kind === 'text_pdf' ? await extractPdfTextIsolated(bytes)
      : document.input_kind === 'docx' ? await extractDocxTextIsolated(bytes)
      : { input_kind: 'pasted_text', pages: [{ page: null, text: normalizePastedText(bytes.toString('utf8')) }] };
  } catch (error) {
    if (error instanceof ExtractionError) return failed(error.code, error.message);
    return failed('EXTRACTION_INTERNAL_ERROR', '추출 중 예기치 않은 오류가 발생했습니다.');
  }
  const candidates = extractCandidates(source, document.id);
  const warnings = candidates.warnings.map(formatWarning);
  if (candidates.facts.length === 0) {
    const code = candidates.warnings.some(item => item.code === 'EMPTY_TEXT') ? 'EMPTY_TEXT' : 'NO_FACT_CANDIDATES';
    return { status: 'failed', facts: [], warnings, errorCode: code, source };
  }
  return { status: 'review_required', facts: candidates.facts, warnings, errorCode: null, source };
}

function complete(deps: ExtractionDeps, held: Claim, document: DocumentRow, outcome: Outcome, extractionId: string): boolean {
  const { db } = deps;
  const now = deps.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const lease = db.prepare("SELECT 1 FROM ce7_tasks WHERE id = ? AND state = 'running' AND lease_owner = ? AND lease_generation = ? AND lease_until_ms > ?")
      .get(held.taskId, deps.owner, held.generation, now);
    if (!lease) { db.exec('ROLLBACK'); return false; }
    db.prepare('INSERT INTO ce7_extractions (id, workspace_id, document_id, source_sha256, state, facts_json, warnings_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(extractionId, held.workspaceId, held.documentId, document.sha256, outcome.status, JSON.stringify(outcome.facts), JSON.stringify(outcome.warnings), now);
    db.prepare('UPDATE ce7_documents SET extraction_status = ?, error_code = ? WHERE workspace_id = ? AND id = ?')
      .run(outcome.status, outcome.errorCode, held.workspaceId, held.documentId);
    db.prepare(`UPDATE ce7_tasks SET state = ?, error_code = ?, result_json = ?, lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ? WHERE id = ?`)
      .run(outcome.status === 'failed' ? 'failed' : 'succeeded', outcome.errorCode, JSON.stringify({ extraction_id: extractionId }), now, held.taskId);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export async function runExtractionTask(deps: ExtractionDeps, taskId: string): Promise<'completed' | 'not_claimed' | 'lease_lost'> {
  const held = claim(deps, taskId);
  if (!held) return 'not_claimed';
  const document = deps.db.prepare('SELECT * FROM ce7_documents WHERE workspace_id = ? AND id = ?').get(held.workspaceId, held.documentId) as DocumentRow;
  let outcome: Outcome;
  if (held.generation > MAX_EXTRACTION_ATTEMPTS) {
    outcome = failed('EXTRACTION_ATTEMPTS_EXCEEDED', '여러 번 시도했지만 내용을 읽지 못했습니다. 내용을 붙여넣어 주세요.');
  } else {
    try {
      outcome = await extract(document, deps.store.read(held.workspaceId, document.object_key));
    } catch {
      outcome = failed('SOURCE_UNAVAILABLE', '저장된 원본 파일을 읽을 수 없습니다.');
    }
  }
  const extractionId = newId('extraction');
  // 원문 텍스트 파일은 transaction 밖에서 먼저 쓴다. lease를 잃으면 참조되지 않는 파일만 남는다.
  if (outcome.source) deps.store.put(held.workspaceId, extractionSourceKey(held.documentId, extractionId), Buffer.from(JSON.stringify(outcome.source)));
  const saved = complete(deps, held, document, outcome, extractionId);
  if (!saved && outcome.source) deps.store.remove(held.workspaceId, extractionSourceKey(held.documentId, extractionId));
  return saved ? 'completed' : 'lease_lost';
}

// 재시작 뒤 남은 queued 작업과 lease가 만료된 running 작업을 다시 실행한다.
export async function recoverExtractionTasks(deps: ExtractionDeps): Promise<number> {
  const rows = deps.db.prepare("SELECT id FROM ce7_tasks WHERE kind = 'extract_resume' AND cancel_requested = 0 AND (state = 'queued' OR (state = 'running' AND lease_until_ms < ?)) ORDER BY created_at_ms LIMIT 20").all(deps.now());
  let completed = 0;
  for (const row of rows) {
    if (await runExtractionTask(deps, String(row.id)) === 'completed') completed++;
  }
  return completed;
}
