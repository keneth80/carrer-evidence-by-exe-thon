import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factChange, findingProgress, isDuplicateFinding } from '../apps/web/src/resume/finding-state.ts';

// 사용자 테스트(2026-11-20): 보완 대화에서 '기존 항목 바꾸기'를 해도 위 점검 항목에 아무 표시가 없고,
// 바꾼 문장이 '대상:'에서 말없이 사라졌다(바꾼 문장은 새 id). 점검 시작 버전과 현재 버전을 비교해 반영 상태를 보여 준다.
// 합성 경력만 쓴다.

const fact = (id, statement) => ({ id, category: 'responsibility', statement, evidence: [] });
const START = [fact('a', '정산 화면을 개발했습니다.'), fact('b', '배포 시간을 줄였습니다.'), fact('c', '회고를 진행했습니다.')];
// b를 새 문장으로 바꾸고(같은 자리, 새 id), 새 항목 하나를 끝에 추가한 현재 버전.
const HEAD = [START[0], fact('fact_s1', '배포 시간을 30분에서 5분으로 줄였습니다.'), START[2], fact('fact_s2', '새로 추가한 문장입니다.')];

test('그대로인 항목·바뀐 항목(예전 문장 → 새 문장)·없는 항목을 구분한다', () => {
  assert.deepEqual(factChange('a', START, HEAD), { text: '정산 화면을 개발했습니다.', changed: false, replacedBy: null });
  assert.deepEqual(factChange('b', START, HEAD), { text: '배포 시간을 줄였습니다.', changed: true, replacedBy: '배포 시간을 30분에서 5분으로 줄였습니다.' });
  assert.equal(factChange('zzz', START, HEAD), null);
});

test('같은 id인데 문장이 고쳐졌으면 바뀐 것으로 본다. 지워졌으면 새 문장 없이 바뀜으로 표시한다', () => {
  const edited = [fact('a', '정산 화면을 React로 개발했습니다.'), START[1], START[2]];
  assert.deepEqual(factChange('a', START, edited), { text: '정산 화면을 개발했습니다.', changed: true, replacedBy: '정산 화면을 React로 개발했습니다.' });
  const removed = [START[0], START[2]];
  assert.deepEqual(factChange('b', START, removed), { text: '배포 시간을 줄였습니다.', changed: true, replacedBy: null });
});

test('시작 버전을 아직 못 불러왔으면 현재 버전 문장만 보여 준다', () => {
  assert.deepEqual(factChange('a', null, HEAD), { text: '정산 화면을 개발했습니다.', changed: false, replacedBy: null });
  assert.equal(factChange('b', null, HEAD), null);
});

test('점검 항목 반영 상태: 대상이 모두 바뀌면 반영함, 일부면 일부 반영, 대상이 없거나 그대로면 미반영', () => {
  assert.equal(findingProgress(['b'], START, HEAD), 'done');
  assert.equal(findingProgress(['a', 'b'], START, HEAD), 'partial');
  assert.equal(findingProgress(['a'], START, HEAD), 'open');
  assert.equal(findingProgress([], START, HEAD), 'open');
});

test('중복 정리 대상: 제목이 중복·반복을 말하고 대상 문장이 2개 이상일 때만', () => {
  assert.equal(isDuplicateFinding({ title: '40명 멘토링 내용이 두 번 나와요', fact_ids: ['a', 'b'] }), true);
  assert.equal(isDuplicateFinding({ title: '같은 내용이 여러 번 있어요', fact_ids: ['a', 'b', 'c'] }), true);
  assert.equal(isDuplicateFinding({ title: '비슷한 내용이 중복돼요', fact_ids: ['a', 'b'] }), true);
  assert.equal(isDuplicateFinding({ title: '40명 멘토링 내용이 두 번 나와요', fact_ids: ['a'] }), false, 'one target cannot be deduplicated');
  assert.equal(isDuplicateFinding({ title: '결과가 보이지 않아요', fact_ids: ['a', 'b'] }), false);
});
