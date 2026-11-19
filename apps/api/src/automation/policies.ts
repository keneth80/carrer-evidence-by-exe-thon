import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson, sha256 } from '../../../../packages/apply/src/payload.ts';
import { SELF_FORM_SITE_ID } from '../../../../packages/apply/src/self-form.ts';
import { validateConditions } from '../../../../packages/search/src/conditions.ts';
import { iso, isPlainObject, newId, problem, readJson } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import { idempotentWrite, readIdempotencyKey } from '../idempotency.ts';
import { readVerifiedArtifact } from '../apply/repository.ts';
import type { ApplyDeps } from '../apply/applications.ts';

// 자동화 정책(S06: recommend·prepare 모드). 작성(revision)과 활성화를 나눈다. 활성화는 정확한 content hash·generation·사용자 동의를 확인한다.
// submit 모드(정책 기반 자동 제출)는 S07 범위라 아직 받지 않는다.

export type PolicyRevisionRow = {
  id: string; workspace_id: string; policy_id: string; revision: number; parent_revision_id: string | null; mode: 'recommend' | 'prepare' | 'submit';
  document_strategy: 'fixed_document' | 'tailor_within_facts'; fact_revision_id: string; seed_resume_revision_id: string; fixed_artifact_id: string | null;
  conditions_json: string; allowed_sites_json: string; account_bindings_json: string; excluded_companies_json: string; allowed_edits_json: string;
  daily_limit: number; total_limit: number; budget_limit_micro_usd: number; quota_timezone: string; valid_from_ms: number; expires_at_ms: number; content_hash: string; created_at_ms: number;
};
export type PolicyControlRow = { workspace_id: string; policy_id: string; active_revision_id: string | null; state: 'draft' | 'active' | 'paused' | 'revoked' | 'expired'; generation: number; updated_at_ms: number };

const KEYS = ['account_binding_ids', 'allowed_edits', 'allowed_sites', 'budget_limit_micro_usd', 'conditions', 'daily_limit', 'document_strategy', 'excluded_companies', 'expected_parent_revision_id', 'expires_at', 'fact_revision_id', 'fixed_artifact_id', 'mode', 'policy_id', 'quota_timezone', 'seed_resume_revision_id', 'total_limit', 'valid_from'];
const EDITS = ['reorder', 'rewrite_with_facts', 'summary'];
const MAX_PERIOD_MS = 90 * 24 * 60 * 60 * 1000;
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const stringList = (value: unknown, max: number, itemMax: number) => Array.isArray(value) && value.length <= max && value.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= itemMax) && new Set(value).size === value.length;

export const getPolicyRevision = (db: DatabaseSync, ws: string, id: string) => db.prepare('SELECT * FROM ce7_policy_revisions WHERE workspace_id = ? AND id = ?').get(ws, id) as PolicyRevisionRow | undefined;
export const getPolicyControl = (db: DatabaseSync, ws: string, policyId: string) => db.prepare('SELECT * FROM ce7_policy_controls WHERE workspace_id = ? AND policy_id = ?').get(ws, policyId) as PolicyControlRow | undefined;

export function policyContent(row: Pick<PolicyRevisionRow, 'mode' | 'document_strategy' | 'fact_revision_id' | 'seed_resume_revision_id' | 'fixed_artifact_id' | 'daily_limit' | 'total_limit' | 'budget_limit_micro_usd' | 'quota_timezone' | 'valid_from_ms' | 'expires_at_ms'> & { conditions: unknown; allowed_sites: unknown; account_binding_ids: unknown; excluded_companies: unknown; allowed_edits: unknown }) {
  return {
    mode: row.mode, document_strategy: row.document_strategy, fact_revision_id: row.fact_revision_id, seed_resume_revision_id: row.seed_resume_revision_id, fixed_artifact_id: row.fixed_artifact_id,
    conditions: row.conditions, allowed_sites: row.allowed_sites, account_binding_ids: row.account_binding_ids, excluded_companies: row.excluded_companies, allowed_edits: row.allowed_edits,
    daily_limit: row.daily_limit, total_limit: row.total_limit, budget_limit_micro_usd: row.budget_limit_micro_usd, quota_timezone: row.quota_timezone, valid_from: iso(row.valid_from_ms), expires_at: iso(row.expires_at_ms),
  };
}

