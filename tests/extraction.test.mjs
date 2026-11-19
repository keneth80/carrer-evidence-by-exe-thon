import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractCandidates } from '../packages/resume/src/candidates.ts';
import { validateConfirmedFacts } from '../packages/resume/src/confirm.ts';
import { runExtractionTask, recoverExtractionTasks } from '../apps/api/src/resume/extraction.ts';
import { parseWarning } from '../packages/resume/src/types.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';

const pasted = text => ({ input_kind: 'pasted_text', pages: [{ page: null, text }] });

test('candidate rules keep source spans, split skills and skip negated, preference and contact lines', () => {
  const text = '김예시\n데이터 엔지니어\nphone 010-1234-5678\n\n경력\n예시랩 | 2019.03 - 현재\n배치 파이프라인 처리 시간을 40% 줄였습니다.\nSpark 경험은 없습니다.\n\n기술\n주요: Airflow · dbt / BigQuery\n희망 근무지: 서울';
  const { facts, warnings } = extractCandidates(pasted(text), 'doc_1');
  const chars = Array.from(text);
  for (const fact of facts) {
    const [evidence] = fact.evidence;
    assert.equal(chars.slice(evidence.start, evidence.end).join(''), evidence.quote);
  }
  assert.deepEqual(facts.map(fact => [fact.category, fact.statement]), [
    ['role', '데이터 엔지니어'], ['employer', '예시랩'], ['period', '2019.03 - 현재'],
    ['achievement', '배치 파이프라인 처리 시간을 40% 줄였습니다.'],
    ['skill', 'Airflow'], ['skill', 'dbt'], ['skill', 'BigQuery'],
  ]);
  const codes = warnings.map(item => item.code);
  for (const code of ['UNCLASSIFIED_LINE', 'PERSONAL_INFO_EXCLUDED', 'NEGATED_OR_UNVERIFIED', 'PREFERENCE_NOT_FACT']) assert.ok(codes.includes(code), code);
  assert.ok(!facts.some(fact => fact.statement.includes('Spark')));
});

test('slash inside a skill name is kept and text after a period range is flagged, not dropped silently', () => {
  const text = '기술\nCI/CD, TCP/IP / Docker\n경력\n예시사 | 2020.01 - 2021.02 | 백엔드 개발자';
  const { facts, warnings } = extractCandidates(pasted(text), 'doc_1');
  assert.deepEqual(facts.filter(fact => fact.category === 'skill').map(fact => fact.statement), ['CI/CD', 'TCP/IP', 'Docker']);
  const trailing = warnings.find(item => item.code === 'UNCLASSIFIED_LINE');
  assert.equal(Array.from(text).slice(trailing.start, trailing.end).join(''), '백엔드 개발자');
});

test('numbered, subtitled and combined headings open sections; an unknown numbered heading does not leave lines in the header', () => {
  const text = [
    '홍예시', '백엔드 개발자',
    '01  핵심 업무 스킬', 'Java · Spring / Kafka',
    '대표 성과', '정산 배치 시간을 30% 줄였습니다.',
    '02  일하는 방식', '측정 가능한 기준으로 도구를 고릅니다.',
    '06  경력 | 최근 역할 중심', '예시페이 | 2021.03 - 현재', '결제 API를 설계하고 운영했습니다.',
    '이전 경력', '예시커머스 | 2018.01 - 2021.02',
    '09  기술·방법론 선택 원칙', '팀이 유지할 수 있는 도구를 우선합니다.',
    '12  학력 · 자격 · 교육', '예시대학교 컴퓨터공학과 졸업',
  ].join('\n');
  const { facts, warnings } = extractCandidates(pasted(text), 'doc_1');
  assert.deepEqual(facts.map(fact => [fact.category, fact.statement]), [
    ['role', '백엔드 개발자'],
    ['skill', 'Java'], ['skill', 'Spring'], ['skill', 'Kafka'],
    ['achievement', '정산 배치 시간을 30% 줄였습니다.'],
    ['other', '측정 가능한 기준으로 도구를 고릅니다.'],
    ['employer', '예시페이'], ['period', '2021.03 - 현재'], ['responsibility', '결제 API를 설계하고 운영했습니다.'],
    ['employer', '예시커머스'], ['period', '2018.01 - 2021.02'],
    ['other', '팀이 유지할 수 있는 도구를 우선합니다.'],
    ['education', '예시대학교 컴퓨터공학과 졸업'],
  ]);
  assert.ok(!warnings.some(item => item.code === 'NO_FACT_CANDIDATES'));
});

