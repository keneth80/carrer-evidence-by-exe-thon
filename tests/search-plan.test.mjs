import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConditions } from '../packages/search/src/conditions.ts';
import { buildQueryPlans, queryTerms } from '../packages/search/src/intent.ts';
import { evaluateConditions, parseJobAttributes } from '../packages/search/src/job-attributes.ts';
import { containsTerm, explainMatch, requirementTerms } from '../packages/search/src/match.ts';
import { containsPersonalInfo } from '../packages/search/src/privacy.ts';
import { createMockSearchProvider } from '../packages/search/src/provider.ts';
import { MOCK_JOBS } from '../packages/search/src/mock-catalog.ts';

const fact = (id, category, statement) => ({ id, category, statement });
const cond = (field, values, importance = 'required') => field === 'annual_salary'
  ? { field, operator: 'gte', values, importance, currency: 'KRW' }
  : { field, operator: 'any_of', values, importance, currency: null };

test('query plans come only from role/skill facts and keep fact ids', () => {
  const built = buildQueryPlans([
    fact('f1', 'role', '프론트엔드 개발자'), fact('f2', 'skill', 'React'), fact('f3', 'skill', 'TypeScript'),
    fact('f4', 'skill', 'Next.js'), fact('f5', 'skill', 'Storybook'), fact('f6', 'responsibility', '운영 대시보드를 개발했습니다.'),
    fact('f7', 'role', '이메일: someone@example.com'), fact('f8', 'skill', 'react'),
  ]);
  assert.equal(built.ok, true);
  assert.deepEqual(built.queries.map(item => item.query), ['프론트엔드 개발자 React TypeScript Next.js', '프론트엔드 개발자 Storybook']);
  assert.deepEqual(built.queries[0].fact_ids, ['f1', 'f2', 'f3', 'f4']);
  assert.deepEqual(built.excluded_fact_ids, ['f7'], 'contact line is excluded even when user confirmed it as a fact');
  assert.ok(built.queries.every(item => !item.query.includes('@') && !item.query.includes('대시보드')));
});

test('query plans refuse fact sets without role or skill instead of searching on nothing', () => {
  assert.equal(buildQueryPlans([]).ok, false);
  assert.equal(buildQueryPlans([fact('f1', 'responsibility', 'API를 개발했습니다.')]).code, 'NO_SEARCHABLE_FACTS');
  assert.equal(buildQueryPlans([fact('f1', 'skill', '010-1234-5678')]).ok, false, 'phone-only skill is not searchable');
  const onlyRole = buildQueryPlans([fact('f1', 'role', '데이터 엔지니어')]);
  assert.deepEqual(onlyRole.queries, [{ query: '데이터 엔지니어', fact_ids: ['f1'] }]);
  assert.deepEqual(queryTerms('데이터 엔지니어 Python, SQL'), ['데이터', 'python', 'sql']);
});

test('personal information patterns', () => {
  for (const text of ['a.b@example.com', '010-1234-5678', '+82 10-1234-5678', '+82-10-1234-5678', '02-123-4567', 'https://github.com/x', 'github.com/hong-gildong', 'linkedin.com/in/hong', 'velog.io', 'my.blog/profile', '연락처: 비공개', '1990년 1월 2일생', '서울시 강남구 테헤란로 123', '역삼동 12번지']) assert.equal(containsPersonalInfo(text), true, text);
  for (const text of ['React', 'React 18', 'AWS Lambda', 'Next.js', 'Node.js', 'Socket.io', 'ASP.NET', 'CI/CD', 'TCP/IP', 'Spring Boot 3', '2021.03 - 2026.10', '프론트엔드 개발자', '서울', '성남 판교']) assert.equal(containsPersonalInfo(text), false, text);
});

