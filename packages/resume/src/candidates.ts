import { codePointSlice, splitLines } from './source.ts';
import type { Line, SourcePage, SourceText } from './source.ts';
import { FACT_LIMITS } from './confirm.ts';
import type { ExtractionWarning, FactCategory, ResumeFact } from './types.ts';

// 규칙 기반 후보 추출. 모델을 쓰지 않고 원문 줄을 그대로 후보로 만든다.
// 확신할 수 없는 줄은 사실 후보가 아니라 경고로 남겨 사용자가 원문에서 직접 추가하게 한다.

// 'other'는 번호·괄호 서식으로 제목임은 분명하지만 이름으로 분류하지 못한 구역이다.
type Section = 'header' | 'summary' | 'experience' | 'skills' | 'projects' | 'education' | 'certification' | 'achievements' | 'unverified' | 'preferences' | 'other';

const HEADINGS: [Section, RegExp][] = [
  ['summary', /^(경력\s*요약|요약|자기\s*소개|소개|summary|profile|about( me)?)$/i],
  ['experience', /^(((이전|주요|최근|근무|직장|회사)\s*)?경력|경력\s*(사항|상세)|경력\s*기술서?|work\s*experience|experience|employment|career)$/i],
  ['skills', /^(((핵심|주요|보유|사용)\s*)?(업무\s*)?(기술|스킬|역량)(\s*스택)?|skills?|technical\s*skills|tech\s*stack)$/i],
  ['projects', /^(((주요|개인|사이드|토이)\s*)?프로젝트(\s*(경험|이력))?|오픈\s*소스|projects?)$/i],
  ['education', /^(학력|교육|education)$/i],
  ['certification', /^(자격증?|자격\s*사항|certifications?|licenses?)$/i],
  ['achievements', /^(((대표|주요)\s*)?(성과|수상)|수상\s*경력|achievements?|awards?)$/i],
  ['other', /^((외부|사내)\s*)?(강의|강연|발표)(\s*(경력|이력))?$/],
  ['unverified', /^(확인되지\s*않은\s*정보|미확인\s*정보)$/],
  ['preferences', /^(희망\s*조건|희망\s*사항|선호\s*조건)$/],
];

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const PHONE = /(\+?82[-\s]?)?0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/;
const PREFERENCE = /(희망|선호|원하는\s*(근무|연봉|직무))/;
const NEGATION = /(없습니다|없음|없었|않았|않습니다|않음|아닙니다|다른\s*팀에서|확인되지\s*않|미확인|별도로\s*확인)/;
const ROLE_TITLE = /(개발자|엔지니어|디자이너|기획자|매니저|마케터|분석가|연구원|developer|engineer|designer|manager|scientist)\s*$/i;
const DATE_RANGE = /\d{4}\s*[.\-/년]\s*\d{0,2}\s*월?\s*[~\-–—]\s*(\d{4}\s*[.\-/년]?\s*\d{0,2}\s*월?|현재|재직\s*중|present)/i;
const MEASURED = /\d+(\.\d+)?\s*(%|배|건|명|억|만\s*원)/;

const BULLETS = /^[#•\-*■□▪▶▷►●○◆◇※\s]+/;
// 제목 서식으로만 쓰는 번호: 01·02, 두 자리+공백 두 칸, 로마 숫자, 원 숫자. '1. '·'10. '은 목록 항목일 수 있어 여기서 빼고 아래에서만 뗀다.
const SECTION_NUMBER = /^(0\d[.)]?\s+|\d{2}\s{2,}|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.)]?\s+|[①-⑳]\s*)/;
const LIST_NUMBER = /^\d{1,2}[.)]\s+/;
const BRACKETED = /^[[【〈<]\s*([^\]】〉>]{1,30}?)\s*[\]】〉>]$/;
const SENTENCE_END = /(다|요)\.?$|[.!?]$/;
const CLAUSE_CONTINUES = /(?:[가-힣][을를]|\s(?:및|또는|그리고))$/;
const LEADING_BULLET = /^[•\-*■□▪▶▷►●○◆◇※]\s*/;
// 표로 만든 경력란의 머리 줄(열 이름). 내용이 아니라 경력 항목으로 만들지 않는다.
const TABLE_LABEL = /^(기간|근무\s*기간|재직\s*기간|회사명?|소속(\s*및\s*(역할|직위|직책))?|직위|직책|역할|(주요|담당)\s*업무|업무\s*내용|비고)$/;
const POSITION = /(사원|주임|대리|과장|차장|부장|팀장|실장|수석|책임|선임|연구원|리드|매니저|인턴)$/;
// '회사 · 직위', '팀 직위 | 역할'의 구분자. '서버·클라우드'처럼 붙은 가운뎃점은 나누지 않는다.
const PAIR_SEPARATOR = /\s+[·|]\s+|\s*\|\s*/;

