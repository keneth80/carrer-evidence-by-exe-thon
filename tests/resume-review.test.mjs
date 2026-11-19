import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewFacts } from '../packages/tailor/src/review.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';
import { confirmFixture } from './helpers/s02-harness.mjs';

// S1-13 1차 점검(규칙): 사실을 바꾸지 않고 보완 안내·질문만 만든다.

const fact = (id, category, statement) => ({ id, category, statement });

test('빠진 직무·기간, 결과 문장 없음, 넓은 표현, 평가어, 중복, 적은 기술을 찾고 경고를 먼저 보여 준다', () => {
  const facts = [
    fact('e1', 'employer', '예시 회사 A'), fact('e2', 'employer', '예시 회사 B'), fact('p1', 'period', '2020.01 - 2021.12'),
    fact('r1', 'responsibility', '웹 서비스 개발 전반을 담당했습니다.'),
    fact('r2', 'responsibility', '탁월한 설계로 화면을 만들었습니다.'),
    fact('s1', 'skill', 'React'), fact('s2', 'skill', 'React'),
  ];
  const review = reviewFacts(facts);
  const kinds = review.findings.map(item => item.kind);
  for (const kind of ['missing_role', 'missing_period', 'no_result', 'broad_statement', 'slop', 'duplicate', 'few_skills']) assert.ok(kinds.includes(kind), kind);
  assert.deepEqual(review.findings.slice(0, 2).map(item => item.severity), ['warn', 'warn']);
  assert.equal(review.patterns.family, 'general');
  assert.deepEqual(review.findings.find(item => item.kind === 'slop').fact_ids, ['r2']);
  assert.deepEqual(facts.map(item => item.statement)[3], '웹 서비스 개발 전반을 담당했습니다.', 'facts are not modified');
});

test('합성 프론트엔드 이력서(실제 업로드 경로)의 점검: 직무·기간은 통과, 결과 문장 없음은 안내, 프론트엔드 패턴', async () => {
  const { folder, cleanup } = tempFolder('review-');
  const api = await startApi(folder);
  try {
    const http = client(api, await login(api, 'reviewer'));
    const { revision } = await confirmFixture(api, http, 'frontend');
    const review = reviewFacts(revision.facts);
    const kinds = review.findings.map(item => item.kind);
    assert.ok(!kinds.includes('missing_role'));
    assert.ok(!kinds.includes('missing_period'));
    assert.ok(kinds.includes('no_result'), 'the fixture says no measured results exist');
    assert.equal(review.patterns.family, 'frontend');
    assert.ok(review.findings.every(item => item.severity === 'info'), 'nothing blocks the search');
  } finally { await api.stop(); cleanup(); }
});

test('같은 내용이 세 번 있으면 안내를 한 번만, 모든 항목 ID와 횟수를 담아 보여 준다', () => {
  const facts = [fact('s1', 'skill', 'TypeScript'), fact('s2', 'skill', 'TypeScript'), fact('s3', 'skill', 'TypeScript '), fact('s4', 'skill', 'React'), fact('s5', 'skill', 'Vue')];
  const duplicates = reviewFacts(facts).findings.filter(item => item.kind === 'duplicate');
  assert.equal(duplicates.length, 1);
  assert.deepEqual(duplicates[0].fact_ids, ['s1', 's2', 's3']);
  assert.match(duplicates[0].detail, /3번/);
});

test('결과 문장 없음 안내는 보완 대화에서 답할 수 있다고 알려 준다(공고 맞춤 대화만 가리키지 않는다)', () => {
  const noResult = reviewFacts([fact('r1', 'responsibility', '정산 화면을 개발했습니다.')]).findings.find(item => item.kind === 'no_result');
  assert.match(noResult.detail, /보완 대화/);
  assert.ok(noResult.question, 'it still asks a question the user can answer');
});