export function policyRevisionBody(row: PolicyRevisionRow) {
  return {
    id: row.id, workspace_id: row.workspace_id, policy_id: row.policy_id, revision: row.revision,
    ...policyContent({ ...row, conditions: JSON.parse(row.conditions_json), allowed_sites: JSON.parse(row.allowed_sites_json), account_binding_ids: JSON.parse(row.account_bindings_json), excluded_companies: JSON.parse(row.excluded_companies_json), allowed_edits: JSON.parse(row.allowed_edits_json) }),
    content_hash: row.content_hash, created_at: iso(row.created_at_ms),
  };
}

export const policyControlBody = (row: PolicyControlRow) => ({ policy_id: row.policy_id, workspace_id: row.workspace_id, active_revision_id: row.active_revision_id, state: row.state, generation: row.generation, updated_at: iso(row.updated_at_ms) });

// 정책이 지금 실행할 수 있는 상태인지: 활성·같은 revision·유효 기간 안.
export function policyRunProblem(db: DatabaseSync, ws: string, revision: PolicyRevisionRow, nowMs: number): string | null {
  const control = getPolicyControl(db, ws, revision.policy_id);
  if (!control || control.state !== 'active' || control.active_revision_id !== revision.id) return 'POLICY_NOT_ACTIVE';
  if (nowMs < revision.valid_from_ms) return 'POLICY_NOT_STARTED';
  if (nowMs >= revision.expires_at_ms) return 'POLICY_EXPIRED';
  return null;
}

