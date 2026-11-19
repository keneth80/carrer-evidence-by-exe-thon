import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openDatabase } from '../packages/db/src/index.ts';
import { SearchProviderError } from '../packages/search/src/provider.ts';
import { claimSearchTask, executeSearchClaim, heartbeat, MAX_SEARCH_ATTEMPTS, runSearchTask } from '../apps/worker/src/search-task.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { confirmFixture, createSearch, jobsOf, workerDeps } from './helpers/s02-harness.mjs';

// S02: 확정 경력 → SearchIntent → 영속 검색 작업(worker) → JobSnapshot. 실제 HTTP socket과 임시 DB를 사용한다.

const remoteOrHybrid = { field: 'work_mode', operator: 'any_of', values: ['remote', 'hybrid'], importance: 'required', currency: null };

test('different confirmed resumes produce different search plans and jobs through a separate worker connection', async () => {
  const { folder, cleanup } = tempFolder('s02-flow-');
  const api = await startApi(folder);
  const workerDb = openDatabase(join(folder, 'app.sqlite'));
  try {
    const http = client(api, await login(api, 'alice'));
    const front = await confirmFixture(api, http, 'frontend');
    const back = await confirmFixture(api, http, 'backend');
    const frontSearch = await createSearch(http, front.revision.id, [remoteOrHybrid]);
    const backSearch = await createSearch(http, back.revision.id, []);

    const frontQueries = frontSearch.intent.queries.map(item => item.query).join(' | ');
    const backQueries = backSearch.intent.queries.map(item => item.query).join(' | ');
    assert.match(frontQueries, /React/); assert.match(frontQueries, /TypeScript/); assert.match(frontQueries, /프론트엔드/);
    assert.match(backQueries, /Python/); assert.match(backQueries, /FastAPI/); assert.match(backQueries, /백엔드/);
    assert.doesNotMatch(frontQueries, /Python|백엔드/); assert.doesNotMatch(backQueries, /React|프론트엔드/);
    for (const text of [frontQueries, backQueries]) assert.doesNotMatch(text, /@|example\.com|가상 지원자/, 'contact and name never reach queries');
    const frontFactIds = new Set(front.revision.facts.map(fact => fact.id));
    assert.ok(frontSearch.intent.queries.every(item => item.fact_ids.every(id => frontFactIds.has(id))), 'query evidence stays inside the fact revision');
    assert.equal(frontSearch.intent.fact_revision_id, front.revision.id);
    assert.deepEqual(frontSearch.intent.conditions, [remoteOrHybrid]);

    assert.equal(frontSearch.accepted.task.state, 'queued');
    assert.equal(frontSearch.accepted.task.kind, 'search_jobs');
    assert.deepEqual(frontSearch.accepted.task.input_revision_ids, [front.revision.id, frontSearch.intent.id]);
    assert.equal((await http.get(`/api/v1/resume-searches/${frontSearch.searchId}`)).body.state, 'queued', 'API stores the task; it does not run the provider');

    const deps = workerDeps(api, { db: workerDb });
    assert.equal(await runSearchTask(deps), 'succeeded');
    assert.equal(await runSearchTask(deps), 'succeeded');
    assert.equal(await runSearchTask(deps), 'idle');

    const frontResult = await jobsOf(http, frontSearch.searchId);
    const backResult = await jobsOf(http, backSearch.searchId);
    assert.equal(frontResult.search.state, 'succeeded');
    assert.equal(frontResult.search.outcome, 'complete');
    assert.equal(frontResult.search.provider_mode, 'mock');
    const frontTitles = frontResult.jobs.map(job => job.title);
    const backTitles = backResult.jobs.map(job => job.title);
    assert.ok(frontTitles.length > 0 && backTitles.length > 0);
    assert.notDeepEqual(frontTitles, backTitles);
    assert.ok(frontTitles.some(title => /프론트엔드/.test(title)) && !frontTitles.some(title => /^백엔드/.test(title)));
    assert.ok(backTitles.some(title => /백엔드|서버/.test(title)));
    assert.ok(frontResult.jobs.every(job => job.data_origin === 'synthetic' && /^[a-f0-9]{64}$/.test(job.content_hash)));
    assert.ok(frontResult.jobs.every(job => !/사무실 출근/.test(job.content_text)), 'required work mode excludes onsite jobs');

    const task = (await http.get(`/api/v1/product-tasks/${frontSearch.taskId}`)).body;
    assert.equal(task.state, 'succeeded');
    assert.equal(task.provider_transmission, 'completed');
    assert.deepEqual(task.result_ids, [frontSearch.searchId]);
    assert.equal((await http.get(`/api/v1/search-intents/${frontSearch.intent.id}`)).body.content_hash, frontSearch.intent.content_hash);
  } finally {
    workerDb.close();
    await api.stop();
    cleanup();
  }
});

