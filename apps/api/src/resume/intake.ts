import type { DatabaseSync } from 'node:sqlite';
import { DOCX_MIME, inspectDocx } from '../../../../packages/resume/src/docx.ts';
import { readFileSync } from 'node:fs';
import type { Config } from '../config.ts';
import { header, isPlainObject, newId, problem, readJson, sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import { readIdempotencyKey, replayIfStored, storeResponse } from '../idempotency.ts';
import { getDocument, getTask, taskBody } from './repository.ts';
import type { ObjectStore } from './storage.ts';

// 원본 등록: 실제 bytes의 형식·크기·hash를 서버에서 확인하고 문서·추출 작업을 한 transaction에 저장한다.

export type IntakeDeps = { db: DatabaseSync; config: Config; store: ObjectStore; schedule: (taskId: string) => void };

// 합성 여부는 사용자가 정하지 않는다. 서버가 보관한 fixture hash와 실제 bytes hash가 같을 때만 synthetic이다.
const fixtureHashes: Set<string> = (() => {
  const manifest = JSON.parse(readFileSync(new URL('../../../../fixtures/resumes/expected.json', import.meta.url), 'utf8')) as { cases: { pdf_sha256: string; text_sha256: string }[] };
  // DOCX 합성 입력은 동결된 expected.json 대신 docx.synthetic.json에 hash를 둔다(DECISIONS S1-12).
  const docx = JSON.parse(readFileSync(new URL('../../../../fixtures/resumes/docx.synthetic.json', import.meta.url), 'utf8')) as { cases: { docx_sha256: string }[] };
  return new Set([...manifest.cases.flatMap(item => [item.pdf_sha256, item.text_sha256]), ...docx.cases.map(item => item.docx_sha256)]);
})();

function safeFilename(value: string | undefined, fallback: string): string {
  const base = (value ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return cleaned.length > 0 ? cleaned : fallback;
}

type Upload = { kind: 'text_pdf' | 'pasted_text' | 'docx'; bytes: Buffer; filename: string };
const STORED: Record<Upload['kind'], { extension: string; mime: string }> = {
  text_pdf: { extension: 'pdf', mime: 'application/pdf' },
  pasted_text: { extension: 'txt', mime: 'text/plain' },
  docx: { extension: 'docx', mime: DOCX_MIME },
};

function register(deps: IntakeDeps, request: ProductRequest, principal: Principal, upload: Upload, operation: string): Reply {
  const keyCheck = readIdempotencyKey(request);
  if ('reply' in keyCheck) return keyCheck.reply;
  const sha256 = sha256Hex(upload.bytes);
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, upload.kind, upload.filename, sha256]));
  const { db } = deps;
  const replay = replayIfStored(db, request, principal.workspaceId, operation, keyCheck.key, requestHash);
  if (replay) return replay;

  const documentId = newId('doc');
  const taskId = newId('task');
  const objectKey = `documents/${documentId}/original.${STORED[upload.kind].extension}`;
  const dataOrigin = fixtureHashes.has(sha256) ? 'synthetic' : 'user';
  if (dataOrigin === 'user' && principal.mode !== 'authenticated') return problem(request, 403, 'AUTHENTICATED_PRINCIPAL_REQUIRED', '실제 사용자 파일은 인증된 세션에서만 저장합니다.');
  const now = request.nowMs;
  deps.store.put(principal.workspaceId, objectKey, upload.bytes);
  let reply: { status: number; body: unknown };
  db.exec('BEGIN IMMEDIATE');
  try {
    // 파일을 쓰는 사이 같은 key의 요청이 먼저 끝났을 수 있다.
    const raced = replayIfStored(db, request, principal.workspaceId, operation, keyCheck.key, requestHash);
    if (raced) { db.exec('ROLLBACK'); deps.store.remove(principal.workspaceId, objectKey); return raced; }
    db.prepare(`INSERT INTO ce7_documents (id, workspace_id, input_kind, filename, mime_type, byte_size, sha256, object_key, data_origin, extraction_status, error_code, current_fact_revision_id, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', NULL, NULL, ?)`)
      .run(documentId, principal.workspaceId, upload.kind, upload.filename, STORED[upload.kind].mime, upload.bytes.length, sha256, objectKey, dataOrigin, now);
    const input = JSON.stringify({ document_id: documentId });
    db.prepare(`INSERT INTO ce7_tasks (id, workspace_id, kind, state, input_json, input_hash, result_json, error_code, cancel_requested, provider_transmission, lease_owner, lease_generation, lease_until_ms, available_at_ms, created_at_ms, updated_at_ms)
      VALUES (?, ?, 'extract_resume', 'queued', ?, ?, NULL, NULL, 0, 'not_dispatched', NULL, 0, NULL, ?, ?, ?)`)
      .run(taskId, principal.workspaceId, input, sha256Hex(input), now, now, now);
    const task = getTask(db, principal.workspaceId, taskId);
    reply = { status: 202, body: { task: task ? taskBody(task) : null, resource_id: documentId } };
    storeResponse(db, principal.workspaceId, operation, keyCheck.key, requestHash, reply, now);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    deps.store.remove(principal.workspaceId, objectKey);
    throw error;
  }
  deps.schedule(taskId);
  return reply;
}

