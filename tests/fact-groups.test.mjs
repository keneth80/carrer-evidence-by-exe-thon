import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factGroups } from '../packages/tailor/src/fact-groups.ts';
import { applyStructure, MASKED_LINE, structureContext, structureLines } from '../packages/resume/src/structure.ts';
import { extractionStep } from '../apps/web/src/resume/extraction-step.ts';
import { buildStructureRequest, STRUCTURE_SCHEMA } from '../packages/liner/src/structure.ts';

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

test('structure output only changes category and position, never text, evidence or count', () => {
  const facts = [
    fact('a', 'other', '프론트엔드 리드'), fact('b', 'other', '서울 강남구'), fact('c', 'other', '예시랩'),
    fact('d', 'responsibility', '화면 구조를 다시 설계했습니다.'), fact('e', 'employer', '예시페이'),
    fact('f', 'responsibility', '예시랩에서 디자인 시스템을 만들었습니다.'), fact('g', 'education', '예시대학교'),
  ];
  const output = { items: [
    { n: 0, category: 'role', under: 2 }, { n: 1, category: 'location', under: 2 }, { n: 2, category: 'employer', under: null },
    { n: 5, category: 'responsibility', under: 2 },
    { n: 6, category: 'education', under: 99 }, { n: 42, category: 'role', under: null }, { n: 3, category: 'wizard', under: null }, { n: 0, category: 'skill', under: null },
    // 회사 줄이 아닌 곳으로는 옮기지 않는다.
    { n: 3, category: 'responsibility', under: 5 },
  ] };
  const result = applyStructure(facts, output);
  assert.deepEqual(result.facts.map(item => [item.id, item.category]), [
    ['c', 'employer'], ['a', 'role'], ['b', 'location'], ['d', 'responsibility'], ['f', 'responsibility'], ['e', 'employer'], ['g', 'education'],
  ]);
  assert.equal(result.changed, 3);
  assert.equal(result.moved, 3);
  assert.deepEqual(result.facts.map(item => item.statement).sort(), facts.map(item => item.statement).sort());
  for (const item of result.facts) assert.deepEqual(item.evidence, facts.find(original => original.id === item.id).evidence);
  assert.deepEqual(factGroups(result.facts)[0].indexes, [0, 1, 2, 3, 4]);
});

test('malformed structure output leaves facts untouched', () => {
  const facts = [fact('a', 'employer', '예시랩'), fact('b', 'role', '개발자')];
  for (const output of [null, undefined, 'text', {}, { items: 'x' }, { items: [null, { n: '0', category: 'role', under: null }, { n: 1.5, category: 'role', under: null }] }]) {
    assert.equal(applyStructure(facts, output).facts, facts);
  }
  assert.equal(applyStructure(facts, { items: [{ n: 1, category: 'role', under: 1 }, { n: 0, category: 'employer', under: 1 }] }).facts, facts);
});

test('structure request sends line numbers with contact details masked and a strict schema', () => {
  const request = buildStructureRequest(structureLines([fact('a', 'other', '문의 kim@example.com 010-1234-5678'), fact('b', 'employer', '예시랩')]), 'balanced');
  const body = JSON.stringify(request);
  assert.ok(!body.includes('kim@example.com') && !body.includes('010-1234-5678'));
  assert.ok(!body.includes('"id"'));
  assert.equal(request.response_format.json_schema.schema, STRUCTURE_SCHEMA);
  assert.deepEqual(STRUCTURE_SCHEMA.properties.items.items.required, ['n', 'action', 'category', 'under', 'parts']);
});

// 형식이 특이한 이력서 정리(S1-31): 잇기·나누기·빼기·살리기는 원문에 글자 그대로 있을 때만 적용한다.
const TEXT = ['홍예시', 'hong@example.com', '경력사항', '예시랩 프론트엔드 리드 2020.01 ~ 2023.02', '결제 화면을 다시 설계해 이탈률을', '12%에서 7%로 줄였습니다.', '디자인 시스템을 만들었습니다.', '', '사내 강의 3회 진행', 'Page 1'].join('\n');
const SOURCE = { input_kind: 'pasted_text', pages: [{ page: null, text: TEXT }] };
const at = (id, category, quote) => { const start = Array.from(TEXT.slice(0, TEXT.indexOf(quote))).length; return { id, category, statement: quote, evidence: [{ kind: 'document', document_id: 'doc_1', page: null, start, end: start + Array.from(quote).length, quote }] }; };
const LINES = [
  at('h', 'other', '경력사항'), at('m', 'employer', '예시랩 프론트엔드 리드 2020.01 ~ 2023.02'),
  at('a', 'responsibility', '결제 화면을 다시 설계해 이탈률을'), at('b', 'responsibility', '12%에서 7%로 줄였습니다.'),
  at('c', 'responsibility', '디자인 시스템을 만들었습니다.'), at('p', 'other', 'Page 1'),
];
const keep = (n, category, extra = {}) => ({ n, action: 'keep', category, under: null, parts: null, ...extra });

