import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { createSearch, jobsOf, workerDeps } from './helpers/s02-harness.mjs';
import { runSearchTask } from '../apps/worker/src/search-task.ts';
import { docxRawToSource, inspectDocx } from '../packages/resume/src/docx.ts';

// S1-12: Word(.docx) 이력서를 실제 업로드 API로 등록 → 추출 확인 → 확정 → mock 검색까지 통과시킨다.
const fixture = name => readFileSync(new URL(`../fixtures/resumes/${name}`, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function zipOf(files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('DOCX 합성 이력서: 등록 → 추출 → 근거 위치 → 확정 → 검색, 원본 bytes·형식 보존', async () => {
  const { folder, cleanup } = tempFolder('docx-flow-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'erin'));
    const bytes = fixture('frontend.synthetic.docx');
    const accepted = await http.upload('/api/v1/resume-documents', bytes, 'frontend.synthetic.docx');
    assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
    await api.settle();
    const documentId = accepted.body.resource_id;

    const document = (await http.get(`/api/v1/resume-documents/${documentId}`)).body;
    assert.equal(document.input_kind, 'docx');
    assert.equal(document.mime_type, DOCX_MIME);
    assert.equal(document.sha256, JSON.parse(fixture('docx.synthetic.json')).cases[0].docx_sha256);
    assert.equal(document.data_origin, 'synthetic', 'the synthetic DOCX is recognised by hash, not by name');
    assert.equal(document.extraction_status, 'review_required');

    const source = (await http.get(`/api/v1/resume-documents/${documentId}/source-text`)).body;
    assert.equal(source.input_kind, 'docx');
    assert.equal(source.pages.length, 1);
    assert.equal(source.pages[0].page, null, 'DOCX has no pages; evidence uses text offsets');
    assert.equal(source.pages[0].text, fixture('frontend.synthetic.txt').toString('utf8').trimEnd(), 'same text as the TXT fixture, table cells included');
    assert.ok(!source.pages[0].text.includes('머리글'), 'header text is not body text');

    const draft = (await http.get(`/api/v1/resume-documents/${documentId}/extraction`)).body;
    const statements = draft.facts.map(fact => fact.statement);
    for (const skill of ['React', 'TypeScript', 'Storybook']) assert.ok(statements.includes(skill), skill);
    assert.ok(!statements.some(text => /Python|frontend@example\.com|가상 지원자 A/.test(text)), 'no invented skill or personal info');
    assert.ok(!statements.some(text => text.includes('다른 팀에서')), 'negated line is not a fact');
    for (const fact of draft.facts) {
      const evidence = fact.evidence[0];
      assert.equal(evidence.page, null);
      assert.equal(Array.from(source.pages[0].text).slice(evidence.start, evidence.end).join(''), evidence.quote);
    }

    const original = await http.get(`/api/v1/resume-documents/${documentId}/original`, { raw: true });
    assert.equal(original.status, 200);
    assert.equal(original.headers.get('content-type'), DOCX_MIME);
    assert.equal(sha(original.body), sha(bytes), 'original Word bytes are kept unchanged');

    const confirmed = await http.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { json: { extraction_id: draft.id, expected_parent_revision_id: null, facts: draft.facts } });
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
    const { searchId } = await createSearch(http, confirmed.body.id);
    assert.equal(await runSearchTask(workerDeps(api)), 'succeeded');
    const { search, jobs } = await jobsOf(http, searchId);
    assert.equal(search.state, 'succeeded');
    assert.ok(jobs.length > 0);
    assert.ok(jobs.some(job => /프론트엔드|Frontend|React/i.test(`${job.title} ${job.description ?? ''}`)), 'frontend signals reach the search');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('DOCX 업로드 거절: 옛 .doc·암호 Word, 본문 없는 ZIP, 압축 폭탄 선언 크기 — 문서를 만들지 않는다', async () => {
  const { folder, cleanup } = tempFolder('docx-reject-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'frank'));
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
    const legacy = await http.upload('/api/v1/resume-documents', ole, 'resume.doc');
    assert.equal(legacy.status, 415);
    assert.equal(legacy.body.code, 'DOC_NOT_SUPPORTED');
    assert.deepEqual(legacy.body.details.accepted, ['application/pdf', DOCX_MIME]);

    const spreadsheet = await zipOf({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' });
    assert.equal((await http.upload('/api/v1/resume-documents', spreadsheet, 'book.xlsx')).body.code, 'DOCX_INVALID');

    // 중앙 디렉터리의 선언 크기만으로 거른다: 실제로 압축을 풀지 않는다.
    const bomb = Buffer.from(await zipOf({ 'word/document.xml': '<w:document/>' }));
    const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(60 * 1024 * 1024, central + 24);
    assert.equal(inspectDocx(bomb)?.code, 'DOCX_TOO_LARGE');
    assert.equal((await http.upload('/api/v1/resume-documents', bomb, 'bomb.docx')).body.code, 'DOCX_TOO_LARGE');

    assert.deepEqual((await http.get('/api/v1/resume-documents')).body.items, [], 'rejected input creates no document');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('DOCX 본문이 깨져 추출에 실패하면 실패 상태로 남고 빈 경력으로 처리하지 않는다', async () => {
  const { folder, cleanup } = tempFolder('docx-broken-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'gina'));
    const broken = await zipOf({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document><w:body><not-closed>' });
    const accepted = await http.upload('/api/v1/resume-documents', broken, 'broken.docx');
    assert.equal(accepted.status, 202);
    await api.settle();
    const document = (await http.get(`/api/v1/resume-documents/${accepted.body.resource_id}`)).body;
    assert.equal(document.extraction_status, 'failed');
    assert.match(document.error_code, /^DOCX_|^EMPTY_TEXT$/);
    assert.equal((await http.get(`/api/v1/resume-documents/${accepted.body.resource_id}/extraction`)).body.status, 'failed');
    assert.equal((await http.get('/api/v1/resume-documents')).body.items[0].current_fact_revision_id, null, 'no confirmed facts');
  } finally {
    await api.stop();
    cleanup();
  }
});

test('mammoth 문단 구분을 한 줄로 바꾸고 빈 문단은 빈 줄로 남긴다', () => {
  assert.equal(docxRawToSource('A\n\n\n\nB\n\n'), 'A\n\nB');
  assert.equal(docxRawToSource('경력\r\n\r\n요약\n\n'), '경력\n요약');
  assert.equal(docxRawToSource(''), '');
});
