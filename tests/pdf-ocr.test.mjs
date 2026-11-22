import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { extractPdfText } from '../packages/resume/src/pdf.ts';
import { looksScanned, ocrPdfIsolated } from '../packages/resume/src/pdf-ocr.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';

// 스캔본 PDF 글자 인식(S1-35): 글자 정보가 없는 PDF는 이 컴퓨터 안에서 글자를 인식해 같은 경로로 읽는다.
// 합성 이력서를 그림으로 그려 넣은 PDF로 실제 인식기를 돌린다(외부 호출 없음).

GlobalFonts.registerFromPath(new URL('../packages/render/fonts/NanumGothic-Regular.ttf', import.meta.url).pathname, 'Nanum');
const LINES = ['한예시 경력 기술서', '경력', '가나유통 주식회사  영업지원 파트장  2021.04 ~ 현재', '대리점 120곳의 주문 문의 창구를 운영했습니다.', '월 마감 오류 건수를 40건에서 9건으로 줄였습니다.', '기술', 'Excel, SAP, Salesforce', '학력', '예시대학교 경영학과 졸업'];
async function scannedPdf(lines = LINES) {
  const canvas = createCanvas(1240, 1754);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 1240, 1754);
  context.fillStyle = '#111'; context.font = '30px Nanum';
  lines.forEach((line, at) => context.fillText(line, 110, 160 + at * 64));
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawImage(await doc.embedPng(canvas.toBuffer('image/png')), { x: 0, y: 0, width: 595, height: 842 });
  return Buffer.from(await doc.save());
}

test('an image-only PDF is detected and its Korean and English text is recognized locally', async () => {
  const bytes = await scannedPdf();
  assert.equal(looksScanned(await extractPdfText(bytes)), true);
  const text = (await ocrPdfIsolated(bytes)).pages[0].text;
  for (const expected of ['가나유통 주식회사', '영업지원 파트장', '2021.04', '40건에서 9건으로 줄였습니다', 'Excel, SAP, Salesforce', '예시대학교 경영학과 졸업']) assert.ok(text.includes(expected), expected);
  assert.equal(looksScanned({ input_kind: 'text_pdf', pages: [{ page: 1, text: '- 1 -\n' }] }), true);
  assert.equal(looksScanned({ input_kind: 'text_pdf', pages: [{ page: 1, text: '가나유통 주식회사에서 주문 문의 창구를 운영했습니다. 월 마감 오류를 줄였습니다.' }] }), false);
});

test('uploading a scanned PDF yields candidates with source positions and a recognition warning', async () => {
  const { folder, cleanup } = tempFolder('s01-ocr-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'erin'));
    const accepted = await http.upload('/api/v1/resume-documents', await scannedPdf(), 'scan.synthetic.pdf');
    await api.settle?.();
    let draft;
    for (let tries = 0; tries < 200; tries++) {
      draft = (await http.get(`/api/v1/resume-documents/${accepted.body.resource_id}/extraction`)).body;
      if (draft.facts) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(draft.status, 'review_required');
    // 스캔본임과 인식이 불완전할 수 있음을 경고로 알린다(쪽 수 포함). 글자가 있는 PDF에는 이 경고가 붙지 않는다.
    assert.ok(draft.warnings.some(warning => warning.startsWith('OCR_TEXT@- 스캔본으로 확인되어') && warning.includes('1쪽') && warning.includes('인식되지 않았거나 틀릴 수')));
    const { readFileSync } = await import('node:fs');
    const plain = await http.upload('/api/v1/resume-documents', readFileSync(new URL('../fixtures/resumes/backend.synthetic.pdf', import.meta.url)), 'backend.synthetic.pdf');
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.ok(!(await http.get(`/api/v1/resume-documents/${plain.body.resource_id}/extraction`)).body.warnings.some(warning => warning.startsWith('OCR_TEXT')));
    // 글자를 하나도 인식하지 못한 스캔본은 '스캔본인데 인식 실패'로 끝난다.
    const blank = await http.upload('/api/v1/resume-documents', await scannedPdf([]), 'blank.synthetic.pdf');
    let failed;
    for (let tries = 0; tries < 200; tries++) {
      failed = (await http.get(`/api/v1/resume-documents/${blank.body.resource_id}`)).body;
      if (failed.extraction_status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.deepEqual([failed.extraction_status, failed.error_code], ['failed', 'OCR_NO_TEXT']);
    assert.ok(draft.facts.some(fact => fact.statement.includes('가나유통')));
    const source = (await http.get(`/api/v1/resume-documents/${accepted.body.resource_id}/source-text`)).body;
    for (const fact of draft.facts) {
      const [evidence] = fact.evidence;
      assert.equal(Array.from(source.pages[0].text).slice(evidence.start, evidence.end).join(''), evidence.quote);
    }
  } finally {
    await api.stop();
    cleanup();
  }
});
