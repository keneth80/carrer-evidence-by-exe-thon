import test from 'node:test';
import assert from 'node:assert/strict';
import { MOCK_JOBS } from '../packages/search/src/mock-catalog.ts';
import { fixedDocumentIssues, similarity } from '../packages/apply/src/similarity.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { accept, current, say, startTailoring } from './helpers/s04-harness.mjs';
import { sha } from './helpers/s05-harness.mjs';
import { policyBody, runDiscover, seedApplication, startCampaign } from './helpers/s06-harness.mjs';

// S06: 고정 기준 → 유사 공고 탐색 → 조건·중복·사이트·문항 확인 → 추천/자동 준비(제출 없음) → 대기함.

async function setup(prefix, folderOverride) {
  const temp = folderOverride ? { folder: folderOverride, cleanup: () => {} } : tempFolder(prefix);
  const api = await startApi(temp.folder);
  const http = client(api, await login(api, 'alice'));
  return { api, http, folder: temp.folder, done: async (keep = false) => { await api.stop(); if (!keep) temp.cleanup(); } };
}
const count = (api, table) => api.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
const fixed = list => provider => ({ mode: 'mock', search: async () => ({ outcome: 'complete', jobs: list, failed_queries: 0 }) });

test('similarity explains role, level, skills and duties; fixed document checks seed company and seed-only phrases', () => {
  const [lumino, bridge, , , cloudpin] = MOCK_JOBS;
  const close = similarity(lumino, bridge);
  assert.ok(close.score >= 0.5);
  assert.deepEqual(close.reasons.map(reason => reason.kind), ['role', 'level', 'skills', 'duties']);
  assert.ok(close.shared_skills.includes('react'));
  assert.ok(similarity(lumino, cloudpin).score < 0.3, 'backend is not similar to frontend');
  const blocks = [
    { id: 'b1', section: '맞춤 요약', text: '브릿지워크 (합성) 시니어 프론트엔드 엔지니어 공고에 맞춰 Storybook·Next.js 경험을 강조합니다.', fact_ids: ['f1'] },
    { id: 'b2', section: '기술', text: 'React · TypeScript', fact_ids: ['f2'] },
  ];
  const issues = fixedDocumentIssues(blocks, bridge, lumino);
  assert.deepEqual(issues.map(issue => issue.code), ['SEED_COMPANY_IN_DOCUMENT', 'SEED_SPECIFIC_PHRASE', 'SEED_SPECIFIC_PHRASE']);
  assert.match(issues[2].message, /Next\.js/);
  assert.deepEqual(fixedDocumentIssues([blocks[1]], bridge, lumino), [], 'a neutral document passes');
});

