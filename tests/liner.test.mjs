import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockLinerAdapter, createLiveLinerAdapter } from '../packages/liner/src/index.ts';
import { evaluateConditions, evaluateRemoteAvailability } from '../packages/domain/src/index.ts';

const request = { searchId: 'search_test', query: 'React TypeScript', maxResults: 10 };

test('mock은 실제 채용 여부를 주장하지 않는 결정적인 합성 후보 3개를 제공한다', async () => {
  const adapter = createMockLinerAdapter();
  const first = await adapter.search(request);
  assert.deepEqual(first, await adapter.search(request));
  assert.equal(first.length, 3);
  assert.equal(new Set(first.map((candidate) => candidate.job_key)).size, 3);
  assert.ok(first.every((candidate) => candidate.provenance === 'fixture' && candidate.hiring_status === 'unknown' && new URL(candidate.source_url).hostname.endsWith('.example')));
});

test('mock도 결과 상한을 지키고 10개를 채우기 위한 가짜 후보를 추가하지 않는다', async () => {
  const adapter = createMockLinerAdapter();
  assert.equal((await adapter.search({ ...request, maxResults: 1 })).length, 1);
  for (const maxResults of [0, 11, 1.5]) {
    await assert.rejects(adapter.search({ ...request, maxResults }), { code: 'INVALID_MOCK_REQUEST' });
  }
});

test('mock 분석→정책 평가에서 review·needs_information·hold가 근거와 함께 분리된다', async () => {
  const adapter = createMockLinerAdapter();
  const candidates = await adapter.search(request);
  const decisions = [];
  for (const candidate of candidates) {
    const taskId = `task_${candidate.slot}`;
    const facts = await adapter.analyze({ candidate, taskId });
    assert.equal(facts.candidate_id, candidate.id);
    assert.equal(facts.task_id, taskId);
    assert.equal(facts.provenance, 'fixture');
    assert.ok(facts.sources.every((source) => source.kind === 'fixture' && source.retrieval_method === 'fixture'));
    for (const evidence of facts.claims[0].evidence) {
      const source = facts.sources.find((item) => item.id === evidence.source_id);
      assert.ok(source.excerpt.includes(evidence.quote));
    }
    decisions.push(evaluateConditions([evaluateRemoteAvailability(facts.claims[0], 'required')]).decision);
  }
  assert.deepEqual(decisions, ['review', 'needs_information', 'hold']);
});

test('mock 응답을 수정해도 다음 호출의 합성 원본은 변하지 않는다', async () => {
  const adapter = createMockLinerAdapter();
  const candidate = (await adapter.search(request))[0];
  const first = await adapter.analyze({ candidate, taskId: 'task_test' });
  first.claims[0].evidence[0].quote = '변경';
  const second = await adapter.analyze({ candidate, taskId: 'task_test' });
  assert.notEqual(second.claims[0].evidence[0].quote, '변경');
});

test('회사 조사 역시 같은 후보에 연결된 합성 자료만 반환한다', async () => {
  const adapter = createMockLinerAdapter();
  const candidate = (await adapter.search(request))[0];
  const facts = await adapter.researchCompany({ candidate, taskId: 'task_company' });
  assert.equal(facts.candidate_id, candidate.id);
  assert.equal(facts.claims[0].field, 'company_product');
  assert.equal(facts.provenance, 'fixture');
  assert.ok(facts.sources[0].excerpt.includes(facts.claims[0].evidence[0].quote));
});

test('실제 공고 또는 다른 공고를 mock 사실로 덮어쓰지 않는다', async () => {
  const adapter = createMockLinerAdapter();
  const candidate = (await adapter.search(request))[0];
  await assert.rejects(adapter.analyze({ candidate: { ...candidate, provenance: 'live' }, taskId: 'task_live' }), { code: 'UNKNOWN_MOCK_CANDIDATE' });
  await assert.rejects(adapter.researchCompany({ candidate: { ...candidate, job_key: '0'.repeat(64) }, taskId: 'task_other' }), { code: 'UNKNOWN_MOCK_CANDIDATE' });
});

test('live 구현 경계는 세 동작 모두 네트워크 호출 없이 명시적으로 실패한다', async (t) => {
  const fetchSpy = t.mock.method(globalThis, 'fetch', () => { throw new Error('네트워크 호출 금지'); });
  const adapter = createLiveLinerAdapter();
  for (const operation of ['search', 'analyze', 'researchCompany']) {
    await assert.rejects(adapter[operation]({}), { code: 'LIVE_ADAPTER_NOT_IMPLEMENTED' });
  }
  assert.equal(fetchSpy.mock.callCount(), 0);
});
