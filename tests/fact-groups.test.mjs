import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factGroups } from '../packages/tailor/src/fact-groups.ts';
import { applyStructure, structureLines } from '../packages/resume/src/structure.ts';
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
  assert.deepEqual(STRUCTURE_SCHEMA.properties.items.items.required, ['n', 'category', 'under']);
});