export function createPolicyRevision(deps: ApplyDeps, request: ProductRequest, principal: Principal): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== KEYS.join()) return problem(request, 400, 'INVALID_POLICY', '정책 항목이 모두 필요합니다.');
  const bad = (message: string) => problem(request, 400, 'INVALID_POLICY', message);
  if (body.mode === 'submit') return problem(request, 422, 'POLICY_MODE_NOT_IMPLEMENTED', '정책에 따른 자동 제출(submit)은 아직 제공하지 않습니다. 추천 또는 자동 준비만 선택할 수 있습니다.');
  if (body.mode !== 'recommend' && body.mode !== 'prepare') return bad('mode가 올바르지 않습니다.');
  if (body.document_strategy !== 'fixed_document' && body.document_strategy !== 'tailor_within_facts') return bad('document_strategy가 올바르지 않습니다.');
  if (!isId(body.fact_revision_id) || !isId(body.seed_resume_revision_id) || (body.fixed_artifact_id !== null && !isId(body.fixed_artifact_id))) return bad('기준 경력·이력서·파일 ID가 올바르지 않습니다.');
  if (!stringList(body.allowed_sites, 5, 64) || (body.allowed_sites as unknown[]).length === 0) return bad('허용 사이트를 하나 이상 고르세요.');
  if (!stringList(body.account_binding_ids, 5, 128) || (body.account_binding_ids as unknown[]).length === 0) return bad('사용할 실행기 계정을 하나 이상 고르세요.');
  if (!stringList(body.excluded_companies, 20, 100)) return bad('제외 회사는 20개까지, 각 100자 이하입니다.');
  if (!Array.isArray(body.allowed_edits) || !body.allowed_edits.every(item => EDITS.includes(String(item))) || new Set(body.allowed_edits).size !== body.allowed_edits.length) return bad('허용 수정 범위가 올바르지 않습니다.');
  if (body.document_strategy === 'fixed_document' ? (body.fixed_artifact_id === null || body.allowed_edits.length > 0) : body.fixed_artifact_id !== null) return bad('확정 파일 그대로 쓰기는 파일이 필요하고 수정 범위가 없어야 합니다. 맞춤 수정은 파일을 지정하지 않습니다.');
  if (!Number.isInteger(body.daily_limit) || (body.daily_limit as number) < 1 || (body.daily_limit as number) > 20 || !Number.isInteger(body.total_limit) || (body.total_limit as number) < 1 || (body.total_limit as number) > 50) return bad('하루 한도는 1~20, 전체 한도는 1~50입니다.');
  if (!Number.isInteger(body.budget_limit_micro_usd) || (body.budget_limit_micro_usd as number) < 0) return bad('비용 한도가 올바르지 않습니다.');
  if (body.quota_timezone !== 'Asia/Seoul') return bad('한도 기준 시간대는 Asia/Seoul입니다.');
  const validFrom = Date.parse(String(body.valid_from));
  const expires = Date.parse(String(body.expires_at));
  if (!Number.isFinite(validFrom) || !Number.isFinite(expires) || expires <= validFrom || expires - validFrom > MAX_PERIOD_MS || expires <= request.nowMs) return bad('유효 기간은 시작보다 뒤, 지금 이후에 끝나고 90일 이내여야 합니다.');
  const conditions = validateConditions(body.conditions);
  if (!conditions.ok) return problem(request, 422, conditions.code, conditions.message);
  if ((body.allowed_sites as string[]).some(site => site !== SELF_FORM_SITE_ID)) return problem(request, 422, 'SITE_NOT_SUPPORTED', '현재 자동 준비는 자체 테스트 폼 사이트만 허용합니다.');
  if (body.policy_id !== null && !isId(body.policy_id)) return bad('policy_id가 올바르지 않습니다.');
  if (body.expected_parent_revision_id !== null && !isId(body.expected_parent_revision_id)) return bad('expected_parent_revision_id가 올바르지 않습니다.');

  const ws = principal.workspaceId;
  const { db } = deps;
  const facts = db.prepare('SELECT id FROM ce7_fact_revisions WHERE workspace_id = ? AND id = ?').get(ws, body.fact_revision_id);
  const seed = db.prepare('SELECT id, state, fact_revision_id, finalization_source FROM ce7_resume_revisions WHERE workspace_id = ? AND id = ?').get(ws, body.seed_resume_revision_id) as { id: string; state: string; fact_revision_id: string; finalization_source: string | null } | undefined;
  if (!facts || !seed) return problem(request, 404, 'POLICY_SOURCE_NOT_FOUND', '기준 경력 또는 이력서를 찾을 수 없습니다.');
  if (seed.state !== 'final') return problem(request, 422, 'SEED_RESUME_NOT_FINAL', '확정한 이력서만 기준으로 쓸 수 있습니다.');
  if (seed.finalization_source !== 'user') return problem(request, 422, 'CAMPAIGN_SEED_NOT_ALLOWED', '정책이 자동으로 확정한 이력서는 기준으로 쓸 수 없습니다. 직접 확인·확정한 이력서를 고르세요.');
  if (seed.fact_revision_id !== body.fact_revision_id) return problem(request, 422, 'POLICY_SEED_FACT_MISMATCH', '기준 이력서가 사용한 확정 경력과 다른 경력 버전입니다.');
  if (body.fixed_artifact_id !== null) {
    const file = readVerifiedArtifact(db, deps.store, ws, String(body.fixed_artifact_id));
    if ('error' in file || file.row.resume_revision_id !== seed.id) return problem(request, 422, 'POLICY_FIXED_ARTIFACT_MISMATCH', '기준 이력서에서 만든 확인된 PDF가 아닙니다.');
  }
  for (const bindingId of body.account_binding_ids as string[]) {
    const binding = db.prepare('SELECT site_id, revoked_at_ms FROM ce7_account_bindings WHERE workspace_id = ? AND id = ?').get(ws, bindingId) as { site_id: string; revoked_at_ms: number | null } | undefined;
    if (!binding || binding.revoked_at_ms !== null || !(body.allowed_sites as string[]).includes(binding.site_id)) return problem(request, 422, 'ACCOUNT_BINDING_INVALID', '연결이 해제되었거나 허용 사이트와 맞지 않는 실행기 계정입니다.');
  }
  const content = policyContent({
    mode: body.mode, document_strategy: body.document_strategy, fact_revision_id: body.fact_revision_id, seed_resume_revision_id: body.seed_resume_revision_id, fixed_artifact_id: body.fixed_artifact_id as string | null,
    daily_limit: body.daily_limit as number, total_limit: body.total_limit as number, budget_limit_micro_usd: body.budget_limit_micro_usd as number, quota_timezone: 'Asia/Seoul', valid_from_ms: validFrom, expires_at_ms: expires,
    conditions: conditions.conditions, allowed_sites: body.allowed_sites, account_binding_ids: body.account_binding_ids, excluded_companies: (body.excluded_companies as string[]).map(item => item.trim()), allowed_edits: body.allowed_edits,
  });
  const contentHash = sha256(canonicalJson(content));
  return idempotentWrite(db, request, ws, 'createPolicyRevision', key.key, sha256(canonicalJson(body)), () => {
    const now = request.nowMs;
    let policyId = body.policy_id as string | null;
    let revision = 1;
    if (policyId === null) {
      if (body.expected_parent_revision_id !== null) return problem(request, 409, 'POLICY_REVISION_CONFLICT', '새 정책에는 이전 revision이 없습니다.');
      policyId = newId('policy');
      db.prepare("INSERT INTO ce7_policy_controls (workspace_id, policy_id, active_revision_id, state, generation, updated_at_ms) VALUES (?, ?, NULL, 'draft', 1, ?)").run(ws, policyId, now);
    } else {
      const control = getPolicyControl(db, ws, policyId);
      if (!control) return problem(request, 404, 'POLICY_NOT_FOUND', '정책을 찾을 수 없습니다.');
      if (control.state === 'revoked') return problem(request, 409, 'POLICY_REVOKED', '철회한 정책은 고칠 수 없습니다. 새 정책을 만들어 주세요.');
      const latest = db.prepare('SELECT id, revision FROM ce7_policy_revisions WHERE workspace_id = ? AND policy_id = ? ORDER BY revision DESC LIMIT 1').get(ws, policyId) as { id: string; revision: number };
      if (latest.id !== body.expected_parent_revision_id) return problem(request, 409, 'POLICY_REVISION_CONFLICT', '다른 화면에서 정책이 바뀌었습니다. 새로 불러온 뒤 다시 저장해 주세요.');
      revision = latest.revision + 1;
    }
    const id = newId('policyrev');
    db.prepare(`INSERT INTO ce7_policy_revisions (id, workspace_id, policy_id, revision, parent_revision_id, mode, document_strategy, fact_revision_id, seed_resume_revision_id, fixed_artifact_id, conditions_json, allowed_sites_json, account_bindings_json, excluded_companies_json, allowed_edits_json, daily_limit, total_limit, budget_limit_micro_usd, quota_timezone, valid_from_ms, expires_at_ms, content_hash, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Seoul', ?, ?, ?, ?)`)
      .run(id, ws, policyId, revision, revision === 1 ? null : String(body.expected_parent_revision_id), content.mode as string, content.document_strategy as string, content.fact_revision_id as string, content.seed_resume_revision_id as string, content.fixed_artifact_id,
        JSON.stringify(content.conditions), JSON.stringify(content.allowed_sites), JSON.stringify(content.account_binding_ids), JSON.stringify(content.excluded_companies), JSON.stringify(content.allowed_edits),
        content.daily_limit, content.total_limit, content.budget_limit_micro_usd, validFrom, expires, contentHash, now);
    return { status: 201, body: policyRevisionBody(getPolicyRevision(db, ws, id)!) };
  });
}