test('join, split and drop keep every statement verbatim in the source', () => {
  const output = { items: [
    keep(0, 'other', { action: 'drop' }), keep(5, 'other', { action: 'drop' }),
    keep(1, 'employer', { action: 'split', parts: [{ text: '예시랩', category: 'employer' }, { text: '프론트엔드 리드', category: 'role' }, { text: '2020.01 ~ 2023.02', category: 'period' }] }),
    keep(3, 'achievement', { action: 'join' }),
  ] };
  const result = applyStructure(LINES, output, SOURCE);
  assert.deepEqual(result.facts.map(item => [item.category, item.statement]), [
    ['employer', '예시랩'], ['role', '프론트엔드 리드'], ['period', '2020.01 ~ 2023.02'],
    ['achievement', '결제 화면을 다시 설계해 이탈률을 12%에서 7%로 줄였습니다.'], ['responsibility', '디자인 시스템을 만들었습니다.'],
  ]);
  assert.deepEqual([result.joined, result.split, result.dropped.map(item => item.id)], [1, 1, ['h', 'p']]);
  const chars = Array.from(TEXT);
  for (const item of result.facts) {
    const [evidence] = item.evidence;
    assert.equal(chars.slice(evidence.start, evidence.end).join(''), evidence.quote);
    assert.ok(evidence.quote.replace(/\s+/g, '').includes(item.statement.replace(/\s+/g, '')));
  }
  assert.equal(new Set(result.facts.map(item => item.id)).size, result.facts.length);
});

test('operations that would invent or hide text are ignored', () => {
  // 원문에 없는 조각, 빈 줄을 건너뛴 잇기, 원문 없이 잇기, 과한 빼기.
  const invented = applyStructure(LINES, { items: [keep(1, 'employer', { action: 'split', parts: [{ text: '예시랩', category: 'employer' }, { text: '시니어 리드', category: 'role' }] })] }, SOURCE);
  assert.equal(invented.facts, LINES);
  const gap = [LINES[4], at('x', 'other', '사내 강의 3회 진행')];
  assert.equal(applyStructure(gap, { items: [keep(1, 'other', { action: 'join' })] }, SOURCE).joined, 0);
  assert.equal(applyStructure(LINES, { items: [keep(3, 'responsibility', { action: 'join' })] }).joined, 0);
  const greedy = applyStructure(LINES, { items: [0, 2, 4, 5].map(n => keep(n, 'other', { action: 'drop' })) }, SOURCE);
  assert.deepEqual([greedy.dropped.length, greedy.facts.length], [0, LINES.length]);
  assert.equal(applyStructure(LINES, { items: [keep(2, 'other', { action: 'rewrite' })] }, SOURCE).facts, LINES);
});

test('whole source is sent with contact and header lines masked; only unclassified lines can be rescued', () => {
  const warn = (code, quote, message = 'x') => { const start = Array.from(TEXT.slice(0, TEXT.indexOf(quote))).length; return { code, page: null, start, end: start + Array.from(quote).length, message }; };
  const warnings = [warn('UNCLASSIFIED_LINE', '홍예시', '머리글 줄은 분류하지 않았습니다(이름 등 개인정보일 수 있음).'), warn('PERSONAL_INFO_EXCLUDED', 'hong@example.com'), warn('UNCLASSIFIED_LINE', '사내 강의 3회 진행'), warn('NEGATED_OR_UNVERIFIED', 'Page 1')];
  const facts = LINES.slice(0, 5);
  const context = structureContext(SOURCE, facts, warnings);
  assert.deepEqual(context.source.slice(0, 3).map(line => line.text), [MASKED_LINE, MASKED_LINE, '경력사항']);
  assert.deepEqual(context.unclassified.map(line => [line.w, line.text]), [[0, '사내 강의 3회 진행']]);
  assert.deepEqual(context.factLine, [2, 3, 4, 5, 6]);
  const body = JSON.stringify(buildStructureRequest(structureLines(facts), 'balanced', context));
  assert.ok(body.includes('디자인 시스템을 만들었습니다.') && !body.includes('홍예시') && !body.includes('hong@example.com'));

  const result = applyStructure(facts, { items: [], adds: [{ w: 0, category: 'achievement', under: 1 }, { w: 7, category: 'role', under: null }, { w: 0, category: 'role', under: null }] }, SOURCE, context.unclassified, 'doc_1');
  assert.deepEqual(result.added.map(line => line.text), ['사내 강의 3회 진행']);
  const rescued = result.facts.at(-1);
  assert.deepEqual([rescued.category, rescued.statement, rescued.evidence[0].quote], ['achievement', '사내 강의 3회 진행', '사내 강의 3회 진행']);
  assert.equal(Array.from(TEXT).slice(rescued.evidence[0].start, rescued.evidence[0].end).join(''), '사내 강의 3회 진행');
  assert.equal(applyStructure(facts, { items: [], adds: [{ w: 0, category: 'achievement', under: null }] }, SOURCE).facts, facts, 'no rescue without the unclassified list');
});

test('extraction progress step follows the real task state', () => {
  const step = (state, provider_transmission) => extractionStep({ state, provider_transmission });
  assert.deepEqual([extractionStep(null), step('queued', 'not_dispatched'), step('running', 'not_dispatched'), step('running', 'dispatched'), step('running', 'completed'), step('running', 'unknown'), step('running', undefined)], [0, 0, 0, 1, 2, 2, 0]);
});
