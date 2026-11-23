import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractCandidates } from '../packages/resume/src/candidates.ts';
import { validateConfirmedFacts } from '../packages/resume/src/confirm.ts';
import { runExtractionTask, recoverExtractionTasks } from '../apps/api/src/resume/extraction.ts';
import { validateReviewDraft } from '../apps/api/src/resume/review-draft.ts';
import { createLinerMessageCache } from '../apps/api/src/resume/liner-messages.ts';
import { buildResumeDraftRequest, createLinerStructureProvider } from '../packages/liner/src/structure.ts';
import { createLinerLedger } from '../apps/worker/src/liner-ledger.ts';
import { parseWarning } from '../packages/resume/src/types.ts';
import { tempFolder, startApi, login, client } from './helpers/s01-harness.mjs';

const pasted = text => ({ input_kind: 'pasted_text', pages: [{ page: null, text }] });

test('Liner draft can combine PDF lines into one rewritten item with the original span', () => {
  const original = '배치 파이프라인을\n재설계해 처리 시간을\n20% 줄였습니다.';
  const source = { input_kind: 'text_pdf', pages: [
    { page: 1, text: original }, { page: 2, text: '운영 보고서를 작성했습니다.' },
  ] };
  const { messages, max_completion_tokens: maxTokens, response_format: responseFormat } = buildResumeDraftRequest(source, 'balanced');
  assert.equal(maxTokens, 10_000);
  assert.match(messages[0].content, /10,000토큰 이내/);
  assert.match(messages[0].content, /근무 종료일이 10년 넘게 앞선 이력/);
  assert.doesNotMatch(messages[0].content, /48개/);
  const entrySchema = responseFormat.json_schema.schema.properties.groups.items.properties.entries.items;
  assert.deepEqual(entrySchema.properties.text.type, ['string', 'null']);
  assert.deepEqual(entrySchema.properties.quote.type, ['string', 'null']);
  assert.match(messages[0].content, /세 줄 이상에도 적용한다/);
  assert.equal(messages[1].content, '[page=1] [s=0] 배치 파이프라인을 [s=1] 재설계해 처리 시간을 [s=2] 20% 줄였습니다. [page=2] [s=3] 운영 보고서를 작성했습니다.');
  const text = '배치 파이프라인 재설계로 처리 시간을 20% 단축했습니다.';
  const draft = validateReviewDraft({ groups: [{ section: 'career', projects: [], entries: [
    { category: 'achievement', from: 0, to: 2, quote: null, text },
    { category: 'responsibility', from: 2, to: 3, quote: null, text: '운영 보고서를 작성했습니다.' },
  ] }] }, source, 'doc_1', []);
  assert.equal(draft.facts.length, 1);
  assert.equal(draft.facts[0].evidence[0].quote, original);
  assert.equal(draft.review[draft.facts[0].id].wording, text);
});

// 이름·머리글은 문맥 파악에 보내지만(S1-31) 이메일·전화번호·주민번호는 가려서 보낸다(2026-11-23 실이력서 테스트에서 그대로 전송된 것을 발견).
// 가려도 줄 번호는 원문과 같아야 서버가 원문 범위로 근거를 읽는다.
test('resume draft request masks contact details but keeps names and original line numbers', () => {
  const source = { input_kind: 'text_pdf', pages: [{ page: 1, text: '홍예시\nhong@example.com · 010-1234-5678\n예시랩 프론트엔드 리드' }] };
  const { messages } = buildResumeDraftRequest(source, 'balanced');
  assert.doesNotMatch(JSON.stringify(messages), /hong@example\.com|010-1234-5678/);
  assert.equal(messages[1].content, '[page=1] [s=0] 홍예시 [s=1] [이메일] · [전화번호] [s=2] 예시랩 프론트엔드 리드');
  const draft = validateReviewDraft({ groups: [{ section: 'career', projects: [], entries: [
    { category: 'employer', from: 2, to: 2, quote: null, text: null },
  ] }] }, source, 'doc_1', []);
  assert.equal(draft.facts[0].evidence[0].quote, '예시랩 프론트엔드 리드');
});