test('prepare mode: seed stays fixed, similar jobs get documents and draft answers, nothing is submitted, results survive restart', async () => {
  const env = await setup('s06-prepare-');
  let keepFolder = null;
  try {
    const { api, http } = env;
    const seed = await seedApplication(api, http);
    const before = { authorizations: count(api, 'ce7_authorizations'), attempts: count(api, 'ce7_attempts'), receipts: count(api, 'demo_site_submissions'), observations: count(api, 'ce8_form_observations') };
    const run = await startCampaign(api, http, seed);
    assert.equal(run.result, 'succeeded');
    assert.equal(run.policy.mode, 'prepare');
    assert.match(run.policy.content_hash, /^[a-f0-9]{64}$/);
    assert.equal(run.control.state, 'active');
    const { queue } = run;
    assert.equal(queue.seed.application_id, seed.app.id);
    assert.equal(queue.seed.job.id, seed.prepared.job.id);
    assert.ok(queue.items.every(item => item.job.job_key !== seed.prepared.job.job_key), 'the seed job itself is not a candidate');
    const prepared = queue.items.filter(item => item.state === 'prepared');
    assert.ok(prepared.length >= 1, JSON.stringify(queue.items.map(item => [item.state, item.job.title])));
    for (const item of prepared) {
      assert.ok(item.evaluation.score >= 0.3);
      assert.ok(item.evaluation.reasons.some(reason => reason.kind === 'skills'));
      const history = (await http.get(`/api/v1/job-applications/${item.application_id}/history`)).body;
      assert.equal(history.application.submission_state, 'draft', 'prepared ≠ ready to submit');
      assert.deepEqual(history.application.current.answers.map(answer => answer.question_id).sort(), ['applicant_email', 'applicant_name'], 'only identity answers are reused');
      assert.ok(history.answer_issues.some(issue => issue.message.includes('지원 동기')));
      assert.ok(item.evaluation.needs.some(need => need.includes('직접 진행')));
      const resume = (await http.get(`/api/v1/resume-revisions/${history.revisions[0].resume_revision_id}`)).body;
      assert.equal(resume.state, 'final');
      assert.equal(resume.finalization_source, 'policy', 'policy finalization is not disguised as user review');
      assert.equal(resume.job_snapshot_id, item.job.id);
      const pdf = (await http.get(`/api/v1/artifacts/${item.evaluation.document.artifact_id}/content`, { raw: true })).body;
      assert.equal(sha(pdf), item.evaluation.document.artifact_sha256, 'a real PDF was rendered and stored');
    }
    assert.ok(queue.items.some(item => item.state === 'skipped' && item.evaluation.notes.some(note => note.includes('유사도'))), 'low similarity is skipped with a reason');
    // 준비 모드는 권한·시도·전송·폼 관측을 만들지 않는다.
    assert.deepEqual({ authorizations: count(api, 'ce7_authorizations'), attempts: count(api, 'ce7_attempts'), receipts: count(api, 'demo_site_submissions'), observations: count(api, 'ce8_form_observations') }, before);
    assert.equal(api.db.prepare("SELECT count(*) AS n FROM ce7_tasks WHERE kind = 'submit_application'").get().n, 0);
    // 다시 실행해도 기준은 그대로이고 같은 공고를 다시 넣지 않는다. 캠페인이 만든 지원 건을 기준으로 쓰지 않는다.
    const again = await http.post(`/api/v1/similar-job-campaigns/${run.campaign.id}/run`, { json: {} });
    assert.equal(again.status, 202);
    assert.equal(await runDiscover(api), 'succeeded');
    const rerun = (await http.get(`/api/v1/similar-job-campaigns/${run.campaign.id}`)).body;
    assert.equal(rerun.seed_application_id, seed.app.id);
    assert.equal(rerun.seed_job_snapshot_id, run.campaign.seed_job_snapshot_id);
    assert.equal(rerun.seed_resume_revision_id, run.campaign.seed_resume_revision_id);
    assert.equal(rerun.discovered_job_snapshot_ids.length, queue.items.length);
    assert.deepEqual([...rerun.application_ids].sort(), prepared.map(item => item.application_id).sort());
    // 캠페인이 만든 지원 건의 답변은 사용자가 이어서 작성할 수 있다.
    const target = (await http.get(`/api/v1/job-applications/${prepared[0].application_id}`)).body;
    const patched = await http.patch(`/api/v1/job-applications/${target.id}`, { json: { expected_revision: 1, job_snapshot_id: target.current.job_snapshot_id, resume_revision_id: target.current.resume_revision_id, artifact_id: target.current.artifact_id, answers: [...target.current.answers, { question_id: 'motivation', question_text: '지원 동기', answer: '직접 작성한 지원 동기', source: 'user_answer', source_ids: ['ua_motivation'] }] } });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    keepFolder = env.folder;
    await env.done(true);
    // 재시작 뒤에도 대기함·준비 결과가 남는다.
    const restarted = await setup('', keepFolder);
    try {
      const queue2 = (await restarted.http.get(`/api/v1/similar-job-campaigns/${run.campaign.id}/queue`)).body;
      assert.deepEqual(queue2.items.map(item => [item.job.id, item.state, item.application_id]), queue.items.map(item => [item.job.id, item.state, item.application_id]));
    } finally { await restarted.done(); }
  } finally { if (!keepFolder) await env.done(); }
});