function namedHeading(core: string): Section | null {
  if (core.length === 0 || core.length > 20) return null;
  const direct = HEADINGS.find(([, pattern]) => pattern.test(core))?.[0];
  if (direct) return direct;
  // '학력 · 자격 · 교육'처럼 제목만 묶은 줄은 첫 제목의 구역으로 본다. 제목이 아닌 조각이 하나라도 있으면 묶음이 아니다.
  // '학력과 자격'·'오픈소스와 개인 프로젝트'처럼 '과/와'로 이은 묶음도 같다(모든 조각이 제목일 때만이라 일반 문장은 걸리지 않는다).
  const parts = core.split(/\s*(?:[·•,，/&]|및)\s*|(?<=[가-힣])(?:과|와)\s+/).filter(part => part.length > 0);
  if (parts.length < 2) return null;
  const sections = parts.map(part => HEADINGS.find(([, pattern]) => pattern.test(part))?.[0] ?? null);
  return sections.every(section => section !== null) ? sections[0] : null;
}

// Word·PDF 이력서는 '06  경력 | 최근 역할 중심'처럼 번호·기호·괄호·부제를 붙인다. 이를 떼고 제목 이름만 비교한다.
function headingOf(text: string): Section | null {
  const trimmed = text.replace(BULLETS, '').trim();
  const bracket = BRACKETED.exec(trimmed);
  const formatted = bracket !== null || SECTION_NUMBER.test(trimmed);
  const core = (bracket ? bracket[1] : trimmed.replace(SECTION_NUMBER, '').replace(LIST_NUMBER, ''))
    .split(/\s*[|(（]/)[0].replace(/[:：]\s*$/, '').trim();
  const named = namedHeading(core);
  if (named) return named;
  // 제목 서식이 분명한 짧은 줄은 이름을 몰라도 새 구역이다. 앞 구역(머리글 포함)에 계속 묶이지 않게 '기타' 구역으로 연다.
  if (formatted && core.length > 0 && core.length <= 30 && !SENTENCE_END.test(core)) return 'other';
  return null;
}

// PDF 줄바꿈으로 끊긴 문장을 한 구간으로 합친다. 근거 quote는 줄바꿈을 포함한 원문 그대로다.
type Segment = { text: string; start: number; end: number; quote: string };

function segments(page: SourcePage): Segment[] {
  const chars = Array.from(page.text);
  const quoteOf = (start: number, end: number) => chars.slice(start, end).join('');
  const lines = splitLines(page.text).filter(line => line.text.length > 0);
  const result: Segment[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const next: Line | undefined = lines[index + 1];
    const wrapped = next && line.text.length >= 30 && !/[.!?。:)]$|다$/.test(line.text)
      && next.text.length <= 20 && /[.!?。]$/.test(next.text) && !headingOf(next.text);
    if (wrapped) {
      const joiner = /[가-힣]$/.test(line.text) && /^[가-힣]/.test(next.text) ? '' : ' ';
      result.push({ text: line.text + joiner + next.text, start: line.start, end: next.end, quote: quoteOf(line.start, next.end) });
      index++;
    } else {
      result.push({ text: line.text, start: line.start, end: line.end, quote: line.text });
    }
  }
  return result;
}

