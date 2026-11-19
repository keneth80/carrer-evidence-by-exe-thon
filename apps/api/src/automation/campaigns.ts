import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson, sha256 } from '../../../../packages/apply/src/payload.ts';
import { iso, isPlainObject, newId, problem, readJson, sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import { idempotentWrite, readIdempotencyKey } from '../idempotency.ts';
import { getTask, taskBody } from '../resume/repository.ts';
import type { TaskRow } from '../resume/repository.ts';
import { getJobSnapshot, jobSnapshotBody } from '../search/repository.ts';
import { artifactBody } from '../tailor/repository.ts';
import type { ArtifactRow } from '../tailor/repository.ts';
import { getApplication, getAppRevision, submissionState } from '../apply/repository.ts';
import type { ApplyDeps } from '../apply/applications.ts';
import { getPolicyControl, getPolicyRevision, policyControlBody, policyRevisionBody, policyRunProblem } from './policies.ts';

// 유사 공고 캠페인. 기준(seed) 지원 건·revision·공고 snapshot·이력서 revision을 만들 때 고정한다.
// 캠페인이 만든 지원 건을 새 기준으로 삼지 않는다. 실행(run)은 탐색·준비 작업만 예약하며 제출하지 않는다.

export type CampaignRow = { id: string; workspace_id: string; policy_revision_id: string; seed_application_id: string; seed_application_revision: number; seed_job_snapshot_id: string; seed_resume_revision_id: string; state: 'draft' | 'active' | 'paused' | 'completed' | 'canceled'; created_at_ms: number };
export type CampaignJobRow = { workspace_id: string; campaign_id: string; job_snapshot_id: string; application_id: string | null; state: 'discovered' | 'needs_review' | 'eligible' | 'prepared' | 'queued' | 'skipped'; similarity_json: string };

export const getCampaign = (db: DatabaseSync, ws: string, id: string) => db.prepare('SELECT * FROM ce7_campaigns WHERE workspace_id = ? AND id = ?').get(ws, id) as CampaignRow | undefined;
export const listCampaignJobs = (db: DatabaseSync, ws: string, id: string) => db.prepare('SELECT * FROM ce7_campaign_jobs WHERE workspace_id = ? AND campaign_id = ? ORDER BY rowid').all(ws, id) as CampaignJobRow[];
const notFound = (request: ProductRequest) => problem(request, 404, 'CAMPAIGN_NOT_FOUND', '캠페인을 찾을 수 없습니다.');

export function campaignBody(db: DatabaseSync, row: CampaignRow) {
  const jobs = listCampaignJobs(db, row.workspace_id, row.id);
  return {
    id: row.id, workspace_id: row.workspace_id, policy_revision_id: row.policy_revision_id, seed_application_id: row.seed_application_id,
    seed_job_snapshot_id: row.seed_job_snapshot_id, seed_resume_revision_id: row.seed_resume_revision_id, state: row.state,
    discovered_job_snapshot_ids: jobs.map(job => job.job_snapshot_id), application_ids: [...new Set(jobs.map(job => job.application_id).filter((id): id is string => id !== null))],
    created_at: iso(row.created_at_ms),
  };
}

export function createCampaign(deps: ApplyDeps, request: ProductRequest, principal: Principal): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== 'policy_revision_id,seed_application_id' || typeof body.policy_revision_id !== 'string' || typeof body.seed_application_id !== 'string') {
    return problem(request, 400, 'INVALID_CAMPAIGN', 'policy_revision_id와 seed_application_id가 필요합니다.');
  }
  const ws = principal.workspaceId;
  return idempotentWrite(deps.db, request, ws, 'createCampaign', key.key, sha256(canonicalJson(body)), () => {
    const policy = getPolicyRevision(deps.db, ws, String(body.policy_revision_id));
    const app = getApplication(deps.db, ws, String(body.seed_application_id));
    if (!policy || !app) return problem(request, 404, 'CAMPAIGN_SOURCE_NOT_FOUND', '정책 또는 기준 지원 건을 찾을 수 없습니다.');
    // 자동으로 준비한 지원 건은 기준이 될 수 없다(탐색 범위를 자동 결과로 넓히지 않는다).
    if (app.source_kind === 'campaign') return problem(request, 422, 'CAMPAIGN_SEED_NOT_ALLOWED', '자동으로 준비한 지원 건은 기준으로 쓸 수 없습니다. 직접 준비한 지원 건을 고르세요.');
    const revision = getAppRevision(deps.db, ws, app.id, app.current_revision)!;
    if (revision.resume_revision_id !== policy.seed_resume_revision_id) return problem(request, 422, 'SEED_RESUME_MISMATCH', '정책의 기준 이력서와 기준 지원 건의 이력서가 다릅니다.');
    const id = newId('campaign');
    deps.db.prepare("INSERT INTO ce7_campaigns (id, workspace_id, policy_revision_id, seed_application_id, seed_application_revision, seed_job_snapshot_id, seed_resume_revision_id, state, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)")
      .run(id, ws, policy.id, app.id, revision.revision, revision.job_snapshot_id, revision.resume_revision_id, request.nowMs);
    return { status: 201, body: campaignBody(deps.db, getCampaign(deps.db, ws, id)!) };
  });
}