test('older career summary shares a heading while each item keeps its own source evidence', () => {
  const first = '예시사에서 서비스 운영을 담당했습니다.';
  const second = '가상랩에서 서비스 출시를 지원했습니다.';
  const draft = validateReviewDraft({ groups: [{ section: 'career', older_career_summary: true, projects: [], entries: [
    { category: 'responsibility', from: 0, to: 0, quote: null, text: '예시사 서비스 운영을 담당했습니다.' },
    { category: 'responsibility', from: 1, to: 1, quote: null, text: '가상랩 서비스 출시를 지원했습니다.' },
  ] }] }, pasted(`${first}\n${second}`), 'doc_1', []);
  assert.deepEqual(draft.facts.map(fact => fact.evidence[0].quote), [first, second]);
  assert.deepEqual(Object.values(draft.review).map(item => item.group), [
    { id: '0', title: '이전 경력 요약' }, { id: '0', title: '이전 경력 요약' },
  ]);
});

test('line-only draft evidence cannot include personal information in a career item', () => {
  const text = 'resume@example.com\n서비스 운영을 맡았습니다.';
  const draft = validateReviewDraft({ groups: [{ section: 'career', projects: [], entries: [
    { category: 'responsibility', from: 0, to: 1, quote: null, text: '서비스 운영을 맡았습니다.' },
    { category: 'responsibility', from: 1, to: 1, quote: null, text: '서비스 운영을 담당했습니다.' },
  ] }] }, pasted(text), 'doc_1', [{ code: 'PERSONAL_INFO_EXCLUDED', page: null, start: 0, end: 18 }]);
  assert.deepEqual(draft.facts.map(fact => fact.statement), ['서비스 운영을 맡았습니다.']);
});