test('unknown required condition goes to review; unsupported site, new required question and possible duplicate are not prepared', async () => {
  const { api, http, done } = await setup('s06-review-');
  try {
    const seed = await seedApplication(api, http);
    const salary = [{ field: 'annual_salary', operator: 'gte', values: [50000000], importance: 'required', currency: 'KRW' }];
    const run = await startCampaign(api, http, seed, { conditions: salary });
    const unknown = run.queue.items.filter(item => item.evaluation.conditions.some(cond => cond.importance === 'required' && cond.state === 'unknown') && item.evaluation.score >= 0.3);
    assert.ok(unknown.length >= 1);
    assert.ok(unknown.every(item => item.state === 'needs_review' && item.application_id === null), 'high similarity does not skip a required-condition check');
    assert.ok(run.queue.items.every(item => item.state !== 'prepared'));

    // 특수 후보: 지원 사이트 미지원, 새 필수 문항이 있는 공고, 회사·직무가 같은 외부 지원 기록.
    const base = MOCK_JOBS.find(job => job.job_key.endsWith('lumino-frontend'));
    const candidates = [
      { ...base, job_key: 'liner:999', site_id: 'liner', canonical_url: 'https://jobs.example.invalid/x', company_name: '다른사이트 (합성)' },
      { ...base, job_key: 'mock-job-board-v1:pixelhouse-designer', company_name: '픽셀하우스 (합성)' },
      { ...base, job_key: 'mock-job-board-v1:orbit-web-frontend', company_name: '오빗스튜디오 (합성)', title: '웹 프론트엔드 개발자' },
    ];
    await http.post('/api/v1/external-applications', { json: { job_snapshot_id: null, company_name: '오빗스튜디오', title: '웹 프론트엔드 개발자', channel: '다른 채용사이트', applied_on: '2026-11-01', note: '' } });
    // 특수 후보를 돌려주는 검색 결과로 새 캠페인을 탐색한다.
    const policy3 = await startCampaignWith(api, http, seed, candidates);
    const byKey = Object.fromEntries(policy3.items.map(item => [item.job.job_key, item]));
    assert.equal(byKey['liner:999'].state, 'needs_review');
    assert.ok(byKey['liner:999'].evaluation.needs.some(need => need.includes('지원하지 않는 지원 사이트')));
    assert.equal(byKey['mock-job-board-v1:pixelhouse-designer'].state, 'needs_review');
    assert.ok(byKey['mock-job-board-v1:pixelhouse-designer'].evaluation.needs.some(need => need.includes('포트폴리오 주소')));
    assert.equal(byKey['mock-job-board-v1:orbit-web-frontend'].state, 'needs_review');
    assert.equal(byKey['mock-job-board-v1:orbit-web-frontend'].evaluation.duplicate.kind, 'possible_same');
  } finally { await done(); }
});

async function startCampaignWith(api, http, seed, jobs) {
  const policy = (await http.post('/api/v1/auto-apply-policies', { json: policyBody(seed) })).body;
  const control = (await http.get(`/api/v1/auto-apply-policies/${policy.policy_id}`)).body;
  await http.post(`/api/v1/auto-apply-policies/${policy.policy_id}/activate`, { json: { revision_id: policy.id, expected_generation: control.generation, accepted_content_hash: policy.content_hash, consent: true } });
  const campaign = (await http.post('/api/v1/similar-job-campaigns', { json: { policy_revision_id: policy.id, seed_application_id: seed.app.id } })).body;
  await http.post(`/api/v1/similar-job-campaigns/${campaign.id}/run`, { json: {} });
  assert.equal(await runDiscover(api, { search: fixed(jobs)() }), 'succeeded');
  return (await http.get(`/api/v1/similar-job-campaigns/${campaign.id}/queue`)).body;
}

