import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRevisions, compareSummary, wordDiff } from '../apps/web/src/tailor/compare.ts';

// 공고 맞춤 수정 전후 비교(사용자 요청 2026-11-24, DECISIONS S4-17). 맞춤 편집 화면에서 처음 버전(확정 경력으로 만든 기본 이력서)과
// 지금 버전을 줄마다 비교하고, 적용한 수정안의 이유를 붙인다. 이유는 지금 문장과 같은 수정안에서만 가져온다.

const block = (id, section, text) => ({ id, section, text, fact_ids: [`fact_${id}`] });
const change = (operation, block_id, before, after, reason) => ({ operation, block_id, before, after, fact_ids: [], reason, needs_fact_confirmation: false });
const changed = segments => segments.filter(segment => segment.changed).map(segment => segment.text.trim());

test('word diff marks only the words that changed', () => {
  const diff = wordDiff('주문 화면의 상태 관리를 정리했습니다.', '공통 컴포넌트를 만들었습니다. 주문 화면의 상태 관리를 정리했습니다.');
  assert.deepEqual(changed(diff.before), []);
  assert.deepEqual(changed(diff.after), ['공통 컴포넌트를 만들었습니다.']);
  assert.equal(diff.after.map(segment => segment.text).join(''), '공통 컴포넌트를 만들었습니다. 주문 화면의 상태 관리를 정리했습니다.');
  const same = wordDiff('그대로인 문장', '그대로인 문장');
  assert.ok(same.before.every(segment => !segment.changed) && same.after.every(segment => !segment.changed));
  assert.deepEqual(wordDiff('', ''), { before: [], after: [] });
  assert.deepEqual(changed(wordDiff('', '새 문장').after), ['새 문장']);
});

const BASE = [
  block('s1', '요약', '예시 회사에서 화면 개발을 맡았습니다.'),
  block('k1', '기술', 'Vue, TypeScript'),
  block('k2', '기술', 'React, Next.js'),
  block('a1', '성과', '목록 화면 로딩을 5초에서 3초로 줄였습니다.'),
  block('a2', '성과', '배포 절차를 문서로 남겼습니다.'),
  block('a3', '성과', '신입 교육 자료를 만들었습니다.'),
];
const CURRENT = [
  block('new_1', '맞춤 요약', '코드 리뷰 기준을 정리했습니다.'),
  block('s1', '요약', '예시 회사에서 화면 개발을 맡았습니다.'),
  block('k2', '기술', 'React, Next.js'),
  block('k1', '기술', 'Vue, TypeScript'),
  block('a1', '성과', '목록 화면 로딩을 5초에서 3초로 줄였고 상태 관리를 정리했습니다.'),
  block('a3', '성과', '신입 교육 자료를 만들었습니다.'),
];
const ACCEPTED = {
  state: 'accepted',
  changes: [
    change('insert', 'new_1', null, '코드 리뷰 기준을 정리했습니다.', '필수 요건과 가까운 경험을 앞에 두었습니다.'),
    change('reorder', 'k2', null, null, '공고에 나온 기술을 앞으로 옮겼습니다.'),
    change('replace', 'a1', '목록 화면 로딩을 5초에서 3초로 줄였습니다.', '목록 화면 로딩을 5초에서 3초로 줄였고 상태 관리를 정리했습니다.', '공고 업무와 이어지게 했습니다.'),
    change('remove', 'a2', '배포 절차를 문서로 남겼습니다.', null, '공고와 관련이 적습니다.'),
  ],
};
const REJECTED = { state: 'rejected', changes: [change('replace', 's1', '예시 회사에서 화면 개발을 맡았습니다.', '팀을 이끌었습니다.', '거절된 이유')] };

test('rows follow the current order and carry the reason of the accepted change', () => {
  const rows = compareRevisions(BASE, CURRENT, [REJECTED, ACCEPTED]);
  assert.deepEqual(rows.map(row => [row.kind, row.block_id]), [
    ['added', 'new_1'], ['same', 's1'], ['moved', 'k2'], ['same', 'k1'], ['changed', 'a1'], ['removed', 'a2'], ['same', 'a3'],
  ]);
  const byId = new Map(rows.map(row => [row.block_id, row]));
  assert.equal(byId.get('new_1').reason, '필수 요건과 가까운 경험을 앞에 두었습니다.');
  assert.equal(byId.get('new_1').before, null);
  assert.equal(byId.get('k2').reason, '공고에 나온 기술을 앞으로 옮겼습니다.');
  assert.equal(byId.get('a1').before, '목록 화면 로딩을 5초에서 3초로 줄였습니다.');
  assert.equal(byId.get('a1').reason, '공고 업무와 이어지게 했습니다.');
  assert.equal(byId.get('a2').after, null);
  assert.equal(byId.get('a2').section, '성과');
  assert.equal(byId.get('s1').reason, null);
});

test('a reason is shown only when the accepted change produced the current sentence', () => {
  const later = CURRENT.map(item => item.id === 'a1' ? { ...item, text: '사용자가 나중에 다시 고친 문장입니다.' } : item);
  const row = compareRevisions(BASE, later, [ACCEPTED]).find(item => item.block_id === 'a1');
  assert.equal(row.kind, 'changed');
  assert.equal(row.reason, null);
});

test('a block shifted only because a neighbour moved is not marked as moved', () => {
  const rows = compareRevisions(BASE, CURRENT, []);
  assert.equal(rows.find(row => row.block_id === 'k2').kind, 'same');
  assert.equal(rows.find(row => row.block_id === 'k1').kind, 'same');
});

test('a removed first block is placed before everything that follows it', () => {
  const rows = compareRevisions(BASE, BASE.slice(1), []);
  assert.deepEqual(rows.slice(0, 2).map(row => [row.kind, row.block_id]), [['removed', 's1'], ['same', 'k1']]);
});

test('summary counts each kind, identical revisions are all unchanged, inputs are not changed', () => {
  const base = structuredClone(BASE), current = structuredClone(CURRENT), proposals = structuredClone([ACCEPTED]);
  const rows = compareRevisions(base, current, proposals);
  assert.deepEqual(compareSummary(rows), { added: 1, changed: 1, removed: 1, moved: 1, same: 3 });
  assert.deepEqual(base, BASE);
  assert.deepEqual(current, CURRENT);
  assert.deepEqual(proposals, [ACCEPTED]);
  assert.deepEqual(compareSummary(compareRevisions(BASE, BASE, [])), { added: 0, changed: 0, removed: 0, moved: 0, same: 6 });
  assert.deepEqual(compareRevisions([], [], []), []);
});