export function listPolicies(deps: ApplyDeps, _request: ProductRequest, principal: Principal): Reply {
  const rows = deps.db.prepare(`SELECT r.* FROM ce7_policy_revisions r WHERE r.workspace_id = ? AND r.revision = (SELECT max(revision) FROM ce7_policy_revisions x WHERE x.workspace_id = r.workspace_id AND x.policy_id = r.policy_id)
    ORDER BY r.created_at_ms DESC LIMIT 50`).all(principal.workspaceId) as PolicyRevisionRow[];
  return { status: 200, body: { items: rows.map(policyRevisionBody), next_cursor: null } };
}

export function getPolicyRevisionHandler(deps: ApplyDeps, request: ProductRequest, principal: Principal, policyId: string, revisionId: string): Reply {
  const row = getPolicyRevision(deps.db, principal.workspaceId, revisionId);
  return row && row.policy_id === policyId ? { status: 200, body: policyRevisionBody(row) } : problem(request, 404, 'POLICY_REVISION_NOT_FOUND', '정책 버전을 찾을 수 없습니다.');
}

export function getPolicyControlHandler(deps: ApplyDeps, request: ProductRequest, principal: Principal, policyId: string): Reply {
  const row = getPolicyControl(deps.db, principal.workspaceId, policyId);
  return row ? { status: 200, body: policyControlBody(row) } : problem(request, 404, 'POLICY_NOT_FOUND', '정책을 찾을 수 없습니다.');
}