test('fixed document: the tailored seed PDF with seed-only phrases goes to review; a neutral seed PDF is reused as is; recommend mode prepares nothing', async () => {
  const { api, http, done } = await setup('s06-fixed-');
  try {
    // 기준 이력서를 공고에 맞춰 고친 뒤 확정(맞춤 요약 포함).
    const start = await startTailoring(api, http);
    const proposal = (await say(api, http, start.session.id, '이 공고에 맞춰 수정해줘')).proposal;
    await accept(http, proposal, (await current(http, start.session.id)).revision);
    const seed = await seedApplication(api, http, { start });
    const tailoredBlocks = (await http.get(`/api/v1/resume-revisions/${seed.prepared.revision.id}`)).body.blocks;
    assert.ok(tailoredBlocks.some(block => block.section === '맞춤 요약'));
    const run = await startCampaign(api, http, seed, { document_strategy: 'fixed_document', fixed_artifact_id: seed.prepared.artifact.id, allowed_edits: [] });
    const considered = run.queue.items.filter(item => item.state === 'needs_review' || item.state === 'prepared');
    assert.ok(considered.length >= 1);
    for (const item of considered) {
      if (item.state === 'prepared') assert.equal(item.evaluation.document.artifact_id, seed.prepared.artifact.id, 'fixed document reuses the same file');
      else assert.ok(item.evaluation.needs.some(need => /기준 공고|이 공고에 없는 기술/.test(need)), JSON.stringify(item.evaluation.needs));
    }

    const recommend = await startCampaignWith2(api, http, seed);
    assert.ok(recommend.items.length >= 1);
    assert.ok(recommend.items.every(item => item.application_id === null && item.state !== 'prepared'));
  } finally { await done(); }
});

async function startCampaignWith2(api, http, seed) {
  // 추천 모드: 지원 건이 이미 있는 공고는 중복으로 건너뛰므로, 새 사용자 상태에서도 같은 판단을 확인하도록 정책만 바꾼다.
  const run = await startCampaign(api, http, seed, { mode: 'recommend' });
  return run.queue;
}