export function listCampaigns(deps: ApplyDeps, _request: ProductRequest, principal: Principal): Reply {
  const rows = deps.db.prepare('SELECT * FROM ce7_campaigns WHERE workspace_id = ? ORDER BY created_at_ms DESC LIMIT 50').all(principal.workspaceId) as CampaignRow[];
  return { status: 200, body: { items: rows.map(row => campaignBody(deps.db, row)), next_cursor: null } };
}

export function getCampaignHandler(deps: ApplyDeps, request: ProductRequest, principal: Principal, id: string): Reply {
  const row = getCampaign(deps.db, principal.workspaceId, id);
  return row ? { status: 200, body: campaignBody(deps.db, row) } : notFound(request);
}

const discoverTask = (db: DatabaseSync, ws: string, campaignId: string) =>
  db.prepare("SELECT * FROM ce7_tasks WHERE workspace_id = ? AND kind = 'discover_similar' AND state IN ('queued','running') AND json_extract(input_json, '$.campaign_id') = ? LIMIT 1").get(ws, campaignId) as TaskRow | undefined;

// 명시적 실행·재개. 현재 활성 정책을 확인하고 탐색·준비 작업을 예약한다. 이미 대기·진행 중이면 그 작업을 돌려준다.
export function runCampaign(deps: ApplyDeps, request: ProductRequest, principal: Principal, id: string): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const ws = principal.workspaceId;
  if (!getCampaign(deps.db, ws, id)) return notFound(request);
  return idempotentWrite(deps.db, request, ws, `runCampaign:${id}`, key.key, sha256Hex(id), () => {
    const campaign = getCampaign(deps.db, ws, id)!;
    if (campaign.state === 'canceled' || campaign.state === 'completed') return problem(request, 409, 'CAMPAIGN_CLOSED', '끝났거나 취소한 캠페인은 다시 시작하지 않습니다. 새 캠페인을 만들어 주세요.');
    const policy = getPolicyRevision(deps.db, ws, campaign.policy_revision_id)!;
    const blocked = policyRunProblem(deps.db, ws, policy, request.nowMs);
    if (blocked) return problem(request, 409, blocked, '정책이 활성 상태가 아니거나 유효 기간이 아닙니다. 정책을 확인해 주세요.');
    const running = discoverTask(deps.db, ws, id);
    if (running) return { status: 202, body: { task: taskBody(running), resource_id: id } };
    const now = request.nowMs;
    if (campaign.state !== 'active') deps.db.prepare("UPDATE ce7_campaigns SET state = 'active' WHERE workspace_id = ? AND id = ?").run(ws, id);
    const control = getPolicyControl(deps.db, ws, policy.policy_id)!;
    const taskId = newId('task');
    const inputJson = JSON.stringify({ campaign_id: id, policy_revision_id: policy.id, policy_generation: control.generation });
    deps.db.prepare(`INSERT INTO ce7_tasks (id, workspace_id, kind, state, input_json, input_hash, result_json, error_code, cancel_requested, provider_transmission, lease_owner, lease_generation, lease_until_ms, available_at_ms, created_at_ms, updated_at_ms)
      VALUES (?, ?, 'discover_similar', 'queued', ?, ?, NULL, NULL, 0, 'not_dispatched', NULL, 0, NULL, ?, ?, ?)`).run(taskId, ws, inputJson, sha256Hex(inputJson), now, now, now);
    return { status: 202, body: { task: taskBody(getTask(deps.db, ws, taskId)!), resource_id: id } };
  });
}

