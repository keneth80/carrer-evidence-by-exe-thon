import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factGroups } from '../packages/tailor/src/fact-groups.ts';
import { sectionTitles } from '../packages/resume/src/sections.ts';
import { composeFacts, MASKED_LINE, sourceLines, UNUSED_NOTE } from '../packages/resume/src/structure.ts';
import { extractionStep } from '../apps/web/src/resume/extraction-step.ts';
import { buildStructureRequest, parseComposeLines, STRUCTURE_SCHEMA } from '../packages/liner/src/structure.ts';

// 사용자 테스트(2026-11-21): 추출 확인 화면에서 회사명·직무·근무지역이 따로 체크박스로 나와 보기 힘들었다.
// 회사·프로젝트·학력 등으로 묶고, 모델은 분류와 속한 회사만 고친다. 합성 경력만 쓴다.

const fact = (id, category, statement) => ({ id, category, statement, evidence: [{ kind: 'document', document_id: 'doc_1', page: null, start: 0, end: 1, quote: statement }] });
const FACTS = [
  fact('f0', 'other', '결제 서비스를 만들어 온 개발자입니다.'),
  fact('f1', 'location', '서울'),
  fact('f2', 'achievement', '정산 시간을 30% 줄였습니다.'),
  fact('f3', 'employer', '가나 주식회사'),
  fact('f4', 'period', '2021.03 - 현재'),
  fact('f5', 'responsibility', '결제 API를 설계했습니다.'),
  fact('f6', 'role', '백엔드 리드'),
  fact('f7', 'location', '경기 성남시'),
  fact('f8', 'period', '2018.01 - 2021.02'),
  fact('f9', 'employer', '다라 주식회사'),
  fact('f10', 'achievement', '배포 시간을 절반으로 줄였습니다.'),
  fact('f11', 'skill', 'Kotlin'),
  fact('f12', 'other', '모아보기 | 개인 프로젝트'),
  fact('f13', 'responsibility', '혼자 기획하고 만들었습니다.'),
  fact('f14', 'education', '예시대학교 컴퓨터공학과'),
  fact('f15', 'skill', 'Kafka'),
  fact('f16', 'other', '직접 추가한 줄'),
];
const ids = group => group.indexes.map(index => FACTS[index].id);

test('facts are grouped by employer, project and section; meta lines lead each employer group', () => {
  const groups = factGroups(FACTS);
  assert.deepEqual(groups.map(group => [group.kind, group.title, ids(group)]), [
    ['basic', '기본 정보·소개', ['f0', 'f1']],
    ['results', '주요 성과', ['f2']],
    ['employer', '가나 주식회사 · 2021.03 - 현재', ['f3', 'f6', 'f4', 'f7', 'f5']],
    ['employer', '다라 주식회사 · 2018.01 - 2021.02', ['f9', 'f8', 'f10']],
    ['section', '기술', ['f11', 'f15']],
    ['project', '모아보기 | 개인 프로젝트', ['f12', 'f13']],
    ['section', '학력', ['f14']],
    ['etc', '기타', ['f16']],
  ]);
  assert.equal(groups.flatMap(group => group.indexes).length, FACTS.length);
});

test('no employer or empty input does not throw and keeps every fact once', () => {
  assert.deepEqual(factGroups([]), []);
  const loose = [fact('a', 'role', '디자이너'), fact('b', 'skill', 'Figma')];
  assert.deepEqual(factGroups(loose).map(group => [group.title, group.indexes]), [['기타', [0]], ['기술', [1]]]);
});

// 항목 구성(S1-32): 모델은 원문 줄 범위와 분류만 정한다. 문장은 원문 그대로이고, 원문에 없는 글자·가린 줄·막힌 줄은 항목이 되지 않는다.
const TEXT = ['홍예시', 'hong@example.com', '대표 성과', '30 만 건', '40 분 → 5 분', '정산 자동화', '경력사항', '예시랩 프론트엔드 리드 2020.01 ~ 2023.02', '결제 화면을 다시 설계해 이탈률을', '12%에서 7%로 줄였습니다.', '', 'Spark 경험은 없습니다.', '- 1 / 1 -'].join('\n');
const SOURCE = { input_kind: 'pasted_text', pages: [{ page: null, text: TEXT }] };
const warn = (code, quote, message = 'x') => { const start = Array.from(TEXT.slice(0, TEXT.indexOf(quote))).length; return { code, page: null, start, end: start + Array.from(quote).length, message }; };
const WARNINGS = [warn('UNCLASSIFIED_LINE', '홍예시', '머리글 줄은 분류하지 않았습니다(이름 등 개인정보일 수 있음).'), warn('PERSONAL_INFO_EXCLUDED', 'hong@example.com'), warn('NEGATED_OR_UNVERIFIED', 'Spark 경험은 없습니다.')];
const LINES = sourceLines(SOURCE, WARNINGS);
const item = (from, to, category, text = null) => ({ from, to, text, category });