// 소개 제목이 없는 이력서에서는 자동 줄바꿈 때문에 첫 구절만 머리글로 빠질 수 있다.
function wrappedHeaderSummary(page: SourcePage, segments: Segment[], index: number): { segment: Segment; last: number } | null {
  const first = segments[index];
  const listItem = (quote: string) => LEADING_BULLET.test(quote) || LIST_NUMBER.test(quote);
  if (first.text.length <= 40 || !CLAUSE_CONTINUES.test(first.text) || DATE_RANGE.test(first.quote) || listItem(first.quote)) return null;

  let text = first.text;
  for (let at = index + 1; at < segments.length; at++) {
    const next = segments[at];
    if (headingOf(next.text) || listItem(next.quote) || DATE_RANGE.test(next.quote)) return null;
    const gap = codePointSlice(page.text, segments[at - 1].end, next.start);
    if (!/^[^\S\n]*\n[^\S\n]*$/.test(gap) || /\n\s*\n/.test(next.quote)) return null;

    text += ` ${next.text}`;
    if (text.length > FACT_LIMITS.maxStatement || EMAIL.test(text) || PHONE.test(text) || PREFERENCE.test(text) || NEGATION.test(text)) return null;
    if (SENTENCE_END.test(next.text)) {
      return { segment: { text, start: first.start, end: next.end, quote: codePointSlice(page.text, first.start, next.end) }, last: at };
    }
    if (!CLAUSE_CONTINUES.test(next.text)) return null;
  }
  return null;
}

type Collector = { facts: ResumeFact[]; warnings: ExtractionWarning[] };

// 확정 요청 한도(FACT_LIMITS.maxFacts)와 같다. 넘는 후보는 만들지 않고 한 번 경고한다.
const MAX_CANDIDATES = 300;

function addFact(out: Collector, documentId: string, page: number | null, category: FactCategory, statement: string, start: number, end: number, quote: string) {
  if (out.facts.length >= MAX_CANDIDATES) {
    if (!out.warnings.some(item => item.code === 'CANDIDATE_LIMIT_REACHED')) out.warnings.push({ code: 'CANDIDATE_LIMIT_REACHED', page: null, start: null, end: null, message: `후보가 ${MAX_CANDIDATES}개를 넘어 이후 줄은 자동으로 만들지 않았습니다. 필요한 줄은 원문에서 직접 추가하세요.` });
    return;
  }
  const id = `fact_${String(out.facts.length + 1).padStart(3, '0')}`;
  out.facts.push({ id, category, statement, evidence: [{ kind: 'document', document_id: documentId, page, start, end, quote }] });
}

function warn(out: Collector, code: ExtractionWarning['code'], page: number | null, segment: Segment, message: string) {
  out.warnings.push({ code, page, start: segment.start, end: segment.end, message });
}

// 원문 위치를 유지한 채 구간 일부(code point from..to)를 떼어 낸다.
function slice(segment: Segment, from: number, to: number): Segment {
  const quote = Array.from(segment.quote).slice(from, to).join('');
  return { text: quote.replace(/\s*\n\s*/g, ' '), start: segment.start + from, end: segment.start + to, quote };
}

function withoutBullet(segment: Segment): Segment {
  const match = LEADING_BULLET.exec(segment.quote);
  if (!match) return segment;
  const length = Array.from(match[0]).length;
  return { ...slice(segment, length, Array.from(segment.quote).length), text: segment.text.replace(LEADING_BULLET, '') };
}

// 첫 구분자에서 둘로 나눈다. 구분자가 없으면 [전체, null].
function splitPair(segment: Segment): [Segment, Segment | null] {
  const match = PAIR_SEPARATOR.exec(segment.quote);
  if (!match) return [segment, null];
  const total = Array.from(segment.quote).length;
  const leftEnd = Array.from(segment.quote.slice(0, match.index)).length;
  const rightStart = leftEnd + Array.from(match[0]).length;
  return [slice(segment, 0, leftEnd), rightStart < total ? slice(segment, rightStart, total) : null];
}

function addSegment(out: Collector, documentId: string, page: number | null, category: FactCategory, segment: Segment) {
  addFact(out, documentId, page, category, segment.text, segment.start, segment.end, segment.quote);
}

