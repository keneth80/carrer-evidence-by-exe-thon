import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createMockSearchProvider } from '../../packages/search/src/provider.ts';

// S02 검사 공통: 합성 이력서 PDF를 실제 업로드 경로로 확정하고, worker 실행 의존성을 만든다.

export function workerDeps(api, overrides = {}) {
  return { db: api.db, owner: `worker-${randomUUID()}`, leaseMs: 30_000, now: Date.now, provider: createMockSearchProvider(), ...overrides };
}

export async function confirmFixture(api, http, name) {
  const pdf = readFileSync(new URL(`../../fixtures/resumes/${name}.synthetic.pdf`, import.meta.url));
  const accepted = await http.upload('/api/v1/resume-documents', pdf, `${name}.synthetic.pdf`);
  if (accepted.status !== 202) throw new Error(`upload failed ${accepted.status}`);
  await api.settle();
  const documentId = accepted.body.resource_id;
  const draft = (await http.get(`/api/v1/resume-documents/${documentId}/extraction`)).body;
  const confirmed = await http.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: null, facts: draft.facts } });
  if (confirmed.status !== 201) throw new Error(`confirm failed ${confirmed.status}`);
  return { documentId, draft, revision: confirmed.body };
}

export async function createSearch(http, factRevisionId, conditions = [], maxCandidates = 10) {
  const intent = await http.post('/api/v1/search-intents', { json: { fact_revision_id: factRevisionId, conditions } });
  if (intent.status !== 201) throw new Error(`intent failed ${intent.status} ${JSON.stringify(intent.body)}`);
  const accepted = await http.post('/api/v1/resume-searches', { json: { intent_id: intent.body.id, max_candidates: maxCandidates } });
  if (accepted.status !== 202) throw new Error(`search failed ${accepted.status}`);
  return { intent: intent.body, accepted: accepted.body, searchId: accepted.body.resource_id, taskId: accepted.body.task.id };
}

export async function jobsOf(http, searchId) {
  const search = (await http.get(`/api/v1/resume-searches/${searchId}`)).body;
  const jobs = [];
  for (const id of search.job_snapshot_ids) jobs.push((await http.get(`/api/v1/job-snapshots/${id}`)).body);
  return { search, jobs };
}