test('without any recognized heading, a dated line still yields employer and period; long skill tokens are flagged, not dropped', () => {
  const noHeadings = extractCandidates(pasted('홍예시\n예시랩 | 2019.03 - 2022.12\n사내 도구를 만들었습니다.'), 'doc_1');
  assert.deepEqual(noHeadings.facts.map(fact => [fact.category, fact.statement]), [['employer', '예시랩'], ['period', '2019.03 - 2022.12']]);
  const text = '기술\nReact, 사내 디자인 시스템을 처음부터 설계하고 여러 제품 팀에 배포해 운영한 경험';
  const { facts, warnings } = extractCandidates(pasted(text), 'doc_1');
  assert.deepEqual(facts.map(fact => fact.statement), ['React']);
  const flagged = warnings.find(item => item.code === 'UNCLASSIFIED_LINE');
  assert.equal(Array.from(text).slice(flagged.start, flagged.end).join(''), '사내 디자인 시스템을 처음부터 설계하고 여러 제품 팀에 배포해 운영한 경험');
});

test('a numbered list item inside a section is not mistaken for a heading', () => {
  const { facts } = extractCandidates(pasted('경력\n예시사 | 2020.01 - 현재\n1. 결제 API 설계\n10. 장애 대응 문서화'), 'doc_1');
  assert.deepEqual(facts.map(fact => [fact.category, fact.statement]), [
    ['employer', '예시사'], ['period', '2020.01 - 현재'], ['responsibility', '1. 결제 API 설계'], ['responsibility', '10. 장애 대응 문서화'],
  ]);
});

test('table-style Word resume: qualified headings, table header row, date-only rows, role lines, skill labels and bullets', () => {
  const text = [
    '홍예시', '시니어 프론트엔드 엔지니어',
    '프론트엔드 팀을 이끌며 데이터 시각화와 앱 연동을 설계했고, 지금은 서버 개발을 맡고 있습니다.',
    '최근 경력',
    '예시플레이\t2022.12 ~ 재직 중',
    '서버개발팀  |  서버 개발 및 운영',
    '•\t이벤트 재처리 구조를 설계했습니다.',
    '주요 기술',
    '프론트엔드  React, TypeScript',
    '서버·데이터  Python, Node.js',
    '경력 상세',
    '예시솔루션\t2019.02 ~ 2020.02',
    '연구소 차장  |  연구 지원 도구 개발',
    '이전 경력',
    '기간', '소속 및 역할', '주요 업무',
    '2014.04 ~ 2014.12',
    '예시웍스 · 프리랜서 과장',
    '대시보드와 차트 모듈 개발',
    '오픈소스와 개인 프로젝트',
    '예시차트  |  오픈소스 제작',
    '학력과 자격',
    '예시대학교 소프트웨어공학 졸업',
    '외부 강의',
    '예시캠퍼스 React 강의',
  ].join('\n');
  const { facts, warnings } = extractCandidates(pasted(text), 'doc_1');
  const chars = Array.from(text);
  for (const fact of facts) {
    const [evidence] = fact.evidence;
    assert.equal(chars.slice(evidence.start, evidence.end).join(''), evidence.quote, fact.statement);
  }
  assert.deepEqual(facts.map(fact => [fact.category, fact.statement]), [
    ['role', '시니어 프론트엔드 엔지니어'],
    ['other', '프론트엔드 팀을 이끌며 데이터 시각화와 앱 연동을 설계했고, 지금은 서버 개발을 맡고 있습니다.'],
    ['employer', '예시플레이'], ['period', '2022.12 ~ 재직 중'],
    ['role', '서버개발팀'], ['responsibility', '서버 개발 및 운영'],
    ['responsibility', '이벤트 재처리 구조를 설계했습니다.'],
    ['skill', 'React'], ['skill', 'TypeScript'],
    ['skill', 'Python'], ['skill', 'Node.js'],
    ['employer', '예시솔루션'], ['period', '2019.02 ~ 2020.02'],
    ['role', '연구소 차장'], ['responsibility', '연구 지원 도구 개발'],
    ['period', '2014.04 ~ 2014.12'],
    ['employer', '예시웍스'], ['role', '프리랜서 과장'],
    ['responsibility', '대시보드와 차트 모듈 개발'],
    ['responsibility', '예시차트  |  오픈소스 제작'],
    ['education', '예시대학교 소프트웨어공학 졸업'],
    ['other', '예시캠퍼스 React 강의'],
  ]);
  const tableHeader = warnings.filter(item => item.code === 'UNCLASSIFIED_LINE').map(item => chars.slice(item.start, item.end).join(''));
  assert.ok(['기간', '소속 및 역할', '주요 업무'].every(label => tableHeader.includes(label)), 'table header labels are flagged, not facts');
});

