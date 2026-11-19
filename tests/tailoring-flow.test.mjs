import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { extractPdfTextIsolated } from '../packages/resume/src/pdf.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { glyphReport } from './helpers/pdf-glyphs.mjs';
import { accept, current, runRender, runTailor, say, startTailoring } from './helpers/s04-harness.mjs';

// S04: 공고 선택 → 편집 세션 → 대화(mock) → 변경 제안 → 수용/거절/부분 수용 → 확정 → 실제 PDF. 실제 HTTP + worker 함수.

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('conversation produces a proposal, acceptance creates a new revision, and older revisions stay unchanged', async () => {
  const { folder, cleanup } = tempFolder('s04-flow-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const start = await startTailoring(api, http);
    assert.equal(start.session.fact_revision_id, start.revision.id);
    assert.equal(start.session.job_snapshot_id, start.job.id);
    const r1 = (await current(http, start.session.id)).revision;
    assert.equal(r1.revision, 1);
    assert.equal(r1.state, 'draft');
    assert.ok(r1.blocks.every(block => block.fact_ids.length > 0));

    const first = await say(api, http, start.session.id, '이 공고에 맞춰 수정해줘');
    assert.equal(first.result, 'succeeded');
    const messages = (await http.get(`/api/v1/tailoring-sessions/${start.session.id}/messages`)).body;
    assert.deepEqual(messages.items.map(item => item.role), ['user', 'assistant']);
    assert.equal(messages.next_cursor, null);
    assert.equal(first.proposal.state, 'proposed');
    assert.equal(first.proposal.base_resume_revision_id, r1.id);
    const factIds = new Set(start.revision.facts.map(fact => fact.id));
    assert.ok(first.proposal.changes.every(change => change.fact_ids.every(id => factIds.has(id))));

    const accepted = await accept(http, first.proposal, r1);
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.revision, 2);
    assert.equal(accepted.body.parent_revision_id, r1.id);
    assert.ok(accepted.body.blocks.some(block => block.section === '맞춤 요약'));
    assert.equal((await current(http, start.session.id)).session.current_resume_revision_id, accepted.body.id);
    assert.deepEqual((await http.get(`/api/v1/resume-revisions/${r1.id}`)).body, r1, 'the base revision is immutable');
    const replay = await accept(http, first.proposal, r1);
    assert.equal(replay.status, 409, 'an accepted proposal cannot be applied again');

    // 부분 수용: 첫 번째 변경만 적용한다.
    const partial = await say(api, http, start.session.id, 'Storybook 경험을 강조해줘');
    assert.ok(partial.proposal.changes.length >= 2);
    const r3 = await accept(http, partial.proposal, accepted.body, { change_indexes: [0] });
    assert.equal(r3.status, 201);
    const touched = partial.proposal.changes[0].block_id;
    assert.equal(r3.body.blocks.find(block => block.id === touched).text, partial.proposal.changes[0].after);
    const second = partial.proposal.changes[1];
    if (second.operation === 'replace') assert.equal(r3.body.blocks.find(block => block.id === second.block_id).text, second.before, 'unselected change not applied');

    // 거절
    const rejectedCase = await say(api, http, start.session.id, 'Next.js 경험을 강조해줘');
    const rejected = await http.post(`/api/v1/edit-proposals/${rejectedCase.proposal.id}/reject`);
    assert.equal(rejected.body.state, 'rejected');
    assert.equal((await accept(http, rejectedCase.proposal, r3.body)).body.code, 'PROPOSAL_NOT_OPEN');

    // 되돌리기: r1 내용을 새 revision으로 복원하고 기록은 유지한다.
    const restored = await http.post(`/api/v1/tailoring-sessions/${start.session.id}/restore`, { json: { source_revision_id: r1.id, expected_resume_revision_id: r3.body.id } });
    assert.equal(restored.status, 201);
    assert.equal(restored.body.content_hash, r1.content_hash);
    assert.equal(restored.body.revision, 4);
    const history = (await http.get(`/api/v1/tailoring-sessions/${start.session.id}/revisions`)).body.items;
    assert.deepEqual(history.map(item => item.revision), [1, 2, 3, 4]);
  } finally {
    await api.stop();
    cleanup();
  }
});