test('whole source goes out as one text with contact and header lines masked and unverified lines marked', () => {
  assert.deepEqual(LINES.map(line => line.state), ['hidden', 'hidden', 'open', 'open', 'open', 'open', 'open', 'open', 'open', 'open', 'blocked', 'open']);
  const request = buildStructureRequest(LINES, 'balanced');
  const body = request.messages[1].content;
  assert.ok(body.includes('3|30 만 건\n4|40 분 → 5 분') && body.includes(`0|${MASKED_LINE}`) && body.includes('10|✕ Spark'));
  assert.ok(!JSON.stringify(request).includes('홍예시') && !JSON.stringify(request).includes('hong@example.com'));
  assert.equal(request.response_format.json_schema.schema, STRUCTURE_SCHEMA);
  // 응답은 짧은 줄 글로 받는다. 형식이 다른 줄은 버린다.
  assert.deepEqual(parseComposeLines({ items: ['3-5|achievement', '7|employer|예시랩', ' 8 - 9 | achievement ', '7|period|2020.01 ~ 2023.02', 'nonsense', '4|', 12, null] }).items, [
    item(3, 5, 'achievement'), item(7, 7, 'employer', '예시랩'), item(8, 9, 'achievement'), item(7, 7, 'period', '2020.01 ~ 2023.02'),
  ]);
  assert.deepEqual(parseComposeLines('x').items, []);
});

test('items are source line ranges: card fragments and wrapped sentences join, a packed line splits, all verbatim', () => {
  const output = { items: [
    item(3, 5, 'achievement'),
    item(7, 7, 'employer', '예시랩'), item(7, 7, 'role', '프론트엔드 리드'), item(7, 7, 'period', '2020.01 ~ 2023.02'),
    item(8, 9, 'achievement'),
  ] };
  const result = composeFacts(SOURCE, LINES, output, 'doc_1');
  assert.deepEqual(result.facts.map(fact => [fact.category, fact.statement]), [
    ['achievement', '30 만 건 40 분 → 5 분 정산 자동화'],
    ['employer', '예시랩'], ['role', '프론트엔드 리드'], ['period', '2020.01 ~ 2023.02'],
    ['achievement', '결제 화면을 다시 설계해 이탈률을 12%에서 7%로 줄였습니다.'],
  ]);
  const chars = Array.from(TEXT);
  for (const fact of result.facts) {
    const [evidence] = fact.evidence;
    assert.equal(chars.slice(evidence.start, evidence.end).join(''), evidence.quote);
    assert.equal(evidence.quote.replace(/\s+/g, ''), fact.statement.replace(/\s+/g, ''));
  }
  assert.deepEqual(result.facts.map(fact => fact.id), ['fact_001', 'fact_002', 'fact_003', 'fact_004', 'fact_005']);
  // 조각 순서가 원문과 달라도(회사 → 기간 → 직함) 모두 살리고, 같은 글자를 두 번 쓰지는 못한다.
  const reordered = composeFacts(SOURCE, LINES, { items: [item(3, 5, 'achievement'), item(8, 9, 'achievement'), item(7, 7, 'period', '2020.01 ~ 2023.02'), item(7, 7, 'employer', '예시랩'), item(7, 7, 'role', '프론트엔드 리드'), item(7, 7, 'other', '예시랩')] }, 'doc_1');
  assert.deepEqual(reordered.facts.slice(2).map(fact => [fact.category, fact.statement]), [['period', '2020.01 ~ 2023.02'], ['employer', '예시랩'], ['role', '프론트엔드 리드']]);
  // 제목·쪽 번호처럼 넣지 않은 줄은 버리지 않고 돌려준다(화면에서 다시 넣을 수 있다).
  assert.deepEqual(result.unused.map(line => line.text), ['대표 성과', '경력사항', '- 1 / 1 -']);
});

