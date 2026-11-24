import { storeZip } from './zip.ts';
import { employerPeriods, projectSpan, resumeLayout } from '../../tailor/src/layout.ts';
import { sectionLabel } from '../../tailor/src/types.ts';
import { withoutHiddenChars } from '../../tailor/src/hidden-chars.ts';
import type { FactLike, ResumeBlock } from '../../tailor/src/types.ts';

// 기본 이력서 Word(.docx) 내려받기(사용자 요청 2026-11-20, DECISIONS S1-23).
// 확정 경력 최신 버전의 문장을 원래 순서대로 그대로 넣는다(새 문장·수치를 만들지 않는다). 맞춤 수정은 공고별 최종본에서만 한다.
// 이름·연락처는 확정 경력에 없으므로(검색어 개인정보 제외 원칙) 맨 위에 [빈칸]으로 두고 사용자가 Word에서 채운다.
// 브라우저에서 만든다: node 전용 모듈을 쓰지 않는다.

type FactText = { id: string; category: string; statement: string };
export type DocxStyle = 'Title' | 'Contact' | 'Heading1' | 'Heading2' | 'Role' | 'Bullet' | 'Body';
export type DocxLine = { style: DocxStyle; text: string };

export const DOCX_FILENAME = (revision: number) => `기본이력서_v${revision}.docx`;
// 파일 이름에 쓸 수 없는 문자(\ / : * ? " < > | 제어 문자)는 빼고 길이를 줄인다.
const fileSafe = (text: string) => text.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || '공고';
export const TAILORED_DOCX_FILENAME = (company: string, revision: number) => `맞춤이력서_${fileSafe(company)}_v${revision}.docx`;
const PLACEHOLDERS: DocxLine[] = [{ style: 'Title', text: '[이름]' }, { style: 'Contact', text: '[이메일] · [전화번호]' }];

type Group = '요약' | '경력' | '프로젝트' | '기술' | '학력' | '자격' | '기타';
const FIXED_GROUP: Record<string, Group> = { employer: '경력', skill: '기술', education: '학력', certification: '자격', location: '기타' };

// 회사 아래의 직무·기간·업무·성과·기타 문장은 그 회사 경력에 둔다. 회사가 나오기 전 소개·직무는 '요약'이다.
function groupOf(category: string, current: Group | null): Group {
  if (FIXED_GROUP[category]) return FIXED_GROUP[category];
  if (current === '경력') return '경력';
  return category === 'responsibility' || category === 'achievement' || category === 'period' ? '경력' : '요약';
}

function styleOf(category: string, group: Group): DocxStyle {
  if (group !== '경력') return 'Body';
  return category === 'role' || category === 'period' ? 'Role' : 'Bullet';
}

export function resumeDocxLines(facts: FactText[]): DocxLine[] {
  const lines: DocxLine[] = [...PLACEHOLDERS];
  const used = new Set<Group>();
  // 회사별 기간·프로젝트 구간은 공고별 이력서와 같은 규칙(layout.ts)을 쓴다: 기간이 회사 앞에 오는 이력서, 마지막 회사 뒤 프로젝트.
  const periods = employerPeriods(facts);
  const consumed = new Set<number>(periods.values());
  const projects = projectSpan(facts);
  let current: Group | null = null;
  for (let index = 0; index < facts.length; index++) {
    if (consumed.has(index)) continue;
    const fact = facts[index];
    const inProject = projects !== null && index >= projects.start && index < projects.end;
    const group: Group = inProject ? '프로젝트' : groupOf(fact.category, current);
    if (group !== current && !used.has(group)) { lines.push({ style: 'Heading1', text: group }); used.add(group); }
    current = group;
    if (fact.category === 'skill') {
      // 이어지는 기술은 한 줄로 묶는다(최종본 PDF와 같은 표기).
      const run = [fact.statement];
      while (facts[index + 1]?.category === 'skill') run.push(facts[++index].statement);
      lines.push({ style: 'Body', text: run.join(' · ') });
      continue;
    }
    if (fact.category === 'employer') {
      const at = periods.get(index);
      lines.push({ style: 'Heading2', text: at !== undefined ? `${fact.statement} · ${facts[at].statement}` : fact.statement });
      continue;
    }
    if (inProject) { lines.push({ style: projects.heads.includes(index) ? 'Heading2' : 'Bullet', text: fact.statement }); continue; }
    lines.push({ style: styleOf(fact.category, group), text: fact.statement });
  }
  return lines;
}