test('candidate count stops at the confirm limit with one warning', () => {
  const text = '기술\n' + Array.from({ length: 320 }, (_, i) => `S${i}`).join(', ');
  const { facts, warnings } = extractCandidates(pasted(text), 'doc_1');
  assert.equal(facts.length, 300);
  assert.equal(warnings.filter(item => item.code === 'CANDIDATE_LIMIT_REACHED').length, 1);
});

test('empty text yields no facts and an EMPTY_TEXT warning; warning strings round-trip', () => {
  const { facts, warnings } = extractCandidates({ input_kind: 'text_pdf', pages: [{ page: 1, text: '' }] }, 'doc_1');
  assert.deepEqual(facts, []);
  assert.equal(warnings[0].code, 'EMPTY_TEXT');
  assert.deepEqual(parseWarning('NEGATED_OR_UNVERIFIED@2:10-20 메시지'), { code: 'NEGATED_OR_UNVERIFIED', page: 2, start: 10, end: 20, message: '메시지' });
  assert.deepEqual(parseWarning('EMPTY_TEXT@- 없음'), { code: 'EMPTY_TEXT', page: null, start: null, end: null, message: '없음' });
});

test('confirmed facts accept user wording but reject offsets outside the source and code-point drift', () => {
  const text = '기술\n😀 Rust, Go';
  const source = pasted(text);
  const { facts } = extractCandidates(source, 'doc_1');
  assert.deepEqual(facts.map(fact => fact.statement), ['😀 Rust', 'Go']);
  const trimmed = facts.map(fact => ({ ...fact, statement: fact.statement.replace('😀 ', '') }));
  assert.equal(validateConfirmedFacts(trimmed, 'doc_1', source).ok, true, 'shortening within the quote is allowed');
  const inflated = facts.map(fact => ({ ...fact, statement: fact.statement + ' 10년' }));
  assert.equal(validateConfirmedFacts(inflated, 'doc_1', source).code, 'STATEMENT_EXCEEDS_EVIDENCE');
  const blankQuote = structuredClone(facts); blankQuote[0].evidence[0] = { ...blankQuote[0].evidence[0], start: 2, end: 3, quote: '\n' };
  assert.equal(validateConfirmedFacts(blankQuote, 'doc_1', source).code, 'EVIDENCE_INVALID');
  const shifted = structuredClone(facts); shifted[1].evidence[0].end = 999;
  assert.equal(validateConfirmedFacts(shifted, 'doc_1', source).code, 'EVIDENCE_RANGE_INVALID');
  const duplicate = [facts[0], { ...facts[1], id: facts[0].id }];
  assert.equal(validateConfirmedFacts(duplicate, 'doc_1', source).code, 'FACT_ID_INVALID');
  const extraKey = [{ ...facts[0], confidence: 1 }];
  assert.equal(validateConfirmedFacts(extraKey, 'doc_1', source).code, 'FACT_INVALID');
});