test('policy lifecycle, ownership and cancellation: no run without active policy, revoked stays revoked, submit mode refused', async () => {
  const { api, http, done } = await setup('s06-policy-');
  try {
    const seed = await seedApplication(api, http);
    assert.equal((await http.post('/api/v1/auto-apply-policies', { json: policyBody(seed, { mode: 'submit' }) })).body.code, 'POLICY_MODE_NOT_IMPLEMENTED');
    assert.equal((await http.post('/api/v1/auto-apply-policies', { json: policyBody(seed, { fixed_artifact_id: seed.prepared.artifact.id }) })).status, 400, 'tailor mode cannot pin a file');
    assert.equal((await http.post('/api/v1/auto-apply-policies', { json: policyBody(seed, { account_binding_ids: ['binding_unknown'] }) })).body.code, 'ACCOUNT_BINDING_INVALID');
    const policy = (await http.post('/api/v1/auto-apply-policies', { json: policyBody(seed) })).body;
    const campaign = (await http.post('/api/v1/similar-job-campaigns', { json: { policy_revision_id: policy.id, seed_application_id: seed.app.id } })).body;
    assert.equal(campaign.state, 'draft');
    assert.equal((await http.post(`/api/v1/similar-job-campaigns/${campaign.id}/run`, { json: {} })).body.code, 'POLICY_NOT_ACTIVE');
    assert.equal((await http.post(`/api/v1/auto-apply-policies/${policy.policy_id}/activate`, { json: { revision_id: policy.id, expected_generation: 1, accepted_content_hash: '0'.repeat(64), consent: true } })).body.code, 'POLICY_CONTENT_CHANGED');
    assert.equal((await http.post(`/api/v1/auto-apply-policies/${policy.policy_id}/activate`, { json: { revision_id: policy.id, expected_generation: 9, accepted_content_hash: policy.content_hash, consent: true } })).body.code, 'POLICY_GENERATION_CONFLICT');
    const active = (await http.post(`/api/v1/auto-apply-policies/${policy.policy_id}/activate`, { json: { revision_id: policy.id, expected_generation: 1, accepted_content_hash: policy.content_hash, consent: true } })).body;
    assert.equal(active.generation, 2);

    // 다른 사용자는 정책·캠페인을 보거나 쓸 수 없다.
    const bob = client(api, await login(api, 'bob'));
    assert.equal((await bob.get(`/api/v1/similar-job-campaigns/${campaign.id}/queue`)).status, 404);
    assert.equal((await bob.get(`/api/v1/auto-apply-policies/${policy.policy_id}`)).status, 404);
    assert.equal((await bob.post('/api/v1/similar-job-campaigns', { json: { policy_revision_id: policy.id, seed_application_id: seed.app.id } })).status, 404);
    assert.equal((await bob.post(`/api/v1/similar-job-campaigns/${campaign.id}/run`, { json: {} })).status, 404);

    // 실행 예약 뒤 정책을 멈추면 그 작업은 실행되지 않는다.
    assert.equal((await http.post(`/api/v1/similar-job-campaigns/${campaign.id}/run`, { json: {} })).status, 202);
    const paused = (await http.post(`/api/v1/auto-apply-policies/${policy.policy_id}/pause`, { json: { expected_generation: 2 } })).body;
    assert.equal(paused.state, 'paused');
    assert.equal(await runDiscover(api), 'failed');
    assert.equal((await http.get(`/api/v1/similar-job-campaigns/${campaign.id}/queue`)).body.tasks[0].error_code, 'POLICY_NOT_ACTIVE');
    assert.equal((await http.post(`/api/v1/similar-job-campaigns/${campaign.id}/run`, { json: {} })).body.code, 'POLICY_NOT_ACTIVE');
    // 재활성화 → 실행 예약 → 캠페인 취소: 대기 작업은 실행되지 않고 다시 시작할 수 없다.
    await http.post(`/api/v1/auto-apply-policies/${policy.policy_id}/activate`, { json: { revision_id: policy.id, expected_generation: 3, accepted_content_hash: policy.content_hash, consent: true } });
    assert.equal((await http.post(`/api/v1/similar-job-campaigns/${campaign.id}/run`, { json: {} })).status, 202);
    assert.equal((await http.post(`/api/v1/similar-job-campaigns/${campaign.id}/cancel`, { json: {} })).body.state, 'canceled');
    assert.equal(await runDiscover(api), 'idle');
    assert.equal((await http.post(`/api/v1/similar-job-campaigns/${campaign.id}/run`, { json: {} })).body.code, 'CAMPAIGN_CLOSED');
    // 철회는 최종이다.
    const revoked = (await http.post(`/api/v1/auto-apply-policies/${policy.policy_id}/revoke`, { json: { expected_generation: 4 } })).body;
    assert.equal(revoked.state, 'revoked');
    assert.equal((await http.post(`/api/v1/auto-apply-policies/${policy.policy_id}/activate`, { json: { revision_id: policy.id, expected_generation: 5, accepted_content_hash: policy.content_hash, consent: true } })).body.code, 'POLICY_REVOKED');
    assert.equal((await http.post('/api/v1/auto-apply-policies', { json: policyBody(seed, { policy_id: policy.policy_id, expected_parent_revision_id: policy.id }) })).body.code, 'POLICY_REVOKED');
    assert.equal((await http.get('/api/v1/auto-apply-policies')).body.items.length, 1);
  } finally { await done(); }
});

