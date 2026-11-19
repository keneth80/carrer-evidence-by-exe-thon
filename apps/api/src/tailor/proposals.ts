import type { DatabaseSync } from 'node:sqlite';
import { applyChanges } from '../../../../packages/tailor/src/blocks.ts';
import { checkChange, factDrift } from '../../../../packages/tailor/src/guard.ts';
import type { FactLike, ProposedChange } from '../../../../packages/tailor/src/types.ts';
import type { ResumeFact } from '../../../../packages/resume/src/types.ts';
import { isPlainObject, newId, problem, readJson, sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import { idempotentWrite, readIdempotencyKey } from '../idempotency.ts';
import { getDocument, getFactRevision } from '../resume/repository.ts';
import { getProposal, getRevision, getSession, insertRevision, listProposals, nextRevisionNumber, proposalBody, revisionBlocks, revisionBody } from './repository.ts';
import type { ProposalRow, RevisionRow } from './repository.ts';
import { contentHash } from './sessions.ts';
import type { TailorDeps } from './sessions.ts';

// 변경 제안 수용·거절. 수용은 base revision·content hash CAS로 현재 문서에만 적용하고 새 revision을 만든다.

const notFound = (request: ProductRequest) => problem(request, 404, 'EDIT_PROPOSAL_NOT_FOUND', '변경 제안을 찾을 수 없습니다.');
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

export function listEditProposals(deps: TailorDeps, request: ProductRequest, principal: Principal, sessionId: string): Reply {
  if (!getSession(deps.db, principal.workspaceId, sessionId)) return problem(request, 404, 'TAILORING_SESSION_NOT_FOUND', '편집 세션을 찾을 수 없습니다.');
  return { status: 200, body: { items: listProposals(deps.db, principal.workspaceId, sessionId).map(proposalBody), next_cursor: null } };
}

type AcceptBody = { expected_resume_revision_id: string; expected_content_hash: string; change_indexes: number[] | null };

function parseAccept(value: unknown): AcceptBody | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort().join();
  if (keys !== 'expected_content_hash,expected_resume_revision_id' && keys !== 'change_indexes,expected_content_hash,expected_resume_revision_id') return null;
  if (typeof value.expected_resume_revision_id !== 'string' || typeof value.expected_content_hash !== 'string') return null;
  const indexes = value.change_indexes;
  if (indexes !== undefined && (!Array.isArray(indexes) || indexes.length === 0 || !indexes.every(item => Number.isInteger(item) && item >= 0) || new Set(indexes).size !== indexes.length)) return null;
  return { expected_resume_revision_id: value.expected_resume_revision_id, expected_content_hash: value.expected_content_hash, change_indexes: (indexes as number[] | undefined) ?? null };
}

// 사실 확인이 필요한 변경은 사용자가 대화 진술을 경력 정보로 확정한 뒤에만 적용한다.
// 확정 경력의 최신 버전에서 같은 문장을 가진 user_statement 사실을 찾아 근거로 바꾼다.
function resolveStatements(db: DatabaseSync, workspaceId: string, base: RevisionRow, selected: ProposedChange[]): { factRevisionId: string; facts: FactLike[]; changes: ProposedChange[] } | { code: string; message: string; status: number } {
  const baseFacts = getFactRevision(db, workspaceId, base.fact_revision_id);
  if (!baseFacts) return { status: 409, code: 'FACT_REVISION_MISSING', message: '기준 경력 버전을 찾을 수 없습니다.' };
  if (!selected.some(change => change.needs_fact_confirmation)) return { factRevisionId: baseFacts.id, facts: JSON.parse(baseFacts.facts_json) as FactLike[], changes: selected };
  const headId = getDocument(db, workspaceId, baseFacts.document_id)?.current_fact_revision_id;
  const head = headId ? getFactRevision(db, workspaceId, headId) : undefined;
  const headFacts = head ? JSON.parse(head.facts_json) as ResumeFact[] : [];
  const changes: ProposedChange[] = [];
  for (const change of selected) {
    if (!change.needs_fact_confirmation) { changes.push(change); continue; }
    const fact = headFacts.find(item => squash(item.statement) === squash(change.after ?? '') && item.evidence.some(evidence => evidence.kind === 'user_statement'));
    if (!fact) return { status: 422, code: 'FACT_CONFIRMATION_REQUIRED', message: '이 변경은 먼저 경력 정보로 확인해야 적용할 수 있습니다.' };
    changes.push({ ...change, fact_ids: [fact.id], needs_fact_confirmation: false });
  }
  // 새 경력 버전에서도 기존 문서 블록의 근거가 같은 ID·같은 문장으로 남아 있어야 한다.
  if (factDrift(revisionBlocks(base), JSON.parse(baseFacts.facts_json) as FactLike[], headFacts).length) {
    return { status: 409, code: 'FACTS_CHANGED', message: '경력 정보가 바뀌어 현재 문서의 근거 일부가 없어졌습니다. 경력 확인 화면에서 다시 확인하세요.' };
  }
  return { factRevisionId: head!.id, facts: headFacts, changes };
}

function markStaleIfMoved(db: DatabaseSync, proposal: ProposalRow, currentId: string | null, currentHash: string | undefined) {
  if (proposal.base_resume_revision_id === currentId && proposal.base_content_hash === currentHash) return false;
  db.prepare("UPDATE ce7_edit_proposals SET state = 'stale' WHERE workspace_id = ? AND id = ? AND state = 'proposed'").run(proposal.workspace_id, proposal.id);
  return true;
}

