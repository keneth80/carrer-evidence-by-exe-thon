import type { DatabaseSync } from 'node:sqlite';
import { checkBlocks, factDrift } from '../../../../packages/tailor/src/guard.ts';
import { missingGlyphs } from '../../../../packages/render/src/resume-pdf.ts';
import { sectionLabel } from '../../../../packages/tailor/src/types.ts';
import type { FactLike, ResumeBlock } from '../../../../packages/tailor/src/types.ts';
import { isPlainObject, newId, problem, readJson, sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import { idempotentWrite, readIdempotencyKey } from '../idempotency.ts';
import { getDocument, getFactRevision, getTask, taskBody } from '../resume/repository.ts';
import type { ObjectStore } from '../resume/storage.ts';
import { getArtifact, getRevision, getSession, revisionBlocks, revisionBody, artifactBody } from './repository.ts';
import type { ArtifactRow } from './repository.ts';
import type { TailorDeps } from './sessions.ts';

// 공고별 이력서 revision 조회·확정과 PDF 렌더 요청·파일 제공.

const revisionNotFound = (request: ProductRequest) => problem(request, 404, 'RESUME_REVISION_NOT_FOUND', '이력서 버전을 찾을 수 없습니다.');
const artifactNotFound = (request: ProductRequest) => problem(request, 404, 'ARTIFACT_NOT_FOUND', '파일을 찾을 수 없습니다.');

export function getResumeRevision(deps: TailorDeps, request: ProductRequest, principal: Principal, revisionId: string): Reply {
  const row = getRevision(deps.db, principal.workspaceId, revisionId);
  return row ? { status: 200, body: revisionBody(row) } : revisionNotFound(request);
}

export function listSessionRevisions(deps: TailorDeps, request: ProductRequest, principal: Principal, sessionId: string): Reply {
  if (!getSession(deps.db, principal.workspaceId, sessionId)) return problem(request, 404, 'TAILORING_SESSION_NOT_FOUND', '편집 세션을 찾을 수 없습니다.');
  const rows = deps.db.prepare('SELECT * FROM ce7_resume_revisions WHERE workspace_id = ? AND session_id = ? ORDER BY revision').all(principal.workspaceId, sessionId);
  return { status: 200, body: { items: rows.map(row => revisionBody(row as never)) } };
}

const companyKey = (name: string) => name.replace(/\((합성|주식회사)\)|㈜|주식회사|\s+/g, '').toLowerCase();

// 다른 공고의 회사 이름이 문서에 남아 있는지 확인한다. 확정 경력에 있는 이름(이전 직장)은 제외한다.
export function otherCompanies(db: DatabaseSync, workspaceId: string, jobCompany: string, blocks: ResumeBlock[], facts: FactLike[]): string[] {
  const rows = db.prepare('SELECT DISTINCT company_name FROM ce7_job_snapshots WHERE workspace_id = ?').all(workspaceId).map(row => String(row.company_name));
  const text = companyKey(blocks.map(block => block.text).join('\n'));
  const factText = companyKey(facts.map(fact => fact.statement).join('\n'));
  return rows.filter(name => {
    const key = companyKey(name);
    return key.length >= 2 && key !== companyKey(jobCompany) && text.includes(key) && !factText.includes(key);
  });
}

export function finalizeResumeRevision(deps: TailorDeps, request: ProductRequest, principal: Principal, revisionId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== 'expected_content_hash,reviewed' || typeof body.expected_content_hash !== 'string' || body.reviewed !== true) {
    return problem(request, 400, 'FINALIZE_REQUEST_INVALID', 'expected_content_hash와 reviewed=true가 필요합니다.');
  }
  const { db } = deps;
  const revision = getRevision(db, principal.workspaceId, revisionId);
  if (!revision) return revisionNotFound(request);
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, body.expected_content_hash]));
  return idempotentWrite(db, request, principal.workspaceId, 'finalize_resume_revision', key.key, requestHash, () => {
    const fresh = getRevision(db, principal.workspaceId, revisionId)!;
    const session = getSession(db, principal.workspaceId, fresh.session_id)!;
    if (fresh.state === 'final') return problem(request, 409, 'RESUME_ALREADY_FINAL', '이미 확정한 버전입니다.');
    if (session.current_resume_revision_id !== fresh.id) return problem(request, 409, 'RESUME_REVISION_CONFLICT', '최신 버전만 확정할 수 있습니다.', { current_resume_revision_id: session.current_resume_revision_id });
    if (fresh.content_hash !== body.expected_content_hash) return problem(request, 409, 'CONTENT_HASH_MISMATCH', '확인한 내용과 저장된 내용이 다릅니다. 다시 불러와 확인하세요.');
    const factRevision = getFactRevision(db, principal.workspaceId, fresh.fact_revision_id);
    const facts = factRevision ? JSON.parse(factRevision.facts_json) as FactLike[] : [];
    const blocks = revisionBlocks(fresh);
    const unsupported = checkBlocks(blocks, facts);
    if (unsupported.length) return problem(request, 422, 'RESUME_UNSUPPORTED_CLAIM', '근거 사실 범위를 넘는 문장이 있어 확정할 수 없습니다.', { blocks: unsupported });
    // 문서가 고정한 경력 버전 이후 사용자가 지우거나 고친 사실이 남아 있으면 확정하지 않는다.
    const headId = factRevision ? getDocument(db, principal.workspaceId, factRevision.document_id)?.current_fact_revision_id : null;
    const head = headId ? getFactRevision(db, principal.workspaceId, headId) : undefined;
    const drifted = head ? factDrift(blocks, facts, JSON.parse(head.facts_json) as FactLike[]) : [];
    if (drifted.length) return problem(request, 409, 'FACTS_CHANGED', '이 문서를 만든 뒤 경력 정보가 바뀌었습니다. 최신 경력으로 다시 검색해 새로 편집하세요.', { block_ids: drifted });
    // 글꼴에 없는 글자는 PDF에서 빠지므로 확정 전에 알린다.
    const missing = missingGlyphs([...blocks.map(block => block.text), ...blocks.map(block => sectionLabel(block.section))]);
    if (missing.length) return problem(request, 422, 'RESUME_GLYPH_MISSING', `PDF 글꼴에 없는 글자가 있어 확정할 수 없습니다: ${missing.join(' ')}`, { characters: missing });
    const job = db.prepare('SELECT company_name FROM ce7_job_snapshots WHERE workspace_id = ? AND id = ?').get(principal.workspaceId, session.job_snapshot_id);
    const others = otherCompanies(db, principal.workspaceId, String(job?.company_name ?? ''), blocks, facts);
    if (others.length) return problem(request, 409, 'RESUME_MENTIONS_OTHER_COMPANY', '다른 공고의 회사 이름이 문서에 남아 있습니다.', { companies: others });
    db.prepare("UPDATE ce7_resume_revisions SET state = 'final', finalized_at_ms = ?, finalization_source = 'user' WHERE workspace_id = ? AND id = ? AND state = 'draft'").run(request.nowMs, principal.workspaceId, revisionId);
    db.prepare("UPDATE ce7_tailoring_sessions SET state = 'ready' WHERE workspace_id = ? AND id = ?").run(principal.workspaceId, session.id);
    return { status: 200, body: revisionBody(getRevision(db, principal.workspaceId, revisionId)!) };
  });
}