// 대기 작업은 실행하지 않고(진행 중이면 중지 요청), 이미 준비한 서류는 그대로 둔다. 제출은 S06에 없다.
function stopCampaign(deps: ApplyDeps, request: ProductRequest, principal: Principal, id: string, target: 'paused' | 'canceled'): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const ws = principal.workspaceId;
  if (!getCampaign(deps.db, ws, id)) return notFound(request);
  return idempotentWrite(deps.db, request, ws, `${target}Campaign:${id}`, key.key, sha256Hex(id), () => {
    const campaign = getCampaign(deps.db, ws, id)!;
    if (campaign.state === 'canceled' || campaign.state === 'completed') return problem(request, 409, 'CAMPAIGN_CLOSED', '이미 끝났거나 취소한 캠페인입니다.');
    if (target === 'paused' && campaign.state === 'paused') return { status: 200, body: campaignBody(deps.db, campaign) };
    const now = request.nowMs;
    deps.db.prepare('UPDATE ce7_campaigns SET state = ? WHERE workspace_id = ? AND id = ?').run(target, ws, id);
    deps.db.prepare("UPDATE ce7_tasks SET state = 'canceled', cancel_requested = 1, updated_at_ms = ? WHERE workspace_id = ? AND kind = 'discover_similar' AND state = 'queued' AND json_extract(input_json, '$.campaign_id') = ?").run(now, ws, id);
    deps.db.prepare("UPDATE ce7_tasks SET cancel_requested = 1, updated_at_ms = ? WHERE workspace_id = ? AND kind = 'discover_similar' AND state = 'running' AND json_extract(input_json, '$.campaign_id') = ?").run(now, ws, id);
    return { status: 200, body: campaignBody(deps.db, getCampaign(deps.db, ws, id)!) };
  });
}

export const pauseCampaign = (deps: ApplyDeps, request: ProductRequest, principal: Principal, id: string) => stopCampaign(deps, request, principal, id, 'paused');
export const cancelCampaign = (deps: ApplyDeps, request: ProductRequest, principal: Principal, id: string) => stopCampaign(deps, request, principal, id, 'canceled');

// 대기함(확장 경로): 고정 기준, 정책, 후보별 유사 이유·조건·중복·준비 상태·필요한 확인·파일 버전.
export function getCampaignQueue(deps: ApplyDeps, request: ProductRequest, principal: Principal, id: string): Reply {
  const ws = principal.workspaceId;
  const campaign = getCampaign(deps.db, ws, id);
  if (!campaign) return notFound(request);
  const policy = getPolicyRevision(deps.db, ws, campaign.policy_revision_id)!;
  const seedApp = getApplication(deps.db, ws, campaign.seed_application_id)!;
  const seedRevision = getAppRevision(deps.db, ws, campaign.seed_application_id, campaign.seed_application_revision)!;
  const artifact = deps.db.prepare('SELECT * FROM ce7_artifacts WHERE workspace_id = ? AND id = ?').get(ws, seedRevision.artifact_id) as ArtifactRow;
  const tasks = deps.db.prepare("SELECT * FROM ce7_tasks WHERE workspace_id = ? AND kind = 'discover_similar' AND json_extract(input_json, '$.campaign_id') = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 5").all(ws, id) as TaskRow[];
  const items = listCampaignJobs(deps.db, ws, id).map(row => {
    const app = row.application_id ? getApplication(deps.db, ws, row.application_id) : undefined;
    return { job: jobSnapshotBody(getJobSnapshot(deps.db, ws, row.job_snapshot_id)!), state: row.state, application_id: row.application_id, application_state: app ? submissionState(deps.db, app) : null, evaluation: JSON.parse(row.similarity_json) as unknown };
  });
  return {
    status: 200,
    body: {
      campaign: campaignBody(deps.db, campaign), policy: policyRevisionBody(policy), policy_control: policyControlBody(getPolicyControl(deps.db, ws, policy.policy_id)!),
      seed: { application_id: seedApp.id, application_revision: seedRevision.revision, submission_state: submissionState(deps.db, seedApp), job: jobSnapshotBody(getJobSnapshot(deps.db, ws, campaign.seed_job_snapshot_id)!), resume_revision_id: campaign.seed_resume_revision_id, artifact: artifactBody(artifact) },
      tasks: tasks.map(taskBody), items,
    },
  };
}