test('condition validation enforces contract shape, enums, duplicates and privacy', () => {
  const ok = validateConditions([cond('work_mode', ['remote', 'remote']), cond('annual_salary', [60000000], 'preferred'), cond('location', [' 서울  강남 '])]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.conditions[0].values, ['remote']);
  assert.deepEqual(ok.conditions[2].values, ['서울 강남']);
  assert.equal(validateConditions([]).ok, true);
  const bad = [
    [null, 'CONDITION_INVALID'], [[{ field: 'role' }], 'CONDITION_INVALID'], [[cond('work_mode', ['moon'])], 'CONDITION_INVALID'],
    [[cond('annual_salary', ['많이'])], 'CONDITION_INVALID'], [[{ ...cond('annual_salary', [1]), currency: null }], 'CONDITION_INVALID'],
    [[{ ...cond('role', ['x']), operator: 'gte' }], 'CONDITION_INVALID'], [[cond('role', [])], 'CONDITION_INVALID'],
    [[cond('location', ['010-1234-5678'])], 'CONDITION_CONTAINS_PERSONAL_INFO'], [[cond('role', ['a']), cond('role', ['b'])], 'CONDITION_DUPLICATE_FIELD'],
    [[cond('role', ['x'.repeat(61)])], 'CONDITION_INVALID'], [[cond('annual_salary', [-1])], 'CONDITION_INVALID'],
  ];
  for (const [value, code] of bad) assert.equal(validateConditions(value).code, code, JSON.stringify(value));
});

test('job attributes distinguish missing information from unmet conditions', () => {
  const text = '근무지: 서울\n근무 방식: 사무실 출근 (원격 불가)\n고용 형태: 계약직\n연봉: 4000만~5000만 원';
  assert.deepEqual(parseJobAttributes(text), { location: '서울', work_mode: 'onsite', employment_type: 'contract', salary: { min: 40000000, max: 50000000, currency: 'KRW' }, seniority: null });
  const results = evaluateConditions([cond('work_mode', ['remote']), cond('annual_salary', [60000000]), cond('location', ['서울']), cond('seniority', ['시니어'])], text, '웹 개발자');
  assert.deepEqual(results.map(item => item.state), ['unmet', 'unmet', 'met', 'unknown']);
  const blank = evaluateConditions([cond('work_mode', ['remote']), cond('annual_salary', [1]), cond('location', ['부산']), cond('employment_type', ['full_time'])], '연봉: 협의', '개발자');
  assert.deepEqual(blank.map(item => item.state), ['unknown', 'unknown', 'unknown', 'unknown'], 'absent lines are unknown, not unmet');
  assert.equal(evaluateConditions([cond('location', ['부산'])], '근무지: 서울\n근무 방식: 원격 근무', 'x')[0].state, 'met', 'remote jobs satisfy location');
  assert.equal(evaluateConditions([cond('annual_salary', [60000000])], '연봉: 5000만~7000만 원', 'x')[0].state, 'unknown', 'straddling range needs negotiation');
  assert.equal(evaluateConditions([cond('role', ['디자이너'])], '', '백엔드 개발자')[0].state, 'unknown', 'title mismatch is not asserted as unmet');
  const salaryOf = text => parseJobAttributes(text).salary;
  assert.deepEqual(salaryOf('연봉: 5000만 원 ~ 1억 원'), { min: 50000000, max: 100000000, currency: 'KRW' });
  assert.deepEqual(salaryOf('연봉: 1억 2000만~1억 5000만 원'), { min: 120000000, max: 150000000, currency: 'KRW' });
  assert.deepEqual(salaryOf('연봉: 1억 원 이상'), { min: 100000000, max: null, currency: 'KRW' });
  assert.equal(salaryOf('연봉: 3500~4500만 원'), null, 'a number without unit is ambiguous → unknown');
  assert.equal(salaryOf('연봉: ~ 6000만 원'), null, 'a range with one amount is unknown');
  assert.equal(evaluateConditions([cond('annual_salary', [60000000])], '연봉: 5000만 원 ~ 1억 원', 'x')[0].state, 'unknown', 'upper bound 1억 is not unmet');
  for (const text of ['근무 방식: 재택 불가', '근무 방식: remote 불가', '근무 방식: 원격 근무 불가능', '근무 방식: 사무실 출근 (원격 불가)']) assert.equal(parseJobAttributes(text).work_mode, 'onsite', text);
  assert.equal(parseJobAttributes('근무 방식: 원격 근무').work_mode, 'remote');
});

test('term matching respects ASCII word boundaries', () => {
  assert.equal(containsTerm('Google Cloud', 'go'), false);
  assert.equal(containsTerm('Go 언어 경험', 'go'), true);
  assert.equal(containsTerm('React와 Next.js', 'next.js'), true);
  assert.equal(containsTerm('프론트엔드개발', '프론트엔드'), true);
});