// 상태 변경은 모두 generation을 하나 올린다(DB trigger도 강제). 기대 generation이 다르면 409.
function changeControl(deps: ApplyDeps, request: ProductRequest, principal: Principal, policyId: string, operation: string, decide: (control: PolicyControlRow, body: Record<string, unknown>) => Reply | { state: PolicyControlRow['state']; active: string | null }): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || !Number.isInteger(body.expected_generation)) return problem(request, 400, 'INVALID_POLICY_CONTROL', 'expected_generation이 필요합니다.');
  const ws = principal.workspaceId;
  if (!getPolicyControl(deps.db, ws, policyId)) return problem(request, 404, 'POLICY_NOT_FOUND', '정책을 찾을 수 없습니다.');
  return idempotentWrite(deps.db, request, ws, `${operation}:${policyId}`, key.key, sha256(canonicalJson(body)), () => {
    const control = getPolicyControl(deps.db, ws, policyId)!;
    if (control.generation !== body.expected_generation) return problem(request, 409, 'POLICY_GENERATION_CONFLICT', '다른 화면에서 정책 상태가 바뀌었습니다. 새로 불러와 주세요.');
    const next = decide(control, body);
    if ('status' in next) return next;
    deps.db.prepare('UPDATE ce7_policy_controls SET state = ?, active_revision_id = ?, generation = generation + 1, updated_at_ms = ? WHERE workspace_id = ? AND policy_id = ?').run(next.state, next.active, request.nowMs, ws, policyId);
    return { status: 200, body: policyControlBody(getPolicyControl(deps.db, ws, policyId)!) };
  });
}

export function activatePolicy(deps: ApplyDeps, request: ProductRequest, principal: Principal, policyId: string): Reply {
  return changeControl(deps, request, principal, policyId, 'activatePolicy', (control, body) => {
    if (Object.keys(body).sort().join() !== 'accepted_content_hash,consent,expected_generation,revision_id' || body.consent !== true || typeof body.revision_id !== 'string' || typeof body.accepted_content_hash !== 'string') return problem(request, 400, 'INVALID_POLICY_ACTIVATION', 'revision_id·accepted_content_hash·consent=true가 필요합니다.');
    if (control.state === 'revoked') return problem(request, 409, 'POLICY_REVOKED', '철회한 정책은 다시 활성화하지 않습니다.');
    const revision = getPolicyRevision(deps.db, principal.workspaceId, body.revision_id);
    if (!revision || revision.policy_id !== policyId) return problem(request, 404, 'POLICY_REVISION_NOT_FOUND', '정책 버전을 찾을 수 없습니다.');
    if (revision.content_hash !== body.accepted_content_hash) return problem(request, 409, 'POLICY_CONTENT_CHANGED', '확인한 정책 내용과 저장된 내용이 다릅니다.');
    if (revision.expires_at_ms <= request.nowMs) return problem(request, 409, 'POLICY_EXPIRED', '유효 기간이 지난 정책입니다.');
    return { state: 'active', active: revision.id };
  });
}

export function pausePolicy(deps: ApplyDeps, request: ProductRequest, principal: Principal, policyId: string): Reply {
  return changeControl(deps, request, principal, policyId, 'pausePolicy', control => {
    if (control.state === 'revoked') return problem(request, 409, 'POLICY_REVOKED', '철회한 정책입니다.');
    return { state: 'paused', active: control.active_revision_id };
  });
}

export function revokePolicy(deps: ApplyDeps, request: ProductRequest, principal: Principal, policyId: string): Reply {
  return changeControl(deps, request, principal, policyId, 'revokePolicy', control => {
    if (control.state === 'revoked') return problem(request, 409, 'POLICY_REVOKED', '이미 철회한 정책입니다.');
    return { state: 'revoked', active: control.active_revision_id };
  });
}
