import { randomUUID } from 'node:crypto';
import { createMockSearchProvider } from '../../packages/search/src/provider.ts';
import { createMockChatProvider } from '../../packages/tailor/src/provider.ts';
import { runDiscoverTask } from '../../apps/worker/src/discover-task.ts';
import { createApplication, finalPdf, pairDevice, prepareForm } from './s05-harness.mjs';

// S06 검사 공통: 기준 지원 건(확정 PDF·답변·확장 binding) 준비 → 정책 작성·활성화 → 캠페인 실행(worker 직접 실행).

export const discoverDeps = (api, overrides = {}) => ({ db: api.db, owner: `discover-${randomUUID()}`, leaseMs: 30_000, now: Date.now, search: createMockSearchProvider(), chat: createMockChatProvider({ slowMs: 10 }), store: api.store, ...overrides });
export const runDiscover = (api, overrides) => runDiscoverTask(discoverDeps(api, overrides));

export async function seedApplication(api, http, options = {}) {
  const prepared = await finalPdf(api, http, options);
  const app = (await createApplication(http, prepared)).body;
  const device = await pairDevice(api, http);
  const form = await prepareForm(device, app.id);
  return { prepared, app, device, form, bindingId: form.verified.body.target.account_binding_id };
}

export function policyBody(seed, overrides = {}) {
  const now = Date.now();
  return {
    policy_id: null, mode: 'prepare', document_strategy: 'tailor_within_facts', fact_revision_id: seed.prepared.revision.fact_revision_id, seed_resume_revision_id: seed.prepared.revision.id, fixed_artifact_id: null,
    conditions: [], allowed_sites: ['self-form'], account_binding_ids: [seed.bindingId], excluded_companies: [], allowed_edits: ['reorder', 'summary', 'rewrite_with_facts'],
    daily_limit: 5, total_limit: 10, budget_limit_micro_usd: 0, quota_timezone: 'Asia/Seoul', valid_from: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 7 * 86_400_000).toISOString(), expected_parent_revision_id: null,
    ...overrides,
  };
}

// 정책 작성 → 활성화 → 캠페인 생성 → 실행 → worker 1회. 대기함을 돌려준다.
export async function startCampaign(api, http, seed, overrides = {}) {
  const policy = await http.post('/api/v1/auto-apply-policies', { json: policyBody(seed, overrides) });
  if (policy.status !== 201) throw new Error(`policy ${policy.status} ${JSON.stringify(policy.body)}`);
  const control = (await http.get(`/api/v1/auto-apply-policies/${policy.body.policy_id}`)).body;
  const activated = await http.post(`/api/v1/auto-apply-policies/${policy.body.policy_id}/activate`, { json: { revision_id: policy.body.id, expected_generation: control.generation, accepted_content_hash: policy.body.content_hash, consent: true } });
  if (activated.status !== 200) throw new Error(`activate ${activated.status} ${JSON.stringify(activated.body)}`);
  const campaign = await http.post('/api/v1/similar-job-campaigns', { json: { policy_revision_id: policy.body.id, seed_application_id: seed.app.id } });
  if (campaign.status !== 201) throw new Error(`campaign ${campaign.status} ${JSON.stringify(campaign.body)}`);
  const run = await http.post(`/api/v1/similar-job-campaigns/${campaign.body.id}/run`, { json: {} });
  if (run.status !== 202) throw new Error(`run ${run.status} ${JSON.stringify(run.body)}`);
  const result = await runDiscover(api);
  const queue = (await http.get(`/api/v1/similar-job-campaigns/${campaign.body.id}/queue`)).body;
  return { policy: policy.body, control: activated.body, campaign: campaign.body, run: run.body, result, queue };
}
