import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { withoutHiddenChars } from '../packages/tailor/src/hidden-chars.ts';
import { scrubProse } from '../packages/liner/src/scrub.ts';
import { renderableText } from '../packages/render/src/resume-pdf.ts';
import { resumeDocx, tailoredDocx } from '../packages/render/src/resume-docx.ts';

// 사용자 요청(2026-11-24): 이력서에 AI가 썼다는 흔적이 남지 않게, 보이지 않는 특수문자(제로폭·방향 제어·태그 문자 등)와
// 특이한 공백을 지운다(DECISIONS S4-16). AI 응답을 받을 때와 PDF·Word로 내보낼 때 두 번 지운다.

const HIDDEN = ['\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u2060', '\ufeff', '\u00ad', '\u202a', '\u202e', '\u2066', '\u2069',
  '\u034f', '\u180e', '\u3164', '\uffa0', '\u115f', '\u1160', '\ufe0f', '\u{e0041}', '\u{e007f}', '\u{e0100}'];
const ODD_SPACES = ['\u00a0', '\u202f', '\u2002', '\u2003', '\u2009', '\u200a', '\u205f', '\u3000', '\u1680'];

test('invisible characters are removed and unusual spaces become a normal space', () => {
  for (const char of HIDDEN) assert.equal(withoutHiddenChars(`정산${char}화면`), '정산화면', `U+${char.codePointAt(0).toString(16)}`);
  for (const space of ODD_SPACES) assert.equal(withoutHiddenChars(`정산${space}화면`), '정산 화면', `U+${space.codePointAt(0).toString(16)}`);
});

test('ordinary resume text, line breaks and punctuation stay as they are', () => {
  const text = '결제·정산 화면을 React로 개발했습니다.\n배포 시간을 30분에서 5분으로 줄였습니다. “사내 표준” (2021)\t끝';
  assert.equal(withoutHiddenChars(text), text);
  assert.equal(withoutHiddenChars(''), '');
});

test('Liner output text loses hidden characters, but fields that locate the source stay exact', () => {
  const raw = {
    reply: '정산\u200b화면 (fact_001)을 고쳤어요.',
    changes: [{ before: '정산\u00ad화면', after: '정산\u200d화면을\u202f개발했습니다.' }],
    review: [{ entries: [{ quote: '원문\u00ad인용', text: '다듬은\u{e0041}문장', wording: '문구\ufeff' }] }],
    items: [{ n: 1, parts: [{ text: '원문\u00ad조각', category: 'other' }] }],
  };
  const out = scrubProse(raw);
  assert.equal(out.reply, '정산화면을 고쳤어요.');
  assert.equal(out.changes[0].before, '정산\u00ad화면');
  assert.equal(out.changes[0].after, '정산화면을 개발했습니다.');
  assert.equal(out.review[0].entries[0].quote, '원문\u00ad인용');
  assert.equal(out.review[0].entries[0].text, '다듬은문장');
  assert.equal(out.review[0].entries[0].wording, '문구');
  assert.equal(out.items[0].parts[0].text, '원문\u00ad조각');
  assert.equal(raw.reply, '정산\u200b화면 (fact_001)을 고쳤어요.');
});

test('PDF text drops hidden characters', () => {
  assert.equal(renderableText('정산\u200b화면\u202f개발\ufeff'), '정산화면 개발');
});

const documentText = async bytes => (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');

test('Word files carry no hidden characters, from confirmed facts or tailored blocks', async () => {
  const facts = [{ id: 'd1', category: 'responsibility', statement: '정산\u200b화면을\u00a0개발했습니다.\u{e0041}' }];
  const base = await documentText(resumeDocx(facts));
  assert.match(base, /정산화면을 개발했습니다\./);
  const blocks = [{ id: 'blk_1', section: 'experience', text: '주문\u2060화면을\u3000개발했습니다.', fact_ids: ['d1'] }];
  const tailored = await documentText(tailoredDocx(blocks, facts));
  assert.match(tailored, /주문화면을 개발했습니다\./);
  for (const xml of [base, tailored]) for (const char of [...HIDDEN, ...ODD_SPACES]) assert.ok(!xml.includes(char), `U+${char.codePointAt(0).toString(16)}`);
});