test('search requires a confirmed and current fact revision; old results stay readable', async () => {
  const { folder, cleanup } = tempFolder('s02-confirm-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const pdf = (await import('node:fs')).readFileSync(new URL('../fixtures/resumes/frontend.synthetic.pdf', import.meta.url));
    const pending = await http.upload('/api/v1/resume-documents', pdf, 'frontend.synthetic.pdf');
    await api.settle();
    const draft = (await http.get(`/api/v1/resume-documents/${pending.body.resource_id}/extraction`)).body;
    for (const id of [draft.id, pending.body.resource_id, 'facts_missing']) {
      const refused = await http.post('/api/v1/search-intents', { json: { fact_revision_id: id, conditions: [] } });
      assert.equal(refused.status, 404, 'unconfirmed extraction/document is not a search basis');
      assert.equal(refused.body.code, 'FACT_REVISION_NOT_FOUND');
    }
    const v1 = (await http.post(`/api/v1/resume-documents/${pending.body.resource_id}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: null, facts: draft.facts } })).body;
    const old = await createSearch(http, v1.id);
    assert.equal(await runSearchTask(workerDeps(api)), 'succeeded');
    const before = await jobsOf(http, old.searchId);

    const skillsOnly = draft.facts.filter(fact => fact.category === 'skill' && fact.statement === 'React');
    const v2 = (await http.post(`/api/v1/resume-documents/${pending.body.resource_id}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: v1.id, facts: skillsOnly } })).body;
    const stale = await http.post('/api/v1/search-intents', { json: { fact_revision_id: v1.id, conditions: [] } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'FACT_REVISION_NOT_CURRENT');
    assert.equal(stale.body.details.current_revision_id, v2.id);
    const fresh = await createSearch(http, v2.id);
    assert.deepEqual(fresh.intent.queries.map(item => item.query), ['React']);
    assert.equal(await runSearchTask(workerDeps(api)), 'succeeded');
    assert.deepEqual(await jobsOf(http, old.searchId), before, 'a newer search never overwrites an older one');

    const noRoleOrSkill = draft.facts.filter(fact => fact.category === 'responsibility').slice(0, 1);
    const v3 = (await http.post(`/api/v1/resume-documents/${pending.body.resource_id}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: v2.id, facts: noRoleOrSkill } })).body;
    const unsearchable = await http.post('/api/v1/search-intents', { json: { fact_revision_id: v3.id, conditions: [] } });
    assert.equal(unsearchable.status, 422);
    assert.equal(unsearchable.body.code, 'NO_SEARCHABLE_FACTS');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('contact lines confirmed by the user are still excluded; bad conditions and requests are rejected', async () => {
  const { folder, cleanup } = tempFolder('s02-privacy-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const pasted = await http.post('/api/v1/resume-documents/text', { json: { filename: 'pii.txt', text: '데이터 엔지니어\n연락처: data@example.com\n\n사용 기술\nPython, SQL' } });
    await api.settle();
    const documentId = pasted.body.resource_id;
    const draft = (await http.get(`/api/v1/resume-documents/${documentId}/extraction`)).body;
    const source = (await http.get(`/api/v1/resume-documents/${documentId}/source-text`)).body;
    const text = source.pages[0].text;
    const start = Array.from(text.slice(0, text.indexOf('연락처'))).length;
    const quote = '연락처: data@example.com';
    const contactFact = { id: 'fact_contact', category: 'role', statement: quote, evidence: [{ kind: 'document', document_id: documentId, page: null, start, end: start + Array.from(quote).length, quote }] };
    const confirmed = await http.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: null, facts: [...draft.facts, contactFact] } });
    assert.equal(confirmed.status, 201);
    const intent = await http.post('/api/v1/search-intents', { json: { fact_revision_id: confirmed.body.id, conditions: [] } });
    assert.equal(intent.status, 201);
    assert.ok(intent.body.queries.every(item => !item.query.includes('@') && !item.fact_ids.includes('fact_contact')));
    assert.match(intent.body.queries[0].query, /데이터 엔지니어 Python SQL/);

    const phone = await http.post('/api/v1/search-intents', { json: { fact_revision_id: confirmed.body.id, conditions: [{ field: 'location', operator: 'any_of', values: ['010-1234-5678'], importance: 'preferred', currency: null }] } });
    assert.equal(phone.status, 422);
    assert.equal(phone.body.code, 'CONDITION_CONTAINS_PERSONAL_INFO');
    assert.equal((await http.post('/api/v1/search-intents', { json: { fact_revision_id: confirmed.body.id } })).status, 400);
    assert.equal((await http.post('/api/v1/search-intents', { json: { fact_revision_id: confirmed.body.id, conditions: [], workspace_id: 'other' } })).status, 400, 'client cannot pick the workspace');
    for (const max of [0, 11, 1.5, '5']) assert.equal((await http.post('/api/v1/resume-searches', { json: { intent_id: intent.body.id, max_candidates: max } })).status, 400);
    assert.equal((await http.post('/api/v1/resume-searches', { json: { intent_id: 'intent_missing', max_candidates: 5 } })).status, 404);
  } finally {
    await api.stop();
    cleanup();
  }
});

test('another user cannot read or act on searches, intents, tasks or jobs', async () => {
  const { folder, cleanup } = tempFolder('s02-owner-');
  const api = await startApi(folder);
  try {
    const alice = client(api, await login(api, 'alice'));
    const bob = client(api, await login(api, 'bob'));
    const front = await confirmFixture(api, alice, 'frontend');
    const search = await createSearch(alice, front.revision.id);
    assert.equal(await runSearchTask(workerDeps(api)), 'succeeded');
    const { jobs } = await jobsOf(alice, search.searchId);
    assert.equal((await bob.get(`/api/v1/search-intents/${search.intent.id}`)).status, 404);
    assert.equal((await bob.get(`/api/v1/resume-searches/${search.searchId}`)).status, 404);
    assert.equal((await bob.get(`/api/v1/product-tasks/${search.taskId}`)).status, 404);
    assert.equal((await bob.get(`/api/v1/job-snapshots/${jobs[0].id}`)).status, 404);
    assert.equal((await bob.post('/api/v1/search-intents', { json: { fact_revision_id: front.revision.id, conditions: [] } })).status, 404);
    assert.equal((await bob.post('/api/v1/resume-searches', { json: { intent_id: search.intent.id, max_candidates: 5 } })).status, 404);
    assert.equal((await bob.post(`/api/v1/product-tasks/${search.taskId}/cancel`)).status, 404);
    const anonymous = client(api, null);
    assert.equal((await anonymous.get(`/api/v1/resume-searches/${search.searchId}`)).status, 401);
    const noCsrf = await alice.post('/api/v1/resume-searches', { json: { intent_id: search.intent.id, max_candidates: 5 }, headers: { 'X-CSRF-Token': 'f'.repeat(64) } });
    assert.equal(noCsrf.status, 403);
  } finally {
    await api.stop();
    cleanup();
  }
});

test('idempotent search creation: replay returns the same task, a changed body with the same key is rejected', async () => {
  const { folder, cleanup } = tempFolder('s02-idem-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const front = await confirmFixture(api, http, 'frontend');
    const intentA = await http.post('/api/v1/search-intents', { key: 'intent-key-0001', json: { fact_revision_id: front.revision.id, conditions: [] } });
    const intentB = await http.post('/api/v1/search-intents', { key: 'intent-key-0001', json: { fact_revision_id: front.revision.id, conditions: [] } });
    assert.equal(intentB.body.id, intentA.body.id);
    assert.equal(intentB.headers.get('idempotent-replay'), 'true');
    const first = await http.post('/api/v1/resume-searches', { key: 'search-key-0001', json: { intent_id: intentA.body.id, max_candidates: 5 } });
    const again = await http.post('/api/v1/resume-searches', { key: 'search-key-0001', json: { intent_id: intentA.body.id, max_candidates: 5 } });
    assert.equal(again.status, 202);
    assert.equal(again.body.resource_id, first.body.resource_id);
    const changed = await http.post('/api/v1/resume-searches', { key: 'search-key-0001', json: { intent_id: intentA.body.id, max_candidates: 6 } });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(api.db.prepare("SELECT count(*) AS n FROM ce7_tasks WHERE kind = 'search_jobs'").get().n, 1);
  } finally {
    await api.stop();
    cleanup();
  }
});

test('expired lease is reclaimed by another worker and the late original result is discarded', async () => {
  const { folder, cleanup } = tempFolder('s02-lease-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const front = await confirmFixture(api, http, 'frontend');
    const search = await createSearch(http, front.revision.id);
    let clock = Date.now();
    const now = () => clock;
    const late = workerDeps(api, { owner: 'worker-late', leaseMs: 1_000, now, beforeComplete: async () => {
      // 원래 worker가 provider 호출 뒤 멈춘 사이 lease가 끝나고 다른 worker가 같은 작업을 끝낸다.
      clock += 5_000;
      assert.equal(await runSearchTask(workerDeps(api, { owner: 'worker-new', leaseMs: 1_000, now }), search.taskId), 'succeeded');
    } });
    assert.equal(await runSearchTask(late, search.taskId), 'lease_lost');
    const task = api.db.prepare('SELECT state, lease_generation FROM ce7_tasks WHERE id = ?').get(search.taskId);
    assert.equal(task.state, 'succeeded');
    assert.equal(task.lease_generation, 2);
    const slots = api.db.prepare('SELECT count(*) AS n FROM ce7_search_results WHERE search_run_id = ?').get(search.searchId).n;
    assert.equal(slots, (await jobsOf(http, search.searchId)).jobs.length, 'only one result set is stored');
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM ce7_job_snapshots').get().n, slots, 'the late worker wrote no extra job snapshots');

    // heartbeat는 lease를 가진 실행만 연장한다.
    const other = await createSearch(http, front.revision.id);
    const holder = workerDeps(api, { owner: 'worker-holder', leaseMs: 1_000, now });
    const claim = claimSearchTask(holder, other.taskId);
    assert.equal(heartbeat(holder, claim), true);
    assert.equal(heartbeat({ ...holder, owner: 'intruder' }, claim), false);
    clock += 5_000;
    assert.equal(heartbeat(holder, claim), false, 'expired lease cannot be revived');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('a new worker picks up queued and expired-lease tasks, results survive API restart, and attempts are capped', async () => {
  const { folder, cleanup } = tempFolder('s02-restart-');
  let api = await startApi(folder);
  try {
    let user = await login(api, 'alice');
    let http = client(api, user);
    const front = await confirmFixture(api, http, 'frontend');
    const search = await createSearch(http, front.revision.id);
    // 첫 worker가 claim 후 종료(결과 저장 없음)된 상황.
    let clock = Date.now();
    claimSearchTask(workerDeps(api, { owner: 'crashed', leaseMs: 1_000, now: () => clock }));
    assert.equal(await runSearchTask(workerDeps(api, { now: () => clock })), 'idle', 'live lease is not stolen');
    clock += 2_000;
    assert.equal(await runSearchTask(workerDeps(api, { now: () => clock })), 'succeeded');
    const before = await jobsOf(http, search.searchId);
    // worker가 없는 동안 쌓인 queued 작업은 새 worker(새 owner)가 처음 집는다.
    const waiting = await createSearch(http, front.revision.id);
    assert.equal(api.db.prepare('SELECT state FROM ce7_tasks WHERE id = ?').get(waiting.taskId).state, 'queued');
    assert.equal(await runSearchTask(workerDeps(api, { owner: 'restarted-worker', now: () => clock })), 'succeeded');
    assert.equal((await http.get(`/api/v1/resume-searches/${waiting.searchId}`)).body.state, 'succeeded');
    await api.stop();

    api = await startApi(folder);
    user = await login(api, 'alice');
    http = client(api, user);
    assert.deepEqual(await jobsOf(http, search.searchId), before, 'search and job snapshots are re-read after restart');

    const capped = await createSearch(http, front.revision.id);
    for (let attempt = 0; attempt < MAX_SEARCH_ATTEMPTS; attempt++) {
      claimSearchTask(workerDeps(api, { owner: `crash-${attempt}`, leaseMs: 1_000, now: () => clock }), capped.taskId);
      clock += 2_000;
    }
    assert.equal(await runSearchTask(workerDeps(api, { now: () => clock }), capped.taskId), 'failed');
    const task = (await http.get(`/api/v1/product-tasks/${capped.taskId}`)).body;
    assert.equal(task.state, 'failed');
    assert.equal(task.error_code, 'SEARCH_ATTEMPTS_EXCEEDED');
    assert.equal((await http.get(`/api/v1/resume-searches/${capped.searchId}`)).body.state, 'failed');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('cancel stops queued work, discards results of running work, and refuses finished work', async () => {
  const { folder, cleanup } = tempFolder('s02-cancel-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const front = await confirmFixture(api, http, 'frontend');
    const queued = await createSearch(http, front.revision.id);
    const canceled = await http.post(`/api/v1/product-tasks/${queued.taskId}/cancel`);
    assert.equal(canceled.status, 200);
    assert.equal(canceled.body.state, 'canceled');
    assert.equal(canceled.body.cancel_requested, true);
    assert.equal(await runSearchTask(workerDeps(api)), 'idle');
    assert.equal((await http.get(`/api/v1/resume-searches/${queued.searchId}`)).body.state, 'canceled');
    assert.equal((await http.post(`/api/v1/product-tasks/${queued.taskId}/cancel`)).status, 409);

    const running = await createSearch(http, front.revision.id);
    const deps = workerDeps(api, { beforeComplete: async () => {
      const response = await http.post(`/api/v1/product-tasks/${running.taskId}/cancel`);
      assert.equal(response.body.state, 'running', 'running task only records the request');
    } });
    assert.equal(await runSearchTask(deps), 'canceled');
    const result = await jobsOf(http, running.searchId);
    assert.equal(result.search.state, 'canceled');
    assert.deepEqual(result.search.job_snapshot_ids, []);

    const extractTask = api.db.prepare("SELECT id FROM ce7_tasks WHERE kind = 'extract_resume' LIMIT 1").get().id;
    assert.equal((await http.post(`/api/v1/product-tasks/${extractTask}/cancel`)).body.code, 'TASK_NOT_CANCELABLE');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('empty results and provider failures are stored as such, live transmission doubt is never retried', async () => {
  const { folder, cleanup } = tempFolder('s02-outcome-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const pasted = await http.post('/api/v1/resume-documents/text', { json: { filename: 'legacy.txt', text: '사용 기술\nCOBOL, JCL' } });
    await api.settle();
    const draft = (await http.get(`/api/v1/resume-documents/${pasted.body.resource_id}/extraction`)).body;
    const revision = (await http.post(`/api/v1/resume-documents/${pasted.body.resource_id}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: null, facts: draft.facts } })).body;
    const empty = await createSearch(http, revision.id);
    assert.equal(await runSearchTask(workerDeps(api)), 'succeeded');
    const emptyRun = (await http.get(`/api/v1/resume-searches/${empty.searchId}`)).body;
    assert.equal(emptyRun.outcome, 'empty');
    assert.deepEqual(emptyRun.job_snapshot_ids, []);

    const failing = await createSearch(http, revision.id);
    const broken = { mode: 'mock', search: async () => { throw new SearchProviderError('MOCK_DOWN', 'down'); } };
    assert.equal(await runSearchTask(workerDeps(api, { provider: broken })), 'failed');
    const failedTask = (await http.get(`/api/v1/product-tasks/${failing.taskId}`)).body;
    assert.equal(failedTask.error_code, 'MOCK_DOWN');
    assert.equal(failedTask.provider_transmission, 'completed');

    let calls = 0;
    const live = { mode: 'live', search: async () => { calls++; throw new Error('socket reset'); } };
    // live 설정 API가 만든 작업을 흉내 낸다(현재 API는 mock만 허용).
    const asLive = taskId => api.db.prepare("UPDATE ce7_tasks SET input_json = json_set(input_json, '$.provider_mode', 'live') WHERE id = ?").run(taskId);
    const mismatch = await createSearch(http, revision.id);
    assert.equal(await runSearchTask(workerDeps(api, { provider: live }), mismatch.taskId), 'failed');
    assert.equal((await http.get(`/api/v1/product-tasks/${mismatch.taskId}`)).body.error_code, 'PROVIDER_MODE_MISMATCH', 'a mock task never runs on a live worker');
    assert.equal(calls, 0);
    const unknown = await createSearch(http, revision.id);
    asLive(unknown.taskId);
    assert.equal(await runSearchTask(workerDeps(api, { provider: live })), 'failed');
    assert.equal((await http.get(`/api/v1/product-tasks/${unknown.taskId}`)).body.provider_transmission, 'unknown');

    const crashed = await createSearch(http, revision.id);
    asLive(crashed.taskId);
    api.db.prepare("UPDATE ce7_tasks SET provider_transmission = 'dispatched' WHERE id = ?").run(crashed.taskId);
    calls = 0;
    assert.equal(await runSearchTask(workerDeps(api, { provider: live }), crashed.taskId), 'failed');
    assert.equal(calls, 0, 'a possibly-sent live request is not sent again');
    const crashedTask = (await http.get(`/api/v1/product-tasks/${crashed.taskId}`)).body;
    assert.equal(crashedTask.error_code, 'PROVIDER_TRANSMISSION_UNKNOWN');
    assert.equal(crashedTask.provider_transmission, 'unknown');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('cancel races: before dispatch no request is sent, abandoned running cancel is finalized, finished work refuses cancel', async () => {
  const { folder, cleanup } = tempFolder('s02-cancel-race-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const front = await confirmFixture(api, http, 'frontend');
    let calls = 0;
    const counting = { mode: 'mock', search: async () => { calls++; return { outcome: 'empty', jobs: [], failed_queries: 0 }; } };

    // claim 직후, 전송 전에 중지 요청이 끼어든 경우: provider를 부르지 않는다.
    const early = await createSearch(http, front.revision.id);
    const deps = workerDeps(api, { provider: counting });
    const claim = claimSearchTask(deps, early.taskId);
    assert.equal((await http.post(`/api/v1/product-tasks/${early.taskId}/cancel`)).body.state, 'running');
    assert.equal(await executeSearchClaim(deps, claim), 'canceled');
    assert.equal(calls, 0, 'no new transmission after cancel');
    const earlyTask = (await http.get(`/api/v1/product-tasks/${early.taskId}`)).body;
    assert.equal(earlyTask.provider_transmission, 'not_dispatched');
    assert.deepEqual(earlyTask.result_ids, [], 'canceled tasks expose no result ids');

    // 전송 뒤 worker가 사라지고 lease가 끝난 중지 요청 작업: 다시 실행하지 않고 canceled + 전송 상태 unknown.
    const abandoned = await createSearch(http, front.revision.id);
    // 작업 생성 시각 이후로 시계를 잡아야 available_at 조건을 통과한다.
    let clock = Date.now();
    const gone = workerDeps(api, { owner: 'gone', leaseMs: 1_000, now: () => clock });
    assert.ok(claimSearchTask(gone, abandoned.taskId), 'the vanished worker held the lease');
    api.db.prepare("UPDATE ce7_tasks SET provider_transmission = 'dispatched' WHERE id = ?").run(abandoned.taskId);
    await http.post(`/api/v1/product-tasks/${abandoned.taskId}/cancel`);
    clock += 2_000;
    assert.equal(await runSearchTask(workerDeps(api, { provider: counting, now: () => clock })), 'idle');
    const abandonedTask = (await http.get(`/api/v1/product-tasks/${abandoned.taskId}`)).body;
    assert.equal(abandonedTask.state, 'canceled');
    assert.equal(abandonedTask.provider_transmission, 'unknown');
    assert.equal((await http.get(`/api/v1/resume-searches/${abandoned.searchId}`)).body.state, 'canceled');
    assert.equal(calls, 0);

    // 이미 끝난 검색은 중지할 수 없다.
    const finished = await createSearch(http, front.revision.id);
    assert.equal(await runSearchTask(workerDeps(api)), 'succeeded');
    const refused = await http.post(`/api/v1/product-tasks/${finished.taskId}/cancel`);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.details.state, 'succeeded');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('heartbeat extends the lease during a slow provider call and losing the lease aborts the call', async () => {
  const { folder, cleanup } = tempFolder('s02-heartbeat-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const front = await confirmFixture(api, http, 'frontend');
    const slow = await createSearch(http, front.revision.id);
    const leaseDuring = [];
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const slowProvider = { mode: 'mock', search: async () => {
      for (let i = 0; i < 4; i++) { await delay(150); leaseDuring.push(api.db.prepare('SELECT lease_until_ms FROM ce7_tasks WHERE id = ?').get(slow.taskId).lease_until_ms); }
      return { outcome: 'empty', jobs: [], failed_queries: 0 };
    } };
    assert.equal(await runSearchTask(workerDeps(api, { provider: slowProvider, leaseMs: 300 }), slow.taskId), 'succeeded', 'a 600ms call survives a 300ms lease');
    assert.ok(leaseDuring.at(-1) > leaseDuring[0], 'lease_until_ms moved forward while the provider was running');

    const stolen = await createSearch(http, front.revision.id);
    let aborted = false;
    const waiting = { mode: 'mock', search: ({ signal }) => new Promise((resolve, reject) => {
      // 다른 worker가 lease를 가져간 상황을 만든다.
      api.db.prepare("UPDATE ce7_tasks SET lease_owner = 'thief', lease_generation = lease_generation + 1 WHERE id = ?").run(stolen.taskId);
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
    }) };
    assert.equal(await runSearchTask(workerDeps(api, { provider: waiting, leaseMs: 300 }), stolen.taskId), 'lease_lost');
    assert.equal(aborted, true, 'provider call is aborted once the lease is gone');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('tampered intent, broken task input and searches on a superseded revision do not run', async () => {
  const { folder, cleanup } = tempFolder('s02-integrity-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const front = await confirmFixture(api, http, 'frontend');
    const tampered = await createSearch(http, front.revision.id);
    api.db.prepare("UPDATE ce7_tasks SET input_json = json_set(input_json, '$.intent_hash', ?) WHERE id = ?").run('0'.repeat(64), tampered.taskId);
    assert.equal(await runSearchTask(workerDeps(api), tampered.taskId), 'failed');
    assert.equal((await http.get(`/api/v1/product-tasks/${tampered.taskId}`)).body.error_code, 'SEARCH_INTENT_MISMATCH');

    const broken = await createSearch(http, front.revision.id);
    const after = await createSearch(http, front.revision.id);
    api.db.prepare("UPDATE ce7_tasks SET input_json = '{}' WHERE id = ?").run(broken.taskId);
    assert.equal(await runSearchTask(workerDeps(api)), 'idle', 'broken task is failed during claim');
    assert.equal((await http.get(`/api/v1/product-tasks/${broken.taskId}`)).body.error_code, 'TASK_INPUT_INVALID');
    assert.equal((await http.get(`/api/v1/resume-searches/${broken.searchId}`)).body.state, 'failed');
    assert.equal(await runSearchTask(workerDeps(api)), 'succeeded', 'the queue behind it keeps moving');
    assert.equal((await http.get(`/api/v1/resume-searches/${after.searchId}`)).body.state, 'succeeded');

    const draft = front.draft;
    const v2 = (await http.post(`/api/v1/resume-documents/${front.documentId}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: front.revision.id, facts: draft.facts.filter(fact => fact.category === 'skill') } })).body;
    const old = await http.post('/api/v1/resume-searches', { json: { intent_id: tampered.intent.id, max_candidates: 5 } });
    assert.equal(old.status, 409);
    assert.equal(old.body.code, 'FACT_REVISION_NOT_CURRENT');
    assert.equal(old.body.details.current_revision_id, v2.id);
  } finally {
    await api.stop();
    cleanup();
  }
});