test('only the owner can view the actual Liner messages sent and received for an extraction task', async () => {
  const { folder, cleanup } = tempFolder('s01-liner-messages-');
  const linerMessages = createLinerMessageCache();
  const api = await startApi(folder, { autoExtract: false, linerMessages });
  const providerRequest = Promise.withResolvers();
  const providerReply = Promise.withResolvers();
  let extraction;
  try {
    const owner = client(api, await login(api, 'messages-owner'));
    const outsider = client(api, await login(api, 'messages-outsider'));
    const text = '홍예시\nresume@example.com\n경력\n예시랩 | 2019.03 - 현재\n서비스 운영을 맡았습니다.\n정산 프로젝트\n정산 로그를 살펴봤습니다.\n매일 운영 현황을 기록했습니다.';
    const upload = await owner.post('/api/v1/resume-documents/text', { json: { text } });
    assert.equal(upload.status, 202);
    const taskId = upload.body.task.id;
    const path = `/api/v1/local-dev/extraction-tasks/${taskId}/liner-messages`;
    assert.deepEqual((await owner.get(path)).body, { messages: null });

    const structure = createLinerStructureProvider({
      apiKey: 'test-only',
      ledger: createLinerLedger({ db: api.db, owner: api.extraction.owner, now: Date.now, maxCalls: 1, budgetMicroUsd: 1_000_000 }),
      fetch: async (_url, init) => {
        providerRequest.resolve(JSON.parse(init.body));
        return providerReply.promise;
      },
      onMessages: (call, messages) => linerMessages.set(call.taskId, messages),
    });
    extraction = runExtractionTask({ ...api.extraction, structure }, taskId);
    const request = await Promise.race([providerRequest.promise, extraction.then(() => assert.fail('Expected a Liner request'))]);
    const { messages: sentMessages } = request;
    const groupSchema = request.response_format.json_schema.schema.properties.groups.items;
    assert.ok(groupSchema.required.includes('projects'));
    assert.deepEqual(groupSchema.properties.projects.items.required, ['heading', 'entries']);
    const pending = await owner.get(path);
    assert.equal(pending.headers.get('cache-control'), 'no-store');
    assert.deepEqual(pending.body, { messages: { request: sentMessages, response: null } });
    assert.match(sentMessages[1].content, /\[s=0\] 홍예시 \[s=1\] \[이메일\] \[s=2\] 경력/);
    assert.doesNotMatch(JSON.stringify(request), /resume@example\.com/);
    assert.equal((await outsider.get(path)).status, 404);
    assert.equal((await client(api).get(path)).status, 401);

    assert.doesNotMatch(sentMessages[1].content, /unclassified/);
    const content = JSON.stringify({ groups: [
      { section: 'career', older_career_summary: false, entries: [
        { from: 3, to: 3, category: 'employer', quote: '예시랩', text: null },
        { from: 3, to: 3, category: 'period', quote: '2019.03 - 현재', text: '2025년에 입사했습니다.' },
        { from: 4, to: 4, category: 'responsibility', quote: '서비스 운영을 맡았습니다.', text: '서비스 운영을 담당했습니다.' },
        { from: 4, to: 4, category: 'achievement', quote: '없는 성과', text: '없는 성과' },
      ], projects: [
        { heading: { from: 5, to: 5, category: 'other', quote: '정산 프로젝트', text: '정산 프로젝트' }, entries: [
          { from: 6, to: 6, category: 'responsibility', quote: '정산 로그를 살펴봤습니다.', text: '정산 로그를 검토했습니다.' },
        ] },
        { heading: { from: 7, to: 7, category: 'other', quote: '원문에 없는 프로젝트 이름', text: '원문에 없는 프로젝트 이름' }, entries: [
          { from: 7, to: 7, category: 'responsibility', quote: '매일 운영 현황을 기록했습니다.', text: '운영 현황을 매일 기록했습니다.' },
        ] },
      ] },
    ] });
    providerReply.resolve(Response.json({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    assert.equal(await extraction, 'completed');
    assert.deepEqual((await owner.get(path)).body, { messages: { request: sentMessages, response: { role: 'assistant', content } } });
    const reviewPath = `/api/v1/local-dev/extraction-tasks/${taskId}/review`;
    const group = { id: '0', title: '예시랩 · 2019.03 - 현재' };
    assert.deepEqual((await owner.get(reviewPath)).body, {
      fact_l_1: { section: 'career', wording: null, group, primary: true },
      fact_l_2: { section: 'career', wording: null, group, primary: true },
      fact_l_3: { section: 'career', wording: '서비스 운영을 담당했습니다.', group, primary: true },
      fact_l_4: { section: 'career', wording: null, group, project: { id: '0', title: '정산 프로젝트' }, primary: true },
      fact_l_5: { section: 'career', wording: '정산 로그를 검토했습니다.', group, project: { id: '0', title: '정산 프로젝트' }, primary: true },
      fact_l_6: { section: 'career', wording: '운영 현황을 매일 기록했습니다.', group, project: { id: '1', title: '프로젝트' }, primary: true },
    });
    const draft = (await owner.get(`/api/v1/resume-documents/${upload.body.resource_id}/extraction`)).body;
    assert.deepEqual(draft.facts.map(fact => fact.statement), [
      '예시랩', '2019.03 - 현재', '서비스 운영을 맡았습니다.', '정산 프로젝트', '정산 로그를 살펴봤습니다.', '매일 운영 현황을 기록했습니다.',
    ]);
    const evidence = draft.facts[4].evidence[0];
    assert.equal(Array.from(text).slice(evidence.start, evidence.end).join(''), '정산 로그를 살펴봤습니다.');
    const confirmed = await owner.post(`/api/v1/resume-documents/${upload.body.resource_id}/fact-revisions`, {
      json: { extraction_id: draft.id, expected_parent_revision_id: null, facts: [draft.facts[0], draft.facts[2], draft.facts[3], draft.facts[4]] },
    });
    assert.equal(confirmed.status, 201);
    assert.deepEqual(confirmed.body.facts.map(fact => fact.statement), ['예시랩', '서비스 운영을 맡았습니다.', '정산 프로젝트', '정산 로그를 살펴봤습니다.']);
    assert.equal((await outsider.get(reviewPath)).status, 404);
  } finally {
    providerReply.resolve(new Response(null, { status: 400 }));
    await extraction?.catch(() => {});
    await api.stop();
    cleanup();
  }
});

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

test('a wrapped introduction without a section title is one candidate with its original source span', () => {
  const introduction = [
    '현장 데이터를 다루는 개발자로서 장비 모니터링과 실시간 데이터 처리 시스템의 개발을',
    '담당해 왔습니다. 백엔드 서비스 운영을 경험했고 현재는 장비 연동 설계 및',
    'API 운영을 맡고 있습니다.',
  ];
  const text = ['홍예시', 'resume@example.com', ...introduction, '경력', '예시랩 | 2019.03 - 현재'].join('\n');
  const { facts, warnings } = extractCandidates(pasted(text), 'doc_1');
  assert.deepEqual(facts.map(fact => [fact.category, fact.statement]), [
    ['other', introduction.join(' ')], ['employer', '예시랩'], ['period', '2019.03 - 현재'],
  ]);
  const [evidence] = facts[0].evidence;
  assert.equal(evidence.quote, introduction.join('\n'));
  assert.equal(Array.from(text).slice(evidence.start, evidence.end).join(''), evidence.quote);
  assert.deepEqual(warnings.map(warning => warning.code), ['UNCLASSIFIED_LINE', 'PERSONAL_INFO_EXCLUDED']);

  for (const boundary of ['\n\n', '\nresume@example.com\n', '\n1. ']) {
    const separated = introduction[0] + boundary + introduction.slice(1).join('\n');
    const result = extractCandidates(pasted(separated), 'doc_1');
    assert.ok(result.facts.every(fact => !fact.statement.startsWith(introduction[0])));
  }
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

// 분류·묶음 보정(S1-30): 모델 응답은 분류와 위치만 바꾸고, 실패하거나 다시 집힌 작업에서는 규칙 분류 그대로 저장한다.
test('structure provider refines categories once; failure or a re-claimed task falls back to rule categories', async () => {
  const { folder, cleanup } = tempFolder('s01-structure-');
  const api = await startApi(folder, { autoExtract: false });
  try {
    const http = client(api, await login(api, 'erin'));
    const text = '경력\n예시랩 | 2019.03 - 현재\n배치 파이프라인 처리 시간을 40% 줄였습니다.\n서비스 운영을 맡았습니다.';
    const calls = [];
    // 같은 내용 중복 등록으로 묶이지 않게 줄 하나를 다르게 한다.
    let seq = 0;
    const upload = async () => (await http.post('/api/v1/resume-documents/text', { json: { text: text.replace('예시랩', `예시랩${++seq}`) } })).body;
    const draft = async id => (await http.get(`/api/v1/resume-documents/${id}/extraction`)).body;

    const first = await upload();
    const ok = { classify: async input => { calls.push(input); return { items: [{ n: input.lines.length - 1, category: 'achievement', under: null }, { n: 999, category: 'role', under: null }], adds: [] }; } };
    assert.equal(await runExtractionTask({ ...api.extraction, structure: ok }, first.task.id), 'completed');
    const refined = await draft(first.resource_id);
    assert.equal(refined.facts.at(-1).category, 'achievement');
    assert.equal(refined.facts.at(-1).statement, '서비스 운영을 맡았습니다.');
    assert.equal(calls.length, 1);
    // 원문 전체가 함께 가고, 화면의 단계 표시가 읽는 전송 상태가 작업에 남는다.
    assert.ok(calls[0].context.source.some(line => line.text.includes('배치 파이프라인')));
    assert.equal((await http.get(`/api/v1/product-tasks/${first.task.id}`)).body.provider_transmission, 'completed');
    assert.deepEqual(calls[0].call, { workspaceId: calls[0].call.workspaceId, taskId: first.task.id, leaseGeneration: 1 });
    assert.ok(calls[0].lines.every(line => Object.keys(line).join() === 'n,category,statement'));

    const second = await upload();
    const broken = { classify: async () => { throw Object.assign(new Error('x'), { code: 'LINER_CALL_LIMIT' }); } };
    assert.equal(await runExtractionTask({ ...api.extraction, structure: broken }, second.task.id), 'completed');
    assert.equal((await draft(second.resource_id)).facts.at(-1).category, 'responsibility');
    assert.equal((await http.get(`/api/v1/product-tasks/${second.task.id}`)).body.provider_transmission, 'unknown');

    const third = await upload();
    api.db.prepare("UPDATE ce7_tasks SET state = 'running', lease_owner = 'dead-runner', lease_generation = 1, lease_until_ms = 1 WHERE id = ?").run(third.task.id);
    assert.equal(await runExtractionTask({ ...api.extraction, structure: ok }, third.task.id), 'completed');
    assert.equal(calls.length, 1, 're-claimed task does not send the paid call again');
    assert.equal((await draft(third.resource_id)).facts.at(-1).category, 'responsibility');
  } finally {
    await api.stop();
    cleanup();
  }
});