function addSkills(out: Collector, documentId: string, page: number | null, segment: Segment) {
  const chars = Array.from(segment.quote);
  const labelEnd = chars.findIndex(char => char === ':' || char === '：');
  // '프론트엔드  React, …'처럼 탭·두 칸 공백으로 띄운 한글 분류명은 기술 이름이 아니다.
  const spacedLabel = /^[^,，·•/|\s][^,，•/|]{0,11}?(\t|\s{2,})/.exec(segment.quote);
  let tokenStart = labelEnd >= 0 && labelEnd < 20 ? labelEnd + 1 : spacedLabel && /[가-힣]/.test(spacedLabel[0]) ? Array.from(spacedLabel[0]).length : 0;
  for (let index = tokenStart; index <= chars.length; index++) {
    // CI/CD·TCP/IP처럼 공백 없이 붙은 '/'는 기술 이름의 일부로 본다.
    const slashInsideName = chars[index] === '/' && !/\s/.test(chars[index - 1] ?? ' ') && !/\s/.test(chars[index + 1] ?? ' ');
    if (index < chars.length && (!/[,，·•/|]/.test(chars[index]) || slashInsideName)) continue;
    let start = tokenStart, end = index;
    while (start < end && /\s/.test(chars[start])) start++;
    while (end > start && /\s/.test(chars[end - 1])) end--;
    const token = chars.slice(start, end).join('');
    if (token.length > 40) {
      out.warnings.push({ code: 'UNCLASSIFIED_LINE', page, start: segment.start + start, end: segment.start + end, message: '기술 이름으로 보기에 긴 문장이라 자동 분류하지 않았습니다. 경력이면 원문에서 직접 추가하세요.' });
    } else if (token.length >= 1) {
      addFact(out, documentId, page, 'skill', token, segment.start + start, segment.start + end, token);
    }
    tokenStart = index + 1;
  }
}

// 기간 줄 바로 다음 줄의 해석 상태. 표 경력란은 '기간' 줄 다음에 '회사 · 직위', 회사 줄 다음에 '팀 직위 | 역할'을 둔다.
type After = 'period_only' | 'employer_period' | null;

function addExperienceLine(out: Collector, documentId: string, page: number | null, segment: Segment): After {
  const match = DATE_RANGE.exec(segment.quote);
  if (!match) {
    addSegment(out, documentId, page, MEASURED.test(segment.text) ? 'achievement' : 'responsibility', segment);
    return null;
  }
  const chars = Array.from(segment.quote);
  const dateStart = Array.from(segment.quote.slice(0, match.index)).length;
  const dateEnd = dateStart + Array.from(match[0]).length;
  let employerEnd = dateStart;
  while (employerEnd > 0 && /[\s|,·\-–(]/.test(chars[employerEnd - 1])) employerEnd--;
  const employer = chars.slice(0, employerEnd).join('');
  if (employer.length > 0) addFact(out, documentId, page, 'employer', employer, segment.start, segment.start + employerEnd, employer);
  addFact(out, documentId, page, 'period', match[0], segment.start + dateStart, segment.start + dateEnd, match[0]);
  let restStart = dateEnd;
  while (restStart < chars.length && /[\s|,·\-–)]/.test(chars[restStart])) restStart++;
  if (restStart < chars.length) {
    out.warnings.push({ code: 'UNCLASSIFIED_LINE', page, start: segment.start + restStart, end: segment.start + chars.length, message: '기간 뒤 내용은 자동 분류하지 않았습니다. 직무 등 경력이면 원문에서 직접 추가하세요.' });
  }
  return employer.length > 0 ? 'employer_period' : 'period_only';
}

// 기간 줄 다음의 짧은 줄을 회사·직위·역할로 나눈다. 문장·글머리표·기간 줄이면 일반 업무 줄로 둔다.
function addFollowUp(out: Collector, documentId: string, page: number | null, after: After, segment: Segment, bulleted: boolean): boolean {
  if (!after || bulleted || segment.text.length > 80 || SENTENCE_END.test(segment.text) || DATE_RANGE.test(segment.quote)) return false;
  const [left, right] = splitPair(segment);
  if (after === 'period_only') {
    if (segment.text.length > 40) return false;
    addSegment(out, documentId, page, 'employer', left);
    if (right) addSegment(out, documentId, page, 'role', right);
    return true;
  }
  if (right) {
    addSegment(out, documentId, page, 'role', left);
    addSegment(out, documentId, page, MEASURED.test(right.text) ? 'achievement' : 'responsibility', right);
    return true;
  }
  if (segment.text.length <= 30 && (POSITION.test(segment.text) || ROLE_TITLE.test(segment.text))) {
    addSegment(out, documentId, page, 'role', segment);
    return true;
  }
  return false;
}

