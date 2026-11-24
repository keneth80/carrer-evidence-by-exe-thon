import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { extractPdfText } from '../packages/resume/src/pdf.ts';
import { isScrambled, pageText } from '../packages/resume/src/pdf-layout.ts';

// 다양한 PDF 양식 대응(S1-34): 글자를 그린 순서가 뒤섞인 PDF는 화면 위치로 줄·단·표를 다시 맞추고,
// 그린 순서가 읽는 순서와 같은 PDF는 건드리지 않는다. 합성 내용으로 PDF를 만들어 실제 추출 경로로 읽는다.

const FONT = readFileSync(new URL('../packages/render/fonts/NanumGothic-Regular.ttf', import.meta.url));
// draws: [x, y(위에서부터), 글자]. 배열 순서가 그리는 순서다.
async function pdf(draws) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(FONT, { subset: false });
  const page = doc.addPage([595, 842]);
  for (const [x, top, text] of draws) page.drawText(text, { x, y: 842 - top, size: 10, font });
  return (await extractPdfText(await doc.save())).pages[0].text.split('\n').map(line => line.trim()).filter(Boolean);
}
// 정해진 방식으로 섞는다(시험이 매번 같은 결과를 내도록).
const shuffled = items => items.map((item, at) => [((at * 7919) % 13) * 100 + at, item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);

test('scrambled single column is read top to bottom', async () => {
  const lines = Array.from({ length: 24 }, (_, at) => at % 4 === 0 ? `예시회사 ${at / 4 + 1}호점` : `${at + 1}번째 줄: 대리점 주문 문의 창구를 운영했습니다.`);
  assert.deepEqual(await pdf(shuffled(lines.map((text, at) => [60, 80 + at * 22, text]))), lines);
});

test('scrambled two-column prose is read column by column, a full-width title stays on top', async () => {
  const left = Array.from({ length: 12 }, (_, at) => `왼쪽 단 ${at + 1}번째 줄 대리점 주문과 정산 창구 운영`);
  const right = Array.from({ length: 12 }, (_, at) => `오른쪽 단 ${at + 1}번째 줄 고객 응대 기준서를 만든 내용`);
  const draws = [[60, 60, '경력 기술서 · 두 단으로 편집한 양식의 전체 폭 제목 줄입니다 그리고 충분히 깁니다 정말로 아주 깁니다'], ...left.map((text, at) => [40, 100 + at * 20, text]), ...right.map((text, at) => [320, 100 + at * 20, text])];
  const read = await pdf(shuffled(draws));
  assert.deepEqual(read.slice(1), [...left, ...right]);
});

test('scrambled table is read row by row with cells kept together', async () => {
  const rows = [['회사', '직위', '기간'], ['가나유통', '파트장', '2021.04 ~ 현재'], ['다라커머스', '담당', '2018.02 ~ 2021.03'], ['마바물산', '사원', '2015.03 ~ 2018.01'], ['사아전자', '인턴', '2014.07 ~ 2014.12'], ['자차상사', '계약직', '2013.01 ~ 2014.06']];
  const draws = rows.flatMap((cells, row) => cells.map((text, column) => [60 + column * 170, 100 + row * 24, text]));
  assert.deepEqual(await pdf(shuffled(draws)), rows.map(cells => cells.join(' | ')));
});

test('a card grid drawn card by card keeps its draw order, so each card stays together', async () => {
  const cards = [['30만 건', '40분 → 5분', '정산 자동화'], ['2.1초 → 0.9초', '응답 개선', '화면 성능'], ['오류 40건 → 9건', '월 마감', '운영 품질']];
  const draws = cards.flatMap((card, column) => card.map((text, row) => [60 + column * 180, 100 + row * 20, text]));
  assert.deepEqual(await pdf(draws), cards.flat());
});

test('pieces drawn apart on one line get a space; well-ordered text is not reordered', () => {
  const piece = (str, x, y, eol = false) => ({ str, x, y, width: str.length * 9, height: 10, eol });
  const ordered = [piece('가나유통', 60, 700), piece('2021.04 ~ 현재', 400, 700, true), piece('주문 창구를 운영했습니다.', 60, 680, true)];
  assert.deepEqual(pageText(ordered), { text: '가나유통 2021.04 ~ 현재\n주문 창구를 운영했습니다.\n', reordered: false });
  assert.equal(isScrambled([]), false);
  assert.deepEqual(pageText([]), { text: '', reordered: false });
});