test('explanations link requirements to confirmed facts and never claim missing experience', () => {
  const job = MOCK_JOBS.find(item => item.job_key.endsWith('cloudpin-backend'));
  const facts = [fact('f1', 'role', '백엔드 개발자'), fact('f2', 'skill', 'Python'), fact('f3', 'skill', 'FastAPI')];
  const explained = explainMatch(facts, [cond('annual_salary', [80000000], 'preferred')], job, [{ query: '백엔드 개발자 Python FastAPI', fact_ids: ['f1', 'f2', 'f3'] }]);
  assert.deepEqual(explained.reasons.map(item => item.fact_ids), [['f2', 'f3']]);
  assert.equal(explained.checks[0].kind, 'condition');
  assert.equal(explained.checks[0].state, 'unknown', '6000만 원 이상 vs 8000만 원: cannot assert unmet');
  const missing = explained.checks.find(item => item.kind === 'requirement');
  assert.match(missing.detail, /경험 없음으로 단정하지 않음/);
  assert.deepEqual(explained.matched_terms, ['백엔드', 'python', 'fastapi']);
});

test('mock provider ranks by query terms, filters required unmet conditions, and reports empty', async () => {
  const provider = createMockSearchProvider();
  const frontend = await provider.search({ queries: [{ query: '프론트엔드 React TypeScript', fact_ids: ['a'] }], conditions: [], maxCandidates: 10 });
  const backend = await provider.search({ queries: [{ query: '백엔드 Python FastAPI', fact_ids: ['a'] }], conditions: [], maxCandidates: 10 });
  assert.equal(frontend.outcome, 'complete');
  assert.notDeepEqual(frontend.jobs.map(job => job.job_key), backend.jobs.map(job => job.job_key));
  assert.ok(frontend.jobs.every(job => job.data_origin === 'synthetic' && job.canonical_url.includes('.invalid/')));
  const remoteOnly = await provider.search({ queries: [{ query: '프론트엔드 React TypeScript', fact_ids: ['a'] }], conditions: [cond('work_mode', ['remote'])], maxCandidates: 10 });
  assert.ok(remoteOnly.jobs.length > 0 && remoteOnly.jobs.length < frontend.jobs.length);
  assert.ok(remoteOnly.jobs.every(job => !/사무실 출근|하이브리드/.test(job.content_text)));
  const limited = await provider.search({ queries: [{ query: 'React TypeScript', fact_ids: ['a'] }], conditions: [], maxCandidates: 1 });
  assert.equal(limited.jobs.length, 1);
  assert.equal((await provider.search({ queries: [{ query: 'COBOL', fact_ids: ['a'] }], conditions: [], maxCandidates: 10 })).outcome, 'empty');
  await assert.rejects(provider.search({ queries: [], conditions: [], maxCandidates: 10 }), { code: 'INVALID_SEARCH_INPUT' });
  for (const job of MOCK_JOBS) for (const requirement of job.requirements) assert.ok(job.content_text.includes(requirement.source_quote), 'requirement quote is in content');
});

test('sentence facts support a requirement only when every key term appears', () => {
  assert.deepEqual(requirementTerms('코드 리뷰 경험'), ['코드', '리뷰']);
  assert.deepEqual(requirementTerms('React와 Next.js 서비스 개발 경험'), ['react', 'next.js']);
  const job = { title: 'x', content_text: '', requirements: [
    { id: 'r1', text: '코드 리뷰 경험', importance: 'required', source_quote: '코드 리뷰 경험' },
    { id: 'r2', text: 'Kafka 운영 경험', importance: 'required', source_quote: 'Kafka 운영 경험' },
    { id: 'r3', text: 'SQL 경험', importance: 'required', source_quote: 'SQL 경험' },
  ] };
  const facts = [
    fact('f1', 'responsibility', '공통 컴포넌트 구조와 코드 리뷰 기준을 정리했습니다.'),
    fact('f2', 'responsibility', '운영 대시보드의 화면 구조를 담당했습니다.'),
    fact('f3', 'employer', 'SQL 컨설팅 (가상 회사)'),
  ];
  const explained = explainMatch(facts, [], job);
  assert.deepEqual(explained.reasons.map(item => [item.requirement_id, item.fact_ids]), [['r1', ['f1']]]);
  assert.deepEqual(explained.checks.map(item => item.requirement_id), ['r2', 'r3'], 'one shared word (운영) or a single-term requirement is not enough; employer names are not evidence');
});