// 공고별 이력서 Word(사용자 요청 2026-11-21: "수정할 수 있도록 doc 파일로도"). 미리보기·PDF와 같은 회사별 배치(layout.ts)를 쓴다.
// 제출 파일은 확정 PDF이고, Word에서 고친 내용은 앱으로 돌아오지 않는다(화면 안내). 이름·연락처는 기본 이력서와 같이 [빈칸].
export function tailoredDocxLines(blocks: ResumeBlock[], facts: FactLike[]): DocxLine[] {
  const lines: DocxLine[] = [...PLACEHOLDERS];
  for (const section of resumeLayout(blocks, facts)) {
    lines.push({ style: 'Heading1', text: sectionLabel(section.section) });
    for (const block of section.blocks) lines.push({ style: section.section === '기술' ? 'Body' : 'Bullet', text: block.text });
    for (const employer of section.employers) {
      lines.push({ style: 'Heading2', text: employer.title });
      const sub = employer.items.filter(item => item.kind === 'role' || item.kind === 'period');
      for (const item of sub) lines.push({ style: 'Role', text: item.block.text });
      for (const item of employer.items) if (!sub.includes(item)) lines.push({ style: 'Bullet', text: item.block.text });
    }
  }
  return lines;
}

// XML 1.0에 쓸 수 없는 제어 문자와 보이지 않는 문자(S4-16)는 뺀다(탭·줄바꿈은 유지).
const clean = (text: string) => withoutHiddenChars(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
const escape = (text: string) => clean(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const STYLE_ID: Record<DocxStyle, string> = { Title: 'Title', Contact: 'Contact', Heading1: 'Heading1', Heading2: 'Heading2', Role: 'Role', Bullet: 'Bullet', Body: 'Normal' };

// 채워야 할 [빈칸](이름·연락처)은 노란 형광으로 표시한다. 줄바꿈은 같은 문단 안 줄바꿈으로 둔다.
function paragraph(line: DocxLine): string {
  const mark = (line.style === 'Title' || line.style === 'Contact') && /\[[^\]]+\]/.test(line.text) ? '<w:rPr><w:highlight w:val="yellow"/></w:rPr>' : '';
  const runs = line.text.split(/\r?\n/).map((part, index) =>
    `${index > 0 ? '<w:r><w:br/></w:r>' : ''}<w:r>${mark}<w:t xml:space="preserve">${escape(line.style === 'Bullet' && index === 0 ? `• ${part}` : part)}</w:t></w:r>`).join('');
  return `<w:p><w:pPr><w:pStyle w:val="${STYLE_ID[line.style]}"/></w:pPr>${runs}</w:p>`;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const FONT = '<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕" w:cs="Malgun Gothic"/>';
const style = (id: string, name: string, ppr: string, rpr: string, basedOn = 'Normal') =>
  `<w:style w:type="paragraph" w:customStyle="${['Contact', 'Role', 'Bullet'].includes(id) ? 1 : 0}" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/><w:next w:val="Normal"/><w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
const STYLES = `${XML}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:sz w:val="21"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
  + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
  + style('Title', 'Title', '<w:spacing w:after="60"/>', '<w:b/><w:sz w:val="40"/>')
  + style('Contact', 'Contact', '<w:spacing w:after="240"/>', '<w:color w:val="555555"/>')
  + style('Heading1', 'heading 1', '<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="2B5F66"/></w:pBdr><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="0"/>', '<w:b/><w:color w:val="2B5F66"/><w:sz w:val="28"/>')
  + style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="23"/>')
  + style('Role', 'Role', '<w:spacing w:after="60"/>', '<w:color w:val="555555"/>')
  + style('Bullet', 'Bullet', '<w:ind w:left="284" w:hanging="284"/>', '')
  + '</w:styles>';
const CONTENT_TYPES = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const ROOT_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOC_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
// A4, 여백 2cm.
const SECTION = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';

export function resumeDocx(facts: FactText[]): Uint8Array {
  return docxFromLines(resumeDocxLines(facts));
}

export function tailoredDocx(blocks: ResumeBlock[], facts: FactLike[]): Uint8Array {
  return docxFromLines(tailoredDocxLines(blocks, facts));
}

function docxFromLines(lines: DocxLine[]): Uint8Array {
  const body = lines.map(paragraph).join('');
  const encoder = new TextEncoder();
  return storeZip([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(DOC_RELS) },
    { name: 'word/styles.xml', data: encoder.encode(STYLES) },
    { name: 'word/document.xml', data: encoder.encode(`${XML}<w:document ${W}><w:body>${body}${SECTION}</w:body></w:document>`) },
  ]);
}
