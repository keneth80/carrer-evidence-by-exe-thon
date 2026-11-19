import { randomUUID } from 'node:crypto';
import { createMockChatProvider } from '../../packages/tailor/src/provider.ts';
import { runSearchTask } from '../../apps/worker/src/search-task.ts';
import { runTailorTask } from '../../apps/worker/src/tailor-task.ts';
import { runRenderTask } from '../../apps/worker/src/render-task.ts';
import { confirmFixture, createSearch, jobsOf, workerDeps } from './s02-harness.mjs';

// S04 검사 공통: 합성 이력서 확정 → mock 검색 → 공고 선택 → 편집 세션. worker 작업은 직접 실행한다.

export const tailorDeps = (api, overrides = {}) => ({ db: api.db, owner: `tailor-${randomUUID()}`, leaseMs: 30_000, now: Date.now, provider: createMockChatProvider({ slowMs: 50 }), ...overrides });
export const renderDeps = (api, overrides = {}) => ({ db: api.db, owner: `render-${randomUUID()}`, leaseMs: 30_000, now: Date.now, store: api.store, ...overrides });
export const runTailor = (api, overrides) => runTailorTask(tailorDeps(api, overrides));
export const runRender = (api, overrides) => runRenderTask(renderDeps(api, overrides));

export async function startTailoring(api, http, name = 'frontend', pickTitle = /프론트엔드/) {
  const fixture = await confirmFixture(api, http, name);
  const search = await createSearch(http, fixture.revision.id);
  await runSearchTask(workerDeps(api));
  const { jobs } = await jobsOf(http, search.searchId);
  const job = jobs.find(item => pickTitle.test(item.title)) ?? jobs[0];
  const created = await http.post('/api/v1/tailoring-sessions', { json: { job_snapshot_id: job.id, fact_revision_id: fixture.revision.id } });
  if (created.status !== 201) throw new Error(`session failed ${created.status} ${JSON.stringify(created.body)}`);
  return { ...fixture, job, jobs, session: created.body };
}

export async function current(http, sessionId) {
  const session = (await http.get(`/api/v1/tailoring-sessions/${sessionId}`)).body;
  const revision = (await http.get(`/api/v1/resume-revisions/${session.current_resume_revision_id}`)).body;
  return { session, revision };
}

// 메시지를 보내고 worker로 응답을 만든 뒤 마지막 제안을 돌려준다.
export async function say(api, http, sessionId, content, overrides) {
  const { revision } = await current(http, sessionId);
  const sent = await http.post(`/api/v1/tailoring-sessions/${sessionId}/messages`, { json: { expected_resume_revision_id: revision.id, content } });
  if (sent.status !== 202) throw new Error(`message failed ${sent.status} ${JSON.stringify(sent.body)}`);
  const result = await runTailor(api, overrides);
  const proposals = (await http.get(`/api/v1/tailoring-sessions/${sessionId}/proposals`)).body.items;
  const task = (await http.get(`/api/v1/product-tasks/${sent.body.task.id}`)).body;
  return { sent: sent.body, result, task, proposal: proposals.find(item => task.result_ids.includes(item.id)) ?? null, revision };
}

export async function accept(http, proposal, revision, extra = {}) {
  return http.post(`/api/v1/edit-proposals/${proposal.id}/accept`, { json: { expected_resume_revision_id: revision.id, expected_content_hash: revision.content_hash, ...extra } });
}