test('stale proposals, late responses and concurrent edits never overwrite the latest revision', async () => {
  const { folder, cleanup } = tempFolder('s04-stale-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const start = await startTailoring(api, http);
    const r1 = (await current(http, start.session.id)).revision;
    const a = await say(api, http, start.session.id, '이 공고에 맞춰 수정해줘');
    const b = await say(api, http, start.session.id, 'Storybook 경험을 강조해줘');
    assert.equal(b.proposal.state, 'proposed');
    const r2 = (await accept(http, a.proposal, r1)).body;
    assert.equal((await http.get(`/api/v1/tailoring-sessions/${start.session.id}/proposals`)).body.items.find(item => item.id === b.proposal.id).state, 'stale', 'other open proposals become stale');
    const stale = await accept(http, b.proposal, r2);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'PROPOSAL_STALE');
    assert.equal((await current(http, start.session.id)).revision.id, r2.id);

    // 화면이 본 revision이 오래됐으면 메시지·수용을 거절한다.
    const oldView = await http.post(`/api/v1/tailoring-sessions/${start.session.id}/messages`, { json: { expected_resume_revision_id: r1.id, content: '맞춰줘' } });
    assert.equal(oldView.body.code, 'RESUME_REVISION_CONFLICT');

    // 늦은 응답: 응답을 만드는 동안 문서가 바뀌면 제안은 stale로 저장되고 현재 문서는 그대로다.
    const sent = await http.post(`/api/v1/tailoring-sessions/${start.session.id}/messages`, { json: { expected_resume_revision_id: r2.id, content: '[mock:slow] Next.js 경험을 강조해줘' } });
    assert.equal((await http.post(`/api/v1/tailoring-sessions/${start.session.id}/messages`, { json: { expected_resume_revision_id: r2.id, content: '하나 더' } })).body.code, 'RESPONSE_PENDING');
    let restoredId = null;
    const late = await runTailor(api, { beforeComplete: async () => {
      restoredId = (await http.post(`/api/v1/tailoring-sessions/${start.session.id}/restore`, { json: { source_revision_id: r1.id, expected_resume_revision_id: r2.id } })).body.id;
    } });
    assert.equal(late, 'succeeded');
    const task = (await http.get(`/api/v1/product-tasks/${sent.body.task.id}`)).body;
    const lateProposal = (await http.get(`/api/v1/tailoring-sessions/${start.session.id}/proposals`)).body.items.find(item => task.result_ids.includes(item.id));
    assert.equal(lateProposal.state, 'stale');
    assert.equal((await current(http, start.session.id)).revision.id, restoredId, 'late response did not overwrite');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('new facts: the AI asks, a user statement must be confirmed as a fact before it can enter the resume', async () => {
  const { folder, cleanup } = tempFolder('s04-facts-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const start = await startTailoring(api, http);
    const asked = await say(api, http, start.session.id, '리딩 경험을 더 드러내줘');
    assert.equal(asked.proposal, null, 'no document change without evidence');
    assert.equal((await current(http, start.session.id)).session.state, 'waiting_user');

    const statementText = '4명 팀의 프론트엔드 코드 리뷰를 리딩했어요.';
    const told = await say(api, http, start.session.id, statementText);
    const pendingChange = told.proposal.changes[0];
    assert.equal(pendingChange.needs_fact_confirmation, true);
    const r1 = (await current(http, start.session.id)).revision;
    const early = await accept(http, told.proposal, r1);
    assert.equal(early.status, 422);
    assert.equal(early.body.code, 'FACT_CONFIRMATION_REQUIRED');

    const messages = (await http.get(`/api/v1/tailoring-sessions/${start.session.id}/messages`)).body.items;
    const userMessage = messages.filter(item => item.role === 'user').at(-1);
    const assistantMessage = messages.filter(item => item.role === 'assistant').at(-1);
    const doc = (await http.get('/api/v1/resume-documents')).body.items.find(item => item.document.id === start.documentId);
    const head = (await http.get(`/api/v1/resume-fact-revisions/${doc.current_fact_revision_id}`)).body;
    const confirmWith = (messageId, quote) => http.post(`/api/v1/resume-documents/${start.documentId}/fact-revisions`, { json: {
      extraction_id: start.draft.id, expected_parent_revision_id: head.id,
      facts: [...head.facts, { id: 'fact_user_1', category: 'achievement', statement: quote, evidence: [{ kind: 'user_statement', message_id: messageId, confirmed_at: '2000-01-01T00:00:00Z', quote }] }],
    } });
    assert.equal((await confirmWith(assistantMessage.id, assistantMessage.content.slice(0, 10))).body.code, 'USER_STATEMENT_NOT_FOUND', 'assistant text is never a user statement');
    assert.equal((await confirmWith(userMessage.id, '8명 팀을 리딩했어요.')).body.code, 'EVIDENCE_QUOTE_MISMATCH', 'quote must come from the message');
    const confirmed = await confirmWith(userMessage.id, statementText);
    assert.equal(confirmed.status, 201);
    const evidence = confirmed.body.facts.find(item => item.id === 'fact_user_1').evidence[0];
    assert.notEqual(evidence.confirmed_at, '2000-01-01T00:00:00Z', 'server records the confirmation time');

    const applied = await accept(http, told.proposal, r1);
    assert.equal(applied.status, 201);
    assert.equal(applied.body.fact_revision_id, confirmed.body.id, 'the new revision pins the fact revision with the confirmed statement');
    const block = applied.body.blocks.find(item => item.text === statementText);
    assert.deepEqual(block.fact_ids, ['fact_user_1']);
    const finalized = await http.post(`/api/v1/resume-revisions/${applied.body.id}/finalize`, { json: { expected_content_hash: applied.body.content_hash, reviewed: true } });
    assert.equal(finalized.status, 200, 'confirmed statement passes the final evidence check');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('unsupported claims never reach the document; failures keep the message and can be retried', async () => {
  const { folder, cleanup } = tempFolder('s04-guard-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const start = await startTailoring(api, http);
    const r1 = (await current(http, start.session.id)).revision;
    const skills = r1.blocks.find(block => block.id === 'blk_skills');
    const inventing = { mode: 'mock', respond: async () => ({ reply: '수치를 넣었어요', questions: [], changes: [
      { operation: 'replace', block_id: 'blk_skills', before: skills.text, after: `${skills.text} · Kubernetes`, fact_ids: skills.fact_ids, reason: 'x', needs_fact_confirmation: false },
      { operation: 'insert', block_id: 'blk_claim', before: null, after: '대시보드 성능을 40% 개선한 리딩 경험', fact_ids: skills.fact_ids, reason: 'x', needs_fact_confirmation: false },
    ] }) };
    const screened = await say(api, http, start.session.id, '성과를 넣어줘', { provider: inventing });
    assert.equal(screened.proposal, null, 'no proposal saved when every change is unsupported');
    assert.equal(screened.task.state, 'succeeded');
    assert.equal((await current(http, start.session.id)).revision.id, r1.id);

    // DB에 직접 넣은 근거 없는 제안도 수용 시 다시 검사한다.
    api.db.prepare("INSERT INTO ce7_edit_proposals (id, workspace_id, session_id, base_resume_revision_id, base_content_hash, changes_json, questions_json, state, created_at_ms) VALUES ('proposal_forged', ?, ?, ?, ?, ?, '[]', 'proposed', ?)")
      .run(start.session.workspace_id, start.session.id, r1.id, r1.content_hash, JSON.stringify([{ operation: 'insert', block_id: 'blk_forged', before: null, after: '10년 경력의 팀장', fact_ids: skills.fact_ids, reason: 'x', needs_fact_confirmation: false }]), Date.now());
    const forged = await accept(http, { id: 'proposal_forged' }, r1);
    assert.equal(forged.status, 422);
    assert.equal(forged.body.code, 'CHANGE_NOT_SUPPORTED');

    const failed = await say(api, http, start.session.id, '[mock:fail] 이 공고에 맞춰줘');
    assert.equal(failed.task.state, 'failed');
    assert.equal(failed.task.error_code, 'MOCK_CHAT_FAILURE');
    const messages = (await http.get(`/api/v1/tailoring-sessions/${start.session.id}/messages`)).body.items;
    assert.equal(messages.at(-1).role, 'user', 'the user message is kept after a failure');
    const answered = messages.find(item => item.role === 'user');
    assert.equal((await http.post(`/api/v1/tailoring-sessions/${start.session.id}/messages/${answered.id}/retry`)).body.code, 'RETRY_NOT_LATEST', 'only the latest user message can be retried');
    assert.equal((await http.post(`/api/v1/tailoring-sessions/${start.session.id}/messages/${messages.at(-2).id}/retry`)).body.code, 'MESSAGE_NOT_FOUND', 'assistant messages are not retryable');
    const retry = await http.post(`/api/v1/tailoring-sessions/${start.session.id}/messages/${failed.sent.resource_id}/retry`);
    assert.equal(retry.status, 202);
    const working = { mode: 'mock', respond: async () => ({ reply: '다시 만들었어요', questions: [], changes: [] }) };
    assert.equal(await runTailor(api, { provider: working }), 'succeeded');
    assert.equal((await http.get(`/api/v1/tailoring-sessions/${start.session.id}/messages`)).body.items.at(-1).content, '다시 만들었어요');
    assert.equal(await runTailor(api, { provider: { mode: 'live', respond: async () => ({ reply: 'x', questions: [], changes: [] }) } }), 'idle');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('finalize checks hash, evidence and other company names; the PDF is real, hashed, Korean and reproducible', async () => {
  const { folder, cleanup } = tempFolder('s04-pdf-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const start = await startTailoring(api, http);
    const r1 = (await current(http, start.session.id)).revision;
    const r2 = (await accept(http, (await say(api, http, start.session.id, '이 공고에 맞춰 수정해줘')).proposal, r1)).body;
    assert.equal((await http.post('/api/v1/artifacts', { json: { resume_revision_id: r2.id } })).body.code, 'RESUME_NOT_FINAL');
    assert.equal((await http.post(`/api/v1/resume-revisions/${r2.id}/finalize`, { json: { expected_content_hash: r2.content_hash, reviewed: false } })).status, 400);
    assert.equal((await http.post(`/api/v1/resume-revisions/${r2.id}/finalize`, { json: { expected_content_hash: r1.content_hash, reviewed: true } })).body.code, 'CONTENT_HASH_MISMATCH');
    assert.equal((await http.post(`/api/v1/resume-revisions/${r1.id}/finalize`, { json: { expected_content_hash: r1.content_hash, reviewed: true } })).body.code, 'RESUME_REVISION_CONFLICT');

    // 다른 공고의 회사 이름이 남은 문서는 확정하지 않는다.
    const other = start.jobs.find(job => job.company_name !== start.job.company_name);
    const leaked = r2.blocks.map(block => block.section === '맞춤 요약' ? { ...block, text: `${block.text} · ${other.company_name.replace(' (합성)', '')} 지원` } : block);
    api.db.prepare(`INSERT INTO ce7_resume_revisions (id, workspace_id, session_id, job_snapshot_id, fact_revision_id, revision, parent_revision_id, blocks_json, content_hash, state, finalized_at_ms, finalization_source, created_at_ms)
      VALUES ('resume_leak', ?, ?, ?, ?, 99, ?, ?, ?, 'draft', NULL, NULL, ?)`).run(r2.workspace_id, r2.session_id, r2.job_snapshot_id, r2.fact_revision_id, r2.id, JSON.stringify(leaked), 'a'.repeat(64), Date.now());
    api.db.prepare("UPDATE ce7_tailoring_sessions SET current_resume_revision_id = 'resume_leak' WHERE id = ?").run(start.session.id);
    const leak = await http.post('/api/v1/resume-revisions/resume_leak/finalize', { json: { expected_content_hash: 'a'.repeat(64), reviewed: true } });
    assert.equal(leak.body.code, 'RESUME_MENTIONS_OTHER_COMPANY');
    api.db.prepare('UPDATE ce7_tailoring_sessions SET current_resume_revision_id = ? WHERE id = ?').run(r2.id, start.session.id);

    const final = await http.post(`/api/v1/resume-revisions/${r2.id}/finalize`, { json: { expected_content_hash: r2.content_hash, reviewed: true } });
    assert.equal(final.status, 200);
    assert.equal(final.body.state, 'final');
    assert.equal(final.body.finalization_source, 'user');
    assert.equal((await current(http, start.session.id)).session.state, 'ready');
    assert.throws(() => api.db.prepare("UPDATE ce7_resume_revisions SET blocks_json = '[]' WHERE id = ?").run(r2.id), 'final revision is frozen');

    const render = await http.post('/api/v1/artifacts', { json: { resume_revision_id: r2.id } });
    assert.equal(render.status, 202);
    assert.equal(render.body.resource_id, r2.id);
    assert.equal(await runRender(api), 'succeeded');
    const task = (await http.get(`/api/v1/product-tasks/${render.body.task.id}`)).body;
    const artifactId = task.result_ids[0];
    const meta = (await http.get(`/api/v1/artifacts/${artifactId}`)).body;
    assert.equal(meta.download_path, `/api/v1/artifacts/${artifactId}/content`);
    assert.match(meta.filename, /^이력서_.+_v2\.pdf$/);
    const content = await http.get(meta.download_path, { raw: true });
    assert.equal(content.headers.get('content-type'), 'application/pdf');
    assert.equal(sha(content.body), meta.sha256);
    assert.equal(content.body.length, meta.byte_size);
    assert.equal(content.headers.get('x-pdf-page-count'), '1');
    const text = await extractPdfTextIsolated(content.body);
    const joined = text.pages.map(page => page.text).join('\n').replace(/\s+/g, '');
    for (const block of final.body.blocks) assert.ok(joined.includes(block.text.replace(/\s+/g, '')), `PDF has: ${block.text}`);
    assert.deepEqual(glyphReport(content.body).missing, [], 'served PDF draws visible glyphs for every character');
    assert.equal((await http.get(`/api/v1/resume-revisions/${r2.id}/artifacts`)).body.items[0].id, artifactId);

    // 같은 revision을 다시 렌더하면 같은 bytes가 나온다.
    await http.post('/api/v1/artifacts', { json: { resume_revision_id: r2.id } });
    await runRender(api);
    const all = (await http.get(`/api/v1/resume-revisions/${r2.id}/artifacts`)).body.items;
    assert.equal(all.length, 2);
    assert.equal(all[0].sha256, all[1].sha256);

    // 저장 파일이 바뀌면 제공하지 않는다.
    const row = api.db.prepare('SELECT object_key FROM ce7_artifacts WHERE id = ?').get(artifactId);
    api.store.put(start.session.workspace_id, row.object_key, Buffer.from('%PDF-tampered'));
    assert.equal((await http.get(meta.download_path)).body.code, 'ARTIFACT_HASH_MISMATCH');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('another user cannot read or change sessions, messages, proposals, revisions or files', async () => {
  const { folder, cleanup } = tempFolder('s04-owner-');
  const api = await startApi(folder);
  try {
    const alice = client(api, await login(api, 'alice'));
    const bob = client(api, await login(api, 'bob'));
    const start = await startTailoring(api, alice);
    const r1 = (await current(alice, start.session.id)).revision;
    const proposal = (await say(api, alice, start.session.id, '이 공고에 맞춰 수정해줘')).proposal;
    const r2 = (await accept(alice, proposal, r1)).body;
    await alice.post(`/api/v1/resume-revisions/${r2.id}/finalize`, { json: { expected_content_hash: r2.content_hash, reviewed: true } });
    await alice.post('/api/v1/artifacts', { json: { resume_revision_id: r2.id } });
    await runRender(api);
    const artifact = (await alice.get(`/api/v1/resume-revisions/${r2.id}/artifacts`)).body.items[0];
    const s = start.session.id;
    for (const path of [`/api/v1/tailoring-sessions/${s}`, `/api/v1/tailoring-sessions/${s}/messages`, `/api/v1/tailoring-sessions/${s}/proposals`, `/api/v1/tailoring-sessions/${s}/revisions`,
      `/api/v1/resume-revisions/${r2.id}`, `/api/v1/resume-revisions/${r2.id}/artifacts`, `/api/v1/artifacts/${artifact.id}`, `/api/v1/artifacts/${artifact.id}/content`]) {
      assert.equal((await bob.get(path)).status, 404, path);
    }
    assert.equal((await bob.post('/api/v1/tailoring-sessions', { json: { job_snapshot_id: start.job.id, fact_revision_id: start.revision.id } })).status, 404);
    assert.equal((await bob.post(`/api/v1/tailoring-sessions/${s}/messages`, { json: { expected_resume_revision_id: r2.id, content: 'x' } })).status, 404);
    assert.equal((await bob.post(`/api/v1/edit-proposals/${proposal.id}/reject`)).status, 404);
    assert.equal((await bob.post(`/api/v1/resume-revisions/${r2.id}/finalize`, { json: { expected_content_hash: r2.content_hash, reviewed: true } })).status, 404);
    assert.equal((await bob.post('/api/v1/artifacts', { json: { resume_revision_id: r2.id } })).status, 404);
    assert.equal((await client(api, null).get(`/api/v1/artifacts/${artifact.id}/content`)).status, 401);
  } finally {
    await api.stop();
    cleanup();
  }
});

test('idempotent writes replay; a lost lease discards the late assistant answer', async () => {
  const { folder, cleanup } = tempFolder('s04-idem-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'alice'));
    const start = await startTailoring(api, http);
    const r1 = (await current(http, start.session.id)).revision;
    const proposal = (await say(api, http, start.session.id, '이 공고에 맞춰 수정해줘')).proposal;
    const body = { expected_resume_revision_id: r1.id, expected_content_hash: r1.content_hash };
    const first = await http.post(`/api/v1/edit-proposals/${proposal.id}/accept`, { key: 'accept-key-0001', json: body });
    const again = await http.post(`/api/v1/edit-proposals/${proposal.id}/accept`, { key: 'accept-key-0001', json: body });
    assert.equal(again.body.id, first.body.id);
    assert.equal(again.headers.get('idempotent-replay'), 'true');
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM ce7_resume_revisions WHERE session_id = ?').get(start.session.id).n, 2);

    await http.post(`/api/v1/tailoring-sessions/${start.session.id}/messages`, { json: { expected_resume_revision_id: first.body.id, content: 'Storybook 경험을 강조해줘' } });
    let clock = Date.now();
    const now = () => clock;
    const result = await runTailor(api, { leaseMs: 1_000, now, beforeComplete: async () => {
      clock += 5_000;
      assert.equal(await runTailor(api, { leaseMs: 1_000, now }), 'succeeded');
    } });
    assert.equal(result, 'lease_lost');
    const assistants = api.db.prepare("SELECT count(*) AS n FROM ce7_messages WHERE session_id = ? AND role = 'assistant'").get(start.session.id).n;
    assert.equal(assistants, 2, 'only the reclaiming worker saved an answer');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('review fixes: failed replies are visible after reload, invalid provider output fails cleanly, final state is kept, renders are not duplicated', async () => {
  const { folder, cleanup } = tempFolder('s04-review-');
  const api = await startApi(folder);
  try {
    const user = await login(api, 'alice');
    const http = client(api, user);
    const start = await startTailoring(api, http);
    const failed = await say(api, http, start.session.id, '[mock:fail] 맞춰줘');
    const tasks = (await http.get(`/api/v1/tailoring-sessions/${start.session.id}/tasks`)).body.items;
    const last = tasks.find(task => task.input_revision_ids.includes(failed.sent.resource_id));
    assert.equal(last.state, 'failed', 'the session task list tells the screen the reply failed');
    assert.equal(last.error_code, 'MOCK_CHAT_FAILURE');

    // 계약과 다른 provider 응답은 저장하지 않고 실패로 끝낸다(running에 머물지 않음).
    await http.post(`/api/v1/tailoring-sessions/${start.session.id}/messages/${failed.sent.resource_id}/retry`);
    assert.equal(await runTailor(api, { provider: { mode: 'mock', respond: async () => ({ reply: 5, changes: null }) } }), 'failed');
    const invalid = (await http.get(`/api/v1/tailoring-sessions/${start.session.id}/tasks`)).body.items[0];
    assert.equal(invalid.error_code, 'CHAT_OUTPUT_INVALID');
    assert.equal(invalid.provider_transmission, 'completed');

    // 응답 생성 중 확정해도 worker가 세션을 editing으로 되돌리지 않는다.
    const r1 = (await current(http, start.session.id)).revision;
    await http.post(`/api/v1/tailoring-sessions/${start.session.id}/messages`, { json: { expected_resume_revision_id: r1.id, content: '이 공고에 맞춰 수정해줘' } });
    assert.equal((await http.post(`/api/v1/resume-revisions/${r1.id}/finalize`, { json: { expected_content_hash: r1.content_hash, reviewed: true } })).status, 200);
    assert.equal(await runTailor(api), 'succeeded');
    assert.equal((await current(http, start.session.id)).session.state, 'ready');

    const a = await http.post('/api/v1/artifacts', { json: { resume_revision_id: r1.id } });
    const b = await http.post('/api/v1/artifacts', { json: { resume_revision_id: r1.id } });
    assert.equal(b.body.task.id, a.body.task.id, 'a queued render is reused');
    assert.equal(await runRender(api), 'succeeded');
    assert.equal(await runRender(api), 'idle');
    const artifact = (await http.get(`/api/v1/resume-revisions/${r1.id}/artifacts`)).body.items;
    assert.equal(artifact.length, 1);
    // 파일 메타는 HEAD로 본문 없이 확인한다.
    const head = await fetch(api.base + artifact[0].download_path, { method: 'HEAD', headers: { Cookie: user.cookie } });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('x-pdf-page-count'), '1');
    assert.equal(head.headers.get('x-content-sha256'), artifact[0].sha256);
    assert.equal(Number(head.headers.get('content-length')), artifact[0].byte_size);
    assert.equal((await head.arrayBuffer()).byteLength, 0, 'no body on HEAD');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('review fixes: withdrawn facts, missing glyphs and statements from another document block finalization or confirmation', async () => {
  const { folder, cleanup } = tempFolder('s04-review2-');
  const api = await startApi(folder);
  try {
    const user = await login(api, 'alice');
    const http = client(api, user);
    const start = await startTailoring(api, http);
    const r1 = (await current(http, start.session.id)).revision;

    // 글꼴에 없는 글자: 근거 검사는 통과하지만 PDF에서 빠질 글자가 있는 문서는 확정하지 않는다.
    const role = r1.blocks.find(block => block.section === '직무');
    const withMark = r1.blocks.map(block => block.id === role.id ? { ...block, text: `✓ ${block.text}` } : block);
    api.db.prepare(`INSERT INTO ce7_resume_revisions (id, workspace_id, session_id, job_snapshot_id, fact_revision_id, revision, parent_revision_id, blocks_json, content_hash, state, finalized_at_ms, finalization_source, created_at_ms)
      VALUES ('resume_glyph', ?, ?, ?, ?, 50, ?, ?, ?, 'draft', NULL, NULL, ?)`).run(r1.workspace_id, r1.session_id, r1.job_snapshot_id, r1.fact_revision_id, r1.id, JSON.stringify(withMark), 'b'.repeat(64), Date.now());
    api.db.prepare("UPDATE ce7_tailoring_sessions SET current_resume_revision_id = 'resume_glyph' WHERE id = ?").run(start.session.id);
    const glyph = await http.post('/api/v1/resume-revisions/resume_glyph/finalize', { json: { expected_content_hash: 'b'.repeat(64), reviewed: true } });
    assert.equal(glyph.body.code, 'RESUME_GLYPH_MISSING');
    assert.deepEqual(glyph.body.details.characters, ['✓']);
    api.db.prepare('UPDATE ce7_tailoring_sessions SET current_resume_revision_id = ? WHERE id = ?').run(r1.id, start.session.id);

    // 문서를 만든 뒤 사용자가 경력에서 사실을 지우면, 그 사실이 남은 문서는 확정하지 않는다.
    const used = new Set(r1.blocks.flatMap(block => block.fact_ids));
    const target = start.revision.facts.find(item => item.category === 'responsibility' && used.has(item.id));
    const kept = start.revision.facts.filter(item => item.id !== target.id);
    const withdrawn = await http.post(`/api/v1/resume-documents/${start.documentId}/fact-revisions`, { json: { extraction_id: start.draft.id, expected_parent_revision_id: start.revision.id, facts: kept } });
    assert.equal(withdrawn.status, 201);
    const drift = await http.post(`/api/v1/resume-revisions/${r1.id}/finalize`, { json: { expected_content_hash: r1.content_hash, reviewed: true } });
    assert.equal(drift.body.code, 'FACTS_CHANGED');
    assert.deepEqual(drift.body.details.block_ids, [`blk_${target.id}`]);

    // 다른 문서의 편집 세션에서 쓴 메시지는 이 문서의 진술 근거가 될 수 없다.
    const other = await startTailoring(api, http, 'backend', /백엔드|서버/);
    const otherSay = await say(api, http, other.session.id, '팀 배포 일정을 관리했어요.');
    const headId = (await http.get('/api/v1/resume-documents')).body.items.find(item => item.document.id === start.documentId).current_fact_revision_id;
    const head = (await http.get(`/api/v1/resume-fact-revisions/${headId}`)).body;
    const crossed = await http.post(`/api/v1/resume-documents/${start.documentId}/fact-revisions`, { json: {
      extraction_id: start.draft.id, expected_parent_revision_id: head.id,
      facts: [...head.facts, { id: 'fact_cross', category: 'achievement', statement: '팀 배포 일정을 관리했어요.', evidence: [{ kind: 'user_statement', message_id: otherSay.sent.resource_id, confirmed_at: '2026-01-01T00:00:00Z', quote: '팀 배포 일정을 관리했어요.' }] }],
    } });
    assert.equal(crossed.body.code, 'USER_STATEMENT_NOT_FOUND');
  } finally {
    await api.stop();
    cleanup();
  }
});
