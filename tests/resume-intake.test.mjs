import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';

// S01: 실제 HTTP로 등록 → 추출 → 확인 전 상태 → 확정 → 소유권 → 재시작 후 재열람을 확인한다.
const fixture = name => readFileSync(new URL(`../fixtures/resumes/${name}`, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = JSON.parse(fixture('expected.json'));

async function registerPdf(api, http, name) {
  const accepted = await http.upload('/api/v1/resume-documents', fixture(name), name);
  assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
  assert.equal(accepted.body.task.kind, 'extract_resume');
  await api.settle();
  return accepted.body.resource_id;
}

test('S01 frontend PDF: upload, extract, review, confirm, isolate and reopen after restart', async () => {
  const { folder, cleanup } = tempFolder('s01-flow-');
  let api = await startApi(folder);
  try {
    const userA = await login(api, 'alice');
    const a = client(api, userA);
    assert.equal((await a.get('/api/v1/product-session')).body.mode, 'authenticated');

    const documentId = await registerPdf(api, a, 'frontend.synthetic.pdf');
    const document = (await a.get(`/api/v1/resume-documents/${documentId}`)).body;
    assert.equal(document.sha256, expected.cases[0].pdf_sha256);
    assert.equal(document.data_origin, 'synthetic');
    assert.equal(document.extraction_status, 'review_required');
    assert.equal(document.byte_size, fixture('frontend.synthetic.pdf').length);

    const draft = (await a.get(`/api/v1/resume-documents/${documentId}/extraction`)).body;
    assert.equal(draft.status, 'review_required');
    const statements = draft.facts.map(fact => fact.statement);
    for (const skill of ['React', 'TypeScript', 'Storybook']) assert.ok(statements.includes(skill), skill);
    assert.ok(!statements.some(text => /Python|frontend@example\.com|가상 지원자 A/.test(text)), 'no invented skill or personal info');
    assert.ok(!statements.some(text => text.includes('다른 팀에서')), 'negated line is not a fact');
    assert.ok(draft.warnings.some(text => text.startsWith('PREFERENCE_NOT_FACT@')));

    const source = (await a.get(`/api/v1/resume-documents/${documentId}/source-text`)).body;
    assert.equal(source.pages[0].page, 1);
    for (const fact of draft.facts) {
      const evidence = fact.evidence[0];
      assert.equal(Array.from(source.pages[0].text).slice(evidence.start, evidence.end).join(''), evidence.quote);
    }

    // 확인 전: 확정 경력이 없다.
    const before = (await a.get('/api/v1/resume-documents')).body.items;
    assert.equal(before.length, 1);
    assert.equal(before[0].current_fact_revision_id, null);
    assert.equal((await a.get(`/api/v1/resume-fact-revisions/${draft.id}`)).status, 404);

    // 원문에 없는 표현(새 역할·수치)은 원문 근거 사실로 확정하지 않는다.
    const inflated = draft.facts.map(fact => fact.category === 'role' ? { ...fact, statement: '프론트엔드 팀장 (매출 300% 성장)' } : fact);
    const rejected = await a.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: null, facts: inflated } });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.code, 'STATEMENT_EXCEEDS_EVIDENCE');

    // 사용자 수정: 한 항목 제외, 요약 문장을 원문 범위 안에서 첫 문장으로 줄임(줄바꿈 차이는 무시).
    const shorten = text => text.split('. ')[0] + '.';
    const facts = draft.facts.filter(fact => fact.statement !== 'Next.js').map(fact => fact.category === 'other' ? { ...fact, statement: shorten(fact.statement) } : fact);
    const key = 'confirm-key-0001';
    const request = { extraction_id: draft.id, expected_parent_revision_id: null, facts };
    const confirmed = await a.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: request, key });
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.revision, 1);
    assert.equal(confirmed.body.facts.length, draft.facts.length - 1);
    const replay = await a.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: request, key });
    assert.deepEqual(replay.body, confirmed.body);
    assert.equal(replay.headers.get('idempotent-replay'), 'true');
    const reordered = { facts: request.facts, expected_parent_revision_id: null, extraction_id: draft.id };
    assert.equal((await a.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: reordered, key })).headers.get('idempotent-replay'), 'true', 'key order does not change the request');
    assert.equal((await a.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: { ...request, facts: facts.slice(1) }, key })).status, 409);
    const stale = await a.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: request });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'FACT_REVISION_CONFLICT');
    const second = await a.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: { ...request, expected_parent_revision_id: confirmed.body.id } });
    assert.equal(second.body.revision, 2);
    assert.equal(second.body.parent_revision_id, confirmed.body.id);

    // 다른 사용자: 존재 여부를 노출하지 않는 404.
    const b = client(api, await login(api, 'bob'));
    for (const path of [`/api/v1/resume-documents/${documentId}`, `/api/v1/resume-documents/${documentId}/extraction`, `/api/v1/resume-documents/${documentId}/source-text`, `/api/v1/resume-documents/${documentId}/original`, `/api/v1/resume-fact-revisions/${confirmed.body.id}`]) {
      assert.equal((await b.get(path)).status, 404, path);
    }
    assert.deepEqual((await b.get('/api/v1/resume-documents')).body.items, []);
    assert.equal((await b.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: request })).status, 404);

    // 재시작 후 같은 profile로 다시 연결해도 원본과 확정 경력을 읽는다.
    await api.stop();
    api = await startApi(folder);
    const again = client(api, await login(api, 'alice'));
    const items = (await again.get('/api/v1/resume-documents')).body.items;
    assert.equal(items[0].current_fact_revision_id, second.body.id);
    assert.equal(items[0].document.extraction_status, 'extracted');
    assert.deepEqual((await again.get(`/api/v1/resume-fact-revisions/${second.body.id}`)).body, second.body);
    const original = await again.get(`/api/v1/resume-documents/${documentId}/original`, { raw: true });
    assert.equal(sha(original.body), expected.cases[0].pdf_sha256);
    assert.equal(original.headers.get('content-security-policy'), 'sandbox');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('S01 backend pasted text keeps backend signals and does not invent frontend experience', async () => {
  const { folder, cleanup } = tempFolder('s01-paste-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'carol'));
    const text = fixture('backend.synthetic.txt').toString('utf8');
    const accepted = await http.post('/api/v1/resume-documents/text', { json: { text, filename: 'backend.synthetic.txt' } });
    assert.equal(accepted.status, 202);
    await api.settle();
    const document = (await http.get(`/api/v1/resume-documents/${accepted.body.resource_id}`)).body;
    assert.equal(document.input_kind, 'pasted_text');
    assert.equal(document.sha256, expected.cases[1].text_sha256);
    assert.equal(document.data_origin, 'synthetic');
    const draft = (await http.get(`/api/v1/resume-documents/${accepted.body.resource_id}/extraction`)).body;
    const statements = draft.facts.map(fact => fact.statement);
    for (const skill of ['Python', 'FastAPI', 'AWS Lambda', 'SQS']) assert.ok(statements.includes(skill), skill);
    assert.ok(!statements.some(item => /React|절감률|개선율|backend@example\.com/.test(item)));
    assert.equal(draft.facts[0].evidence[0].page, null);

    const other = await http.post('/api/v1/resume-documents/text', { json: { text: '홍길동\n백엔드 엔지니어\n\n기술\nGo, Kafka' } });
    await api.settle();
    assert.equal((await http.get(`/api/v1/resume-documents/${other.body.resource_id}`)).body.data_origin, 'user');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('S01 rejects unsupported input, forged evidence and requests without session, CSRF or origin', async () => {
  const { folder, cleanup } = tempFolder('s01-errors-');
  const api = await startApi(folder);
  try {
    const user = await login(api, 'dave');
    const http = client(api, user);
    // 깨진 ZIP은 Word 형식으로 받지 않는다(DOCX 지원 후에도 구조 검사 실패는 415). 세부 DOCX 경로는 docx-intake.test.mjs.
    const docx = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(64)]);
    const rejectedDocx = await http.upload('/api/v1/resume-documents', docx, 'resume.docx');
    assert.equal(rejectedDocx.status, 415);
    assert.equal(rejectedDocx.body.code, 'DOCX_INVALID');
    assert.equal((await http.upload('/api/v1/resume-documents', Buffer.from('hello'), 'notes.txt')).body.code, 'UNSUPPORTED_FORMAT');
    assert.equal((await http.upload('/api/v1/resume-documents', Buffer.alloc(0), 'empty.pdf')).body.code, 'FILE_EMPTY');
    const huge = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(api.config.limits.pdfBytes)]);
    assert.equal((await http.upload('/api/v1/resume-documents', huge, 'huge.pdf')).status, 413);
    assert.equal((await http.post('/api/v1/resume-documents/text', { json: { text: '   ' } })).body.code, 'TEXT_EMPTY');
    assert.equal((await http.post('/api/v1/resume-documents/text', { json: { text: 'x', workspace_id: 'someone' } })).status, 400);
    assert.deepEqual((await http.get('/api/v1/resume-documents')).body.items, [], 'rejected input creates no document');

    // 텍스트 없는(스캔형) PDF와 깨진 PDF는 실패 상태와 복구 안내로 남는다.
    const blank = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    const blankId = (await http.upload('/api/v1/resume-documents', blank, 'scan.pdf')).body.resource_id;
    const broken = (await http.upload('/api/v1/resume-documents', Buffer.from('%PDF-1.7\nnot really a pdf'), 'broken.pdf')).body.resource_id;
    await api.settle();
    const blankDoc = (await http.get(`/api/v1/resume-documents/${blankId}`)).body;
    assert.equal(blankDoc.extraction_status, 'failed');
    assert.equal(blankDoc.error_code, 'EMPTY_TEXT');
    assert.equal((await http.get(`/api/v1/resume-documents/${blankId}/extraction`)).body.status, 'failed');
    assert.equal((await http.get(`/api/v1/resume-documents/${broken}`)).body.extraction_status, 'failed');

    const paste = await http.post('/api/v1/resume-documents/text', { json: { text: '경력\n예시 회사 | 2020.01 - 2021.12\n기술\nRust' } });
    await api.settle();
    const documentId = paste.body.resource_id;
    const draft = (await http.get(`/api/v1/resume-documents/${documentId}/extraction`)).body;
    const confirm = facts => http.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: null, facts } });
    const forged = structuredClone(draft.facts); forged[0].evidence[0].quote = 'Python 10년';
    assert.equal((await confirm(forged)).body.code, 'EVIDENCE_QUOTE_MISMATCH');
    const userStatement = structuredClone(draft.facts); userStatement[0].evidence = [{ kind: 'user_statement', message_id: 'm1', confirmed_at: new Date().toISOString(), quote: 'Python' }];
    assert.equal((await confirm(userStatement)).body.code, 'USER_STATEMENT_NOT_FOUND', 'a statement must point to a real user message');
    const otherDoc = structuredClone(draft.facts); otherDoc[0].evidence[0].document_id = blankId;
    assert.equal((await confirm(otherDoc)).body.code, 'EVIDENCE_OTHER_DOCUMENT');
    assert.equal((await confirm([])).body.code, 'FACTS_REQUIRED');
    assert.equal((await http.post(`/api/v1/resume-documents/${blankId}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: null, facts: draft.facts } })).body.code, 'EXTRACTION_NOT_FOR_DOCUMENT');

    const anonymous = client(api, null);
    assert.equal((await anonymous.get('/api/v1/resume-documents')).status, 401);
    assert.equal((await http.post('/api/v1/resume-documents/text', { json: { text: 'a' }, headers: { 'X-CSRF-Token': 'f'.repeat(64) } })).body.code, 'CSRF_INVALID');
    assert.equal((await http.post('/api/v1/resume-documents/text', { json: { text: 'a' }, headers: { 'Idempotency-Key': 'short' } })).body.code, 'IDEMPOTENCY_KEY_REQUIRED');
    const noOrigin = await fetch(`${api.base}/api/v1/resume-documents/text`, { method: 'POST', headers: { Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Idempotency-Key': 'no-origin-0001', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'a' }) });
    assert.equal(noOrigin.status, 403);
    assert.equal((await http.del('/api/v1/local-dev/session')).status, 204);
    assert.equal((await http.get('/api/v1/resume-documents')).status, 401, 'logged out session is rejected');
    assert.equal((await anonymous.get('/api/v1/resume-searches/x')).status, 401, 'S02 endpoints require a session');
    assert.equal((await anonymous.get('/api/v1/tailoring-sessions/x')).status, 401, 'S04 endpoints require a session');
    assert.equal((await anonymous.get('/api/v1/job-applications')).status, 401, 'S05 endpoints require a session');
    assert.equal((await anonymous.get('/api/v1/auto-apply-policies')).status, 401, 'S06 automation endpoints require a session');
  } finally {
    await api.stop();
    cleanup();
  }
});