export function acceptEditProposal(deps: TailorDeps, request: ProductRequest, principal: Principal, proposalId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parseAccept(parsed.value);
  if (!body) return problem(request, 400, 'ACCEPT_REQUEST_INVALID', 'expected_resume_revision_id, expected_content_hash(선택: change_indexes)가 필요합니다.');
  const { db } = deps;
  const proposal = getProposal(db, principal.workspaceId, proposalId);
  if (!proposal) return notFound(request);
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname, body]));
  const replayOrWrite = () => idempotentWrite(db, request, principal.workspaceId, 'accept_edit_proposal', key.key, requestHash, () => {
    const fresh = getProposal(db, principal.workspaceId, proposalId)!;
    if (fresh.state !== 'proposed') return problem(request, 409, fresh.state === 'stale' ? 'PROPOSAL_STALE' : 'PROPOSAL_NOT_OPEN', fresh.state === 'stale' ? '다른 변경이 있어 다시 비교가 필요해요.' : '이미 처리한 제안입니다.', { state: fresh.state });
    const session = getSession(db, principal.workspaceId, fresh.session_id)!;
    const current = getRevision(db, principal.workspaceId, session.current_resume_revision_id ?? '');
    if (!current) return problem(request, 409, 'RESUME_REVISION_MISSING', '현재 문서가 없습니다.');
    if (body.expected_resume_revision_id !== current.id || body.expected_content_hash !== current.content_hash) {
      return problem(request, 409, 'RESUME_REVISION_CONFLICT', '다른 변경이 있어 최신 문서를 다시 불러와야 합니다.', { current_resume_revision_id: current.id });
    }
    if (fresh.base_resume_revision_id !== current.id || fresh.base_content_hash !== current.content_hash) return problem(request, 409, 'PROPOSAL_STALE', '다른 변경이 있어 다시 비교가 필요해요.');
    const all = JSON.parse(fresh.changes_json) as ProposedChange[];
    const indexes = [...(body.change_indexes ?? all.map((_, index) => index))].sort((a, b) => a - b);
    if (indexes.some(index => index >= all.length)) return problem(request, 400, 'ACCEPT_REQUEST_INVALID', '없는 변경 번호입니다.');
    const resolved = resolveStatements(db, principal.workspaceId, current, indexes.map(index => all[index]));
    if ('code' in resolved) return problem(request, resolved.status, resolved.code, resolved.message);
    for (const [index, change] of resolved.changes.entries()) {
      const issues = checkChange(change, resolved.facts);
      if (issues.length) return problem(request, 422, 'CHANGE_NOT_SUPPORTED', '근거 사실 범위를 넘는 변경은 적용할 수 없습니다.', { change_index: indexes[index], issues });
    }
    const applied = applyChanges(revisionBlocks(current), resolved.changes);
    if (!applied.ok) return problem(request, 422, applied.code, applied.message, { change_index: indexes[applied.index] });
    const id = newId('resume');
    insertRevision(db, { id, workspace_id: principal.workspaceId, session_id: session.id, job_snapshot_id: session.job_snapshot_id, fact_revision_id: resolved.factRevisionId,
      revision: nextRevisionNumber(db, principal.workspaceId, session.id), parent_revision_id: current.id, blocks_json: JSON.stringify(applied.blocks), content_hash: contentHash(applied.blocks), created_at_ms: request.nowMs });
    db.prepare("UPDATE ce7_edit_proposals SET state = 'accepted' WHERE workspace_id = ? AND id = ?").run(principal.workspaceId, proposalId);
    // 같은 세션의 다른 미처리 제안은 이전 문서 기준이 되었으므로 다시 비교하도록 표시한다.
    db.prepare("UPDATE ce7_edit_proposals SET state = 'stale' WHERE workspace_id = ? AND session_id = ? AND state = 'proposed'").run(principal.workspaceId, session.id);
    const saved = getRevision(db, principal.workspaceId, id);
    return { status: 201, body: saved ? revisionBody(saved) : null };
  });
  const reply = replayOrWrite();
  // 기준 문서가 바뀐 제안은 거절 응답과 별도로 stale 상태를 남긴다(위 transaction은 4xx에서 rollback된다).
  if (reply.status === 409 && (reply.body as { code?: string })?.code === 'PROPOSAL_STALE') {
    const session = getSession(db, principal.workspaceId, proposal.session_id);
    const current = getRevision(db, principal.workspaceId, session?.current_resume_revision_id ?? '');
    markStaleIfMoved(db, proposal, current?.id ?? null, current?.content_hash);
  }
  return reply;
}

export function rejectEditProposal(deps: TailorDeps, request: ProductRequest, principal: Principal, proposalId: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const { db } = deps;
  if (!getProposal(db, principal.workspaceId, proposalId)) return notFound(request);
  const requestHash = sha256Hex(JSON.stringify([request.method, request.url.pathname]));
  return idempotentWrite(db, request, principal.workspaceId, 'reject_edit_proposal', key.key, requestHash, () => {
    const fresh = getProposal(db, principal.workspaceId, proposalId)!;
    if (fresh.state !== 'proposed' && fresh.state !== 'stale') return problem(request, 409, 'PROPOSAL_NOT_OPEN', '이미 처리한 제안입니다.', { state: fresh.state });
    db.prepare("UPDATE ce7_edit_proposals SET state = 'rejected' WHERE workspace_id = ? AND id = ?").run(principal.workspaceId, proposalId);
    return { status: 200, body: proposalBody(getProposal(db, principal.workspaceId, proposalId)!) };
  });
}