test('items that invent text, reuse a line, or touch masked and unverified lines are dropped', () => {
  const good = [item(3, 5, 'achievement'), item(8, 9, 'achievement'), item(7, 7, 'employer')];
  const bad = [
    item(0, 0, 'other'), item(10, 10, 'skill'), item(9, 10, 'achievement'),       // 가린 줄, 막힌 줄, 막힌 줄을 낀 범위
    item(4, 4, 'achievement'), item(7, 7, 'role', '시니어 리드'),                    // 이미 쓴 줄, 줄에 없는 글자
    item(6, 2, 'other'), item(99, 99, 'other'), item(6, 6, 'wizard'), null, item('6', 6, 'other'),
  ];
  const result = composeFacts(SOURCE, LINES, { items: [...good, ...bad] }, 'doc_1');
  assert.equal(result.facts.length, 3);
  assert.ok(!result.facts.some(fact => /홍예시|Spark|시니어/.test(fact.statement)));
});

test('unusable model output is rejected so the caller keeps the rule result', () => {
  for (const output of [null, 'text', {}, { items: 'x' }, { items: [] }, { items: [item(11, 11, 'other')] }]) assert.equal(composeFacts(SOURCE, LINES, output, 'doc_1'), null);
});

test('extraction progress step follows the real task state', () => {
  const step = (state, provider_transmission) => extractionStep({ state, provider_transmission });
  assert.deepEqual([extractionStep(null), step('queued', 'not_dispatched'), step('running', 'not_dispatched'), step('running', 'dispatched'), step('running', 'completed'), step('running', 'unknown'), step('running', undefined)], [0, 0, 0, 1, 2, 2, 0]);
});

// 구역 제목으로 나누기(S1-33): 모델이 뺀 제목 줄을 찾아, 회사·프로젝트에 속하지 않는 '기타' 항목을 제목별 묶음으로 보여 준다.
test('other items are grouped under the source heading above them instead of one catch-all group', () => {
  const text = ['경력사항', '예시랩', '결제 화면을 만들었습니다.', '- 1 / 2 -', '[ 업무 접근 방식 ]', '문제를 먼저 정의합니다.', '작게 나눠 확인합니다.', '강점', '꾸준히 기록합니다.'].join('\n');
  const source = { input_kind: 'pasted_text', pages: [{ page: null, text }] };
  const spot = quote => Array.from(text.slice(0, text.indexOf(quote))).length;
  const make = (id, category, quote) => ({ id, category, statement: quote, evidence: [{ kind: 'document', document_id: 'd', page: null, start: spot(quote), end: spot(quote) + Array.from(quote).length, quote }] });
  const unused = quote => `UNCLASSIFIED_LINE@text:${spot(quote)}-${spot(quote) + Array.from(quote).length} ${UNUSED_NOTE}입니다(제목·장식 등).`;
  const facts = [make('e', 'employer', '예시랩'), make('r', 'responsibility', '결제 화면을 만들었습니다.'), make('a', 'other', '문제를 먼저 정의합니다.'), make('b', 'other', '작게 나눠 확인합니다.'), make('c', 'other', '꾸준히 기록합니다.')];
  const warnings = [unused('경력사항'), unused('- 1 / 2 -'), unused('[ 업무 접근 방식 ]'), unused('강점'), 'PERSONAL_INFO_EXCLUDED@text:0-2 x'];
  const sections = sectionTitles(facts, source, warnings);
  assert.deepEqual(sections, ['경력사항', '경력사항', '업무 접근 방식', '업무 접근 방식', '강점']);
  assert.deepEqual(factGroups(facts, sections).map(group => [group.title, group.indexes]), [['예시랩', [0, 1]], ['업무 접근 방식', [2, 3]], ['강점', [4]]]);
  // 제목 정보가 없으면 예전처럼 마지막 회사에 붙는다(mock·규칙 결과).
  assert.deepEqual(factGroups(facts).map(group => group.indexes), [[0, 1, 2, 3, 4]]);
  assert.deepEqual(sectionTitles(facts, null, warnings), [null, null, null, null, null]);
});
