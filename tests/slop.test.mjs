import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSlop } from '../packages/tailor/src/slop.ts';
import { screenChanges } from '../apps/worker/src/tailor-task.ts';

// S4-13 안티슬롭: AI가 새로 쓴 이력서 문장만 검사하고, 사용자 원문 표현은 허용한다.

const phrases = (text, allowed) => findSlop(text, allowed).map(item => item.phrase);

test('상투 문구·근거 없는 평가어·AI 연결 장치·줄표/느낌표/이모지를 찾는다', () => {
  assert.deepEqual(phrases('열정적으로 최선을 다해 성장하는 개발자입니다'), ['열정적', '최선을 다해', '성장하는 개발자']);
  assert.deepEqual(phrases('탁월한 설계로 성능을 극대화하고 성공적으로 출시했습니다'), ['탁월한', '극대화', '성공적으로']);
  assert.deepEqual(phrases('React뿐만 아니라 TypeScript도 사용했고, 이를 통해 품질을 높였습니다'), ['뿐만 아니라', '이를 통해']);
  assert.deepEqual(phrases('Leveraged React to drive impact'), ['Leveraged', 'impact']);
  assert.deepEqual(phrases('대시보드 구현 — 완료! 🚀'), ['—', '!', '🚀']);
  assert.equal(findSlop('열정')[0].kind, 'cliche');
  assert.equal(findSlop('탁월한')[0].kind, 'unbacked_praise');
});

test('사실 그대로의 짧은 문장은 통과한다', () => {
  for (const text of [
    '운영 대시보드의 화면 구조와 상태 관리를 담당했습니다.',
    'React와 TypeScript로 검색·목록·상세 화면을 구현했습니다.',
    'React · TypeScript · Storybook',
    '예시 프로덕트 A (가상 회사) | 2021.03 - 2026.10',
    '',
  ]) assert.deepEqual(findSlop(text), [], text);
});

test('사용자 원문에 이미 있는 표현은 사용자 표현으로 보고 허용한다(공백 차이 무시)', () => {
  assert.deepEqual(findSlop('우수 사원으로 뛰어난 성과', ['2023 뛰어난  성과 표창']), []);
  assert.deepEqual(phrases('뛰어난 협업과 탁월한 설계', ['뛰어난 협업']), ['탁월한']);
});

const facts = [
  { id: 'f_role', category: 'role', statement: '프론트엔드 개발자' },
  { id: 'f_react', category: 'skill', statement: 'React' },
  { id: 'f_duty', category: 'responsibility', statement: '운영 대시보드의 화면 구조와 상태 관리를 담당했습니다.' },
];
const blocks = [{ id: 'blk_duty', section: '경력 내용', text: '운영 대시보드의 화면 구조와 상태 관리를 담당했습니다.', fact_ids: ['f_duty'] }];
const change = after => ({ operation: 'replace', block_id: 'blk_duty', before: blocks[0].text, after, fact_ids: ['f_duty'], reason: '공고 맞춤', needs_fact_confirmation: false });

test('대화 제안 선별: 슬롭이 들어간 AI 제안은 문서에 넣지 않고 이유를 질문으로 남긴다', () => {
  const screened = screenChanges({ reply: '', questions: [], changes: [change('운영 대시보드의 화면 구조와 상태 관리를 성공적으로 담당했습니다.')] }, { blocks, facts, userMessage: '맞춰줘' });
  assert.deepEqual(screened.changes, []);
  assert.match(screened.questions[0], /성공적으로/);
  assert.match(screened.questions[0], /상투적·과장 표현/);
});

test('대화 제안 선별: 근거 문장 표현만 쓴 제안과 원문에 있던 표현은 통과한다', () => {
  const plain = change('운영 대시보드 화면 구조와 상태 관리를 담당했습니다.');
  assert.deepEqual(screenChanges({ reply: '', questions: [], changes: [plain] }, { blocks, facts, userMessage: '맞춰줘' }).changes, [plain]);
  const ownFacts = [...facts.slice(0, 2), { id: 'f_duty', category: 'responsibility', statement: '뛰어난 협업으로 운영 대시보드를 만들었습니다.' }];
  const ownBlocks = [{ ...blocks[0], text: ownFacts[2].statement }];
  const kept = { ...change('뛰어난 협업으로 운영 대시보드를 만들었습니다.'), before: ownBlocks[0].text };
  assert.equal(screenChanges({ reply: '', questions: [], changes: [{ ...kept, operation: 'replace', after: '운영 대시보드를 뛰어난 협업으로 만들었습니다.' }] }, { blocks: ownBlocks, facts: ownFacts, userMessage: '' }).changes.length, 1);
});

test('직무별 문장 패턴(S4-15): 직무군 선택, 나은 예시는 안티슬롭을 통과하고 수치를 만들지 않는다', async () => {
  const { ROLE_PATTERNS, roleFamilyOf, patternGuidance, patternsFor } = await import('../packages/tailor/src/patterns.ts');
  assert.equal(roleFamilyOf(['시니어 프론트엔드 엔지니어', 'React']), 'frontend');
  assert.equal(roleFamilyOf(['백엔드 개발자', 'Python', 'FastAPI']), 'backend');
  assert.equal(roleFamilyOf(['프로덕트 디자이너']), 'design');
  assert.equal(roleFamilyOf(['회계 담당']), 'general');
  for (const patterns of Object.values(ROLE_PATTERNS)) {
    assert.ok(patterns.examples.length >= 2, patterns.family);
    for (const example of patterns.examples) {
      assert.deepEqual(findSlop(example.better), [], `${patterns.family}: ${example.better}`);
      assert.ok(findSlop(example.weak).length > 0 || /전반|기여|크게|주도/.test(example.weak), `weak example shows a problem: ${example.weak}`);
      assert.ok(!/\d/.test(example.better), 'better examples add no numbers');
    }
  }
  const text = patternGuidance(patternsFor(['프론트엔드 개발자']));
  assert.match(text, /형식만 참고/);
  assert.match(text, /프론트엔드/);
});

test('평가어 활용형(뛰어납니다·탁월합니다·우수합니다)도 찾는다', () => {
  assert.deepEqual(findSlop('협업 능력이 뛰어납니다. 설계가 탁월합니다. 품질이 우수합니다.').map(item => item.phrase), ['뛰어납니다', '탁월합니다', '우수합니다']);
});