test('review fixes: automatic results never become seeds, policy stop mid-run stops recording, limits count per policy and held jobs are re-evaluated', async () => {
  const { api, http, done } = await setup('s06-review-');
  try {
    const seed = await seedApplication(api, http);
    const first = await startCampaign(api, http, seed, { total_limit: 10, daily_limit: 1 });
    const preparedItems = first.queue.items.filter(item => item.state === 'prepared');
    const held = first.queue.items.filter(item => item.evaluation.held);
    assert.equal(preparedItems.length, 1, 'daily limit 1');
    assert.ok(held.length >= 1 && held.every(item => item.state === 'eligible' && item.application_id === null));
    // 자동 준비 지원 건·정책이 확정한 이력서는 기준이 될 수 없다.
    const auto = preparedItems[0];
    assert.equal((await http.post('/api/v1/similar-job-campaigns', { json: { policy_revision_id: first.policy.id, seed_application_id: auto.application_id } })).body.code, 'CAMPAIGN_SEED_NOT_ALLOWED');
    assert.equal((await http.post('/api/v1/auto-apply-policies', { json: policyBody(seed, { seed_resume_revision_id: auto.evaluation.document.resume_revision_id }) })).body.code, 'CAMPAIGN_SEED_NOT_ALLOWED');
    assert.equal((await http.get(`/api/v1/job-applications/${auto.application_id}/history`)).body.source.kind, 'campaign');
    // 다음 날 다시 찾으면 한도로 보류한 공고만 다시 판단해 준비한다(같은 정책 한도 안에서).
    assert.equal((await http.post(`/api/v1/similar-job-campaigns/${first.campaign.id}/run`, { json: {} })).status, 202);
    assert.equal(await runDiscover(api, { now: () => Date.now() + 86_400_000 }), 'succeeded');
    const nextDay = (await http.get(`/api/v1/similar-job-campaigns/${first.campaign.id}/queue`)).body;
    assert.equal(nextDay.items.filter(item => item.state === 'prepared').length, 2);
    assert.equal(nextDay.items.length, first.queue.items.length, 'no duplicate rows for re-evaluated jobs');
    // 같은 정책으로 만든 다른 캠페인도 정책 전체 한도를 함께 쓴다.
    const policy2 = (await http.post('/api/v1/auto-apply-policies', { json: policyBody(seed, { total_limit: 1 }) })).body;
    await http.post(`/api/v1/auto-apply-policies/${policy2.policy_id}/activate`, { json: { revision_id: policy2.id, expected_generation: 1, accepted_content_hash: policy2.content_hash, consent: true } });
    for (let i = 0; i < 2; i++) {
      const campaign = (await http.post('/api/v1/similar-job-campaigns', { json: { policy_revision_id: policy2.id, seed_application_id: seed.app.id } })).body;
      await http.post(`/api/v1/similar-job-campaigns/${campaign.id}/run`, { json: {} });
      const others = MOCK_JOBS.filter(job => /프론트엔드/.test(job.title) && job.job_key !== seed.prepared.job.job_key).map((job, index) => ({ ...job, job_key: `mock-job-board-v1:${job.job_key.split(':')[1]}`, canonical_url: `https://jobs.example.invalid/x${i}${index}` }));
      // 이미 지원 건이 있는 공고는 건너뛰므로 아직 없는 공고만 남긴다.
      const fresh = [];
      for (const job of others) if (!api.db.prepare('SELECT 1 FROM ce7_applications WHERE job_key = ?').get(job.job_key)) fresh.push(job);
      assert.equal(await runDiscover(api, { search: fixed(fresh)() }), 'succeeded');
    }
    const counted = api.db.prepare("SELECT count(*) AS n FROM ce7_campaign_jobs c JOIN ce7_campaigns k ON k.id = c.campaign_id WHERE k.policy_revision_id = ? AND c.state = 'prepared'").get(policy2.id).n;
    assert.ok(counted <= 1, 'total limit is per policy, not per campaign');

    // 실행 도중 정책을 멈추면 남은 후보를 기록하지 않는다.
    const policy3 = (await http.post('/api/v1/auto-apply-policies', { json: policyBody(seed) })).body;
    await http.post(`/api/v1/auto-apply-policies/${policy3.policy_id}/activate`, { json: { revision_id: policy3.id, expected_generation: 1, accepted_content_hash: policy3.content_hash, consent: true } });
    const campaign3 = (await http.post('/api/v1/similar-job-campaigns', { json: { policy_revision_id: policy3.id, seed_application_id: seed.app.id } })).body;
    await http.post(`/api/v1/similar-job-campaigns/${campaign3.id}/run`, { json: {} });
    const pausing = { mode: 'mock', search: async () => { await http.post(`/api/v1/auto-apply-policies/${policy3.policy_id}/pause`, { json: { expected_generation: 2 } }); return { outcome: 'complete', jobs: MOCK_JOBS.slice(0, 4), failed_queries: 0 }; } };
    assert.equal(await runDiscover(api, { search: pausing }), 'canceled');
    assert.equal((await http.get(`/api/v1/similar-job-campaigns/${campaign3.id}/queue`)).body.items.length, 0);
  } finally { await done(); }
});