// PDF 렌더는 worker의 render_resume 작업이다. resource_id는 렌더할 revision이며, 완료 시 task.result_ids에 artifact ID가 들어간다.
export function createArtifact(deps: TailorDeps, request: ProductRequest, principal: Principal): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).join() !== 'resume_revision_id' || typeof body.resume_revision_id !== 'string') return problem(request, 400, 'ARTIFACT_REQUEST_INVALID', 'resume_revision_id가 필요합니다.');
  const { db } = deps;
  const revision = getRevision(db, principal.workspaceId, body.resume_revision_id);
  if (!revision) return revisionNotFound(request);
  if (revision.state !== 'final') return problem(request, 409, 'RESUME_NOT_FINAL', '확정한 버전만 PDF로 만들 수 있습니다.');
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, revision.id]));
  return idempotentWrite(db, request, principal.workspaceId, 'render_resume_artifact', key.key, requestHash, () => {
    // 같은 revision의 렌더가 이미 대기·진행 중이면 새 작업을 만들지 않고 그 작업을 돌려준다.
    const running = db.prepare("SELECT * FROM ce7_tasks WHERE workspace_id = ? AND kind = 'render_resume' AND state IN ('queued','running') AND json_extract(input_json, '$.resume_revision_id') = ? LIMIT 1").get(principal.workspaceId, revision.id);
    if (running) return { status: 202, body: { task: taskBody(running as never), resource_id: revision.id } };
    const now = request.nowMs;
    const taskId = newId('task');
    const inputJson = JSON.stringify({ resume_revision_id: revision.id, content_hash: revision.content_hash });
    db.prepare(`INSERT INTO ce7_tasks (id, workspace_id, kind, state, input_json, input_hash, result_json, error_code, cancel_requested, provider_transmission, lease_owner, lease_generation, lease_until_ms, available_at_ms, created_at_ms, updated_at_ms)
      VALUES (?, ?, 'render_resume', 'queued', ?, ?, NULL, NULL, 0, 'not_dispatched', NULL, 0, NULL, ?, ?, ?)`).run(taskId, principal.workspaceId, inputJson, sha256Hex(inputJson), now, now, now);
    const task = getTask(db, principal.workspaceId, taskId);
    return { status: 202, body: { task: task ? taskBody(task) : null, resource_id: revision.id } };
  });
}