test('queued extraction survives restart and a runner that lost its lease cannot write a result', async () => {
  const { folder, cleanup } = tempFolder('s01-lease-');
  let api = await startApi(folder, { autoExtract: false });
  try {
    const http = client(api, await login(api, 'erin'));
    const pdf = readFileSync(new URL('../fixtures/resumes/backend.synthetic.pdf', import.meta.url));
    const accepted = await http.upload('/api/v1/resume-documents', pdf, 'backend.synthetic.pdf');
    const documentId = accepted.body.resource_id;
    const taskId = accepted.body.task.id;
    assert.equal((await http.get(`/api/v1/resume-documents/${documentId}/extraction`)).body.code, 'EXTRACTION_PENDING');

    // 다른 실행기가 lease를 가져간 상황: 읽기 도중 generation을 올린다.
    const { db, store } = api;
    const hijacking = { ...store, read: (workspace, key) => {
      db.prepare("UPDATE ce7_tasks SET lease_owner = 'other-runner', lease_generation = lease_generation + 1 WHERE id = ?").run(taskId);
      return store.read(workspace, key);
    } };
    assert.equal(await runExtractionTask({ ...api.extraction, store: hijacking }, taskId), 'lease_lost');
    assert.equal(db.prepare('SELECT count(*) AS n FROM ce7_extractions').get().n, 0);
    assert.equal((await http.get(`/api/v1/product-tasks/${taskId}`)).body.state, 'running');

    // 프로세스 재시작 후 lease가 만료되면 복구 경로가 작업을 끝낸다.
    await api.stop();
    api = await startApi(folder, { autoExtract: false });
    const later = { ...api.extraction, now: () => Date.now() + api.config.limits.extractionLeaseMs + 1000 };
    assert.equal(await recoverExtractionTasks(later), 1);
    const again = client(api, await login(api, 'erin'));
    const task = (await again.get(`/api/v1/product-tasks/${taskId}`)).body;
    assert.equal(task.state, 'succeeded');
    assert.equal(task.provider_transmission, 'not_dispatched');
    assert.equal((await again.get(`/api/v1/resume-documents/${documentId}/extraction`)).body.status, 'review_required');
    assert.equal(await recoverExtractionTasks(later), 0, 'finished task is not re-run');

    // lease를 계속 잃는 작업은 무한히 다시 집히지 않고 실패로 끝난다.
    const pdf2 = await again.upload('/api/v1/resume-documents', readFileSync(new URL('../fixtures/resumes/frontend.synthetic.pdf', import.meta.url)), 'frontend.synthetic.pdf');
    api.db.prepare("UPDATE ce7_tasks SET state = 'running', lease_owner = 'dead-runner', lease_generation = 3, lease_until_ms = 1 WHERE id = ?").run(pdf2.body.task.id);
    await recoverExtractionTasks(later);
    const exhausted = (await again.get(`/api/v1/product-tasks/${pdf2.body.task.id}`)).body;
    assert.equal(exhausted.state, 'failed');
    assert.equal(exhausted.error_code, 'EXTRACTION_ATTEMPTS_EXCEEDED');
    assert.equal((await again.get(`/api/v1/resume-documents/${pdf2.body.resource_id}`)).body.extraction_status, 'failed');
  } finally {
    await api.stop();
    cleanup();
  }
});