const SECTION_CATEGORY: Partial<Record<Section, FactCategory>> = {
  summary: 'other', projects: 'responsibility', education: 'education',
  certification: 'certification', achievements: 'achievement',
};

function classify(out: Collector, documentId: string, page: number | null, section: Section, raw: Segment, after: After): After {
  const bulleted = LEADING_BULLET.test(raw.quote);
  const segment = withoutBullet(raw);
  if (TABLE_LABEL.test(segment.text.trim())) {
    warn(out, 'UNCLASSIFIED_LINE', page, segment, '표 머리 줄(열 이름)로 보여 경력 항목으로 만들지 않았습니다.');
    return after;
  }
  if (EMAIL.test(segment.text) || PHONE.test(segment.text)) {
    warn(out, 'PERSONAL_INFO_EXCLUDED', page, segment, '연락처 줄은 경력 사실과 검색 질의에서 제외했습니다.');
  } else if (section === 'preferences' || PREFERENCE.test(segment.text)) {
    warn(out, 'PREFERENCE_NOT_FACT', page, segment, '희망 조건은 경력 사실이 아닙니다. 검색 조건에서 따로 입력하세요.');
  } else if (section === 'unverified' || NEGATION.test(segment.text)) {
    warn(out, 'NEGATED_OR_UNVERIFIED', page, segment, '부정·미확인 표현이 있어 보유 경력 후보로 만들지 않았습니다. 필요하면 원문에서 직접 추가하세요.');
  } else if (section === 'header') {
    // 제목을 하나도 찾지 못한 문서라도 기간이 있는 줄은 회사·기간 후보로 만든다(전체가 머리글로 남아 후보 0건이 되지 않게).
    if (DATE_RANGE.test(segment.quote)) return addExperienceLine(out, documentId, page, segment);
    if (ROLE_TITLE.test(segment.text) && segment.text.length <= 40) addSegment(out, documentId, page, 'role', segment);
    // 이름·연락처가 아닌 긴 소개 문장은 요약 후보로 둔다(이름은 짧고, 연락처는 위에서 걸렀다).
    else if (segment.text.length > 40 && SENTENCE_END.test(segment.text)) addSegment(out, documentId, page, 'other', segment);
    else warn(out, 'UNCLASSIFIED_LINE', page, segment, '머리글 줄은 분류하지 않았습니다(이름 등 개인정보일 수 있음).');
  } else if (section === 'skills') {
    addSkills(out, documentId, page, segment);
  } else if (section === 'experience') {
    if (addFollowUp(out, documentId, page, after, segment, bulleted)) return null;
    return addExperienceLine(out, documentId, page, segment);
  } else {
    const category = section === 'projects' && MEASURED.test(segment.text) ? 'achievement' : SECTION_CATEGORY[section] ?? 'other';
    addSegment(out, documentId, page, category, segment);
  }
  return null;
}

export function extractCandidates(source: SourceText, documentId: string): Collector {
  const out: Collector = { facts: [], warnings: [] };
  let section: Section = 'header';
  let after: After = null;
  for (const page of source.pages) {
    const parts = segments(page);
    for (let index = 0; index < parts.length; index++) {
      const segment = parts[index];
      const heading = headingOf(segment.text);
      if (heading) { section = heading; after = null; continue; }
      const summary = section === 'header' ? wrappedHeaderSummary(page, parts, index) : null;
      if (summary) {
        after = classify(out, documentId, page.page, section, summary.segment, after);
        index = summary.last;
        continue;
      }
      after = classify(out, documentId, page.page, section, segment, after);
    }
  }
  const hasText = source.pages.some(page => page.text.trim().length > 0);
  if (!hasText) out.warnings.push({ code: 'EMPTY_TEXT', page: null, start: null, end: null, message: '텍스트를 읽지 못했습니다. 스캔 이미지 PDF라면 내용을 붙여넣어 주세요.' });
  else if (out.facts.length === 0) out.warnings.push({ code: 'NO_FACT_CANDIDATES', page: null, start: null, end: null, message: '자동으로 찾은 경력 후보가 없습니다. 원문에서 직접 항목을 추가하세요.' });
  return out;
}