export function listRevisionArtifacts(deps: TailorDeps, request: ProductRequest, principal: Principal, revisionId: string): Reply {
  if (!getRevision(deps.db, principal.workspaceId, revisionId)) return revisionNotFound(request);
  const rows = deps.db.prepare('SELECT * FROM ce7_artifacts WHERE workspace_id = ? AND resume_revision_id = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 20').all(principal.workspaceId, revisionId) as ArtifactRow[];
  return { status: 200, body: { items: rows.map(artifactBody) } };
}

export function getArtifactMeta(deps: TailorDeps, request: ProductRequest, principal: Principal, artifactId: string): Reply {
  const row = getArtifact(deps.db, principal.workspaceId, artifactId);
  return row ? { status: 200, body: artifactBody(row) } : artifactNotFound(request);
}

// 저장된 bytes의 hash가 DB와 같을 때만 제공한다. 내려받은 파일이 확정 당시 파일임을 보장한다.
export function getArtifactContent(deps: TailorDeps & { store: ObjectStore }, request: ProductRequest, principal: Principal, artifactId: string): Reply {
  const row = getArtifact(deps.db, principal.workspaceId, artifactId);
  if (!row) return artifactNotFound(request);
  let bytes: Buffer;
  try { bytes = deps.store.read(principal.workspaceId, row.object_key); } catch { return problem(request, 409, 'ARTIFACT_FILE_MISSING', '저장된 파일을 읽을 수 없습니다. PDF를 다시 만들어 주세요.'); }
  if (sha256Hex(bytes) !== row.sha256) return problem(request, 409, 'ARTIFACT_HASH_MISMATCH', '저장된 파일이 생성 당시와 다릅니다. PDF를 다시 만들어 주세요.');
  const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  const download = request.url.searchParams.get('download') === '1';
  return {
    status: 200,
    // 내려받기는 attachment, 미리보기는 inline(서버 send가 filename으로 inline 헤더를 붙인다).
    raw: { bytes, contentType: 'application/pdf', ...(download ? {} : { filename: row.filename }) },
    headers: {
      'Content-Security-Policy': "sandbox; default-src 'none'", 'X-PDF-Page-Count': String(pages), 'X-Content-SHA256': row.sha256,
      ...(download ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}` } : {}),
    },
  };
}