// 확장자가 아니라 파일 앞부분 bytes로 형식을 판단한다. 옛 Word(.doc)·암호 Word는 OLE 컨테이너다.
function detectKind(bytes: Buffer, filename: string): { kind: 'text_pdf' | 'docx' } | { code: string; message: string } {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'text_pdf' };
  if (bytes.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004') return inspectDocx(bytes) ?? { kind: 'docx' };
  if (bytes.subarray(0, 8).equals(OLE_SIGNATURE) || /\.doc$/i.test(filename)) {
    return { code: 'DOC_NOT_SUPPORTED', message: '옛 Word(.doc)나 암호가 걸린 Word 파일은 읽지 못합니다. Word에서 .docx 또는 PDF로 저장해 올려 주세요.' };
  }
  return { code: 'UNSUPPORTED_FORMAT', message: '텍스트 PDF 또는 Word(.docx)만 올릴 수 있습니다. 다른 형식은 내용을 텍스트로 붙여넣어 주세요.' };
}
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export async function uploadPdf(deps: IntakeDeps, request: ProductRequest, principal: Principal): Promise<Reply> {
  const type = header(request, 'content-type') ?? '';
  if (!/^multipart\/form-data\b/i.test(type)) return problem(request, 415, 'MULTIPART_REQUIRED', 'multipart/form-data의 file 필드로 올려 주세요.');
  if (request.body.length > deps.config.limits.pdfBytes + 64 * 1024) return problem(request, 413, 'FILE_TOO_LARGE', `파일은 최대 ${deps.config.limits.pdfBytes / 1024 / 1024}MB입니다.`);
  let form: FormData;
  try {
    form = await new Request('http://local/upload', { method: 'POST', headers: { 'content-type': type }, body: new Uint8Array(request.body) }).formData();
  } catch {
    return problem(request, 400, 'MULTIPART_INVALID', '업로드 형식을 읽을 수 없습니다.');
  }
  const keys = [...new Set(form.keys())];
  const file = form.get('file');
  if (keys.join() !== 'file' || form.getAll('file').length !== 1 || !(file instanceof File)) return problem(request, 400, 'FILE_FIELD_REQUIRED', 'file 필드 하나만 보내 주세요.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const filename = safeFilename(file.name, 'resume.pdf');
  if (bytes.length === 0) return problem(request, 400, 'FILE_EMPTY', '빈 파일입니다.');
  if (bytes.length > deps.config.limits.pdfBytes) return problem(request, 413, 'FILE_TOO_LARGE', `파일은 최대 ${deps.config.limits.pdfBytes / 1024 / 1024}MB입니다.`);
  const detected = detectKind(bytes, filename);
  if (!('kind' in detected)) return problem(request, 415, detected.code, detected.message, { accepted: ['application/pdf', DOCX_MIME], alternative: 'POST /api/v1/resume-documents/text' });
  return register(deps, request, principal, { kind: detected.kind, bytes, filename }, 'upload_resume_document');
}

export function createPastedText(deps: IntakeDeps, request: ProductRequest, principal: Principal): Reply {
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || !Object.keys(body).every(key => key === 'text' || key === 'filename') || typeof body.text !== 'string') {
    return problem(request, 400, 'PASTED_TEXT_INVALID', 'text(필수)와 filename(선택)만 보낼 수 있습니다.');
  }
  if (body.filename !== undefined && typeof body.filename !== 'string') return problem(request, 400, 'PASTED_TEXT_INVALID', 'filename은 문자열입니다.');
  if (body.text.trim().length === 0) return problem(request, 422, 'TEXT_EMPTY', '붙여넣은 내용이 비어 있습니다.');
  if (body.text.length > deps.config.limits.pastedCharacters) return problem(request, 413, 'TEXT_TOO_LARGE', `붙여넣기는 최대 ${deps.config.limits.pastedCharacters.toLocaleString()}자입니다.`);
  const filename = safeFilename(body.filename as string | undefined, 'pasted-resume.txt');
  return register(deps, request, principal, { kind: 'pasted_text', bytes: Buffer.from(body.text, 'utf8'), filename }, 'create_pasted_resume');
}

export function readOriginal(deps: IntakeDeps, request: ProductRequest, principal: Principal, documentId: string): Reply {
  const document = getDocument(deps.db, principal.workspaceId, documentId);
  if (!document) return problem(request, 404, 'DOCUMENT_NOT_FOUND', '문서를 찾을 수 없습니다.');
  let bytes: Buffer;
  try {
    bytes = deps.store.read(principal.workspaceId, document.object_key);
  } catch {
    return problem(request, 409, 'SOURCE_UNAVAILABLE', '저장된 원본 파일을 읽을 수 없습니다.');
  }
  if (sha256Hex(bytes) !== document.sha256) return problem(request, 409, 'SOURCE_HASH_MISMATCH', '저장된 원본이 등록 당시와 다릅니다.');
  return { status: 200, headers: { 'Content-Security-Policy': 'sandbox' }, raw: { bytes, contentType: document.mime_type === 'text/plain' ? 'text/plain; charset=utf-8' : document.mime_type, filename: document.filename } };
}
