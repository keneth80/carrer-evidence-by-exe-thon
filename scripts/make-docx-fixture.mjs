import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

// 합성 Word(.docx) 이력서 fixture를 만든다(DECISIONS S1-12). 내용은 frontend.synthetic.txt와 같다.
// '사용 기술' 구간은 표 한 줄로 넣어 표 셀 추출을 함께 확인한다. 머리글은 본문이 아니므로 추출되지 않아야 한다.
// 날짜를 고정해 다시 만들어도 bytes가 같다. 사용: node scripts/make-docx-fixture.mjs
// jszip은 mammoth의 의존성으로 설치된다(개발 스크립트 전용).

const ROOT = new URL('../fixtures/resumes/', import.meta.url);
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paragraph = text => text === '' ? '<w:p/>' : `<w:p><w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`;
const cell = text => `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc>`;

const lines = readFileSync(new URL('frontend.synthetic.txt', ROOT), 'utf8').replace(/\n$/, '').split('\n');
const skillsAt = lines.indexOf('사용 기술');
const body = [
  ...lines.slice(0, skillsAt).map(paragraph),
  `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tr>${cell(lines[skillsAt])}${cell(lines[skillsAt + 1])}</w:tr></w:tbl>`,
  ...lines.slice(skillsAt + 2).map(paragraph),
].join('');

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const parts = {
  '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>',
  'word/header1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W}>${paragraph('머리글 합성 문구 (본문 아님)')}</w:hdr>`,
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr></w:body></w:document>`,
};

const zip = new JSZip();
for (const [name, content] of Object.entries(parts)) zip.file(name, content, { date: FIXED_DATE, createFolders: false });
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
writeFileSync(new URL('frontend.synthetic.docx', ROOT), bytes);
const sha256 = createHash('sha256').update(bytes).digest('hex');
writeFileSync(new URL('docx.synthetic.json', ROOT), JSON.stringify({
  kind: 'synthetic_resume_docx_inputs',
  real_person: false,
  note: 'expected.json은 동결 정답 자료라 DOCX 합성 입력의 hash는 이 파일에 둔다. 내용은 frontend.synthetic.txt와 같다.',
  cases: [{ id: 'frontend', docx: 'frontend.synthetic.docx', docx_sha256: sha256, same_text_as: 'frontend.synthetic.txt' }],
}, null, 2) + '\n');
console.log(JSON.stringify({ file: 'fixtures/resumes/frontend.synthetic.docx', bytes: bytes.length, sha256 }));
