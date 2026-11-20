import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasBlank, ruleExample, screenExample, EXAMPLE_MAX } from '../packages/tailor/src/example.ts';
import { reviewFacts } from '../packages/tailor/src/review.ts';
import { screenReviewStage, screenSupplement } from '../packages/tailor/src/supplement.ts';
import { screenReview } from '../packages/tailor/src/review-provider.ts';
import { screenJdReview } from '../packages/tailor/src/jd-check.ts';
import { EXAMPLE_RULE } from '../packages/liner/src/persona.ts';
import { buildReviewStageRequest, buildSupplementRequest } from '../packages/liner/src/supplement.ts';
import { buildReviewRequest } from '../packages/liner/src/review.ts';
import { buildJdReviewRequest } from '../packages/liner/src/tailor-stages.ts';
import { MAX_COMPLETION_TOKENS, REVIEW_MAX_COMPLETION_TOKENS, reserveMicroUsd } from '../packages/liner/src/chat.ts';

// 사용자 요청(2026-11-20): "질문만 하지 말고 각 항목의 개선안을 같이 보여 줘. 어떻게 작성할 줄 모를 수도 있잖아."
// 점검 항목마다 작성 예시(example)를 붙인다. 확정 경력에 없는 수치·기술·범위는 [빈칸]으로 남기고, 서버가 다시 거른다.
// 합성 경력만 쓴다(전송 없음).

const FACTS = [
  { id: 'f1', category: 'responsibility', statement: 'Kafka 기반으로 주문 데이터 변경 사항을 동기화했습니다.' },
  { id: 'f2', category: 'achievement', statement: '정산 화면 로딩 시간을 3초에서 1초로 줄였습니다.' },
  { id: 'f3', category: 'role', statement: '프론트엔드 개발자' },
];
const SOURCES = FACTS.map(fact => fact.statement).join('\n');

test('빈칸 찾기: [채울 내용] 형식만 빈칸으로 본다', () => {
  assert.equal(hasBlank('주문 불일치를 [이전 건수]에서 [이후 건수]로 줄였습니다.'), true);
  assert.equal(hasBlank('주문 불일치를 줄였습니다.'), false);
  assert.equal(hasBlank('배열 a[0]'), true, 'any bracket pair counts; the user must edit it before sending');
});

test('작성 예시 거르기: 확정 경력에 있는 내용 + 빈칸은 남기고, 지어낸 수치·기술·범위·평가어는 뺀다', () => {
  const ok = 'Kafka 기반으로 주문 데이터 변경 사항을 동기화해 불일치를 [이전 건수]에서 [이후 건수]로 줄였습니다.';
  assert.equal(screenExample(ok, SOURCES), ok);
  assert.equal(screenExample('• 정산 화면 로딩 시간을 3초에서 1초로 줄였습니다.\n• [사용한 방법]을 적용했습니다.', SOURCES), '• 정산 화면 로딩 시간을 3초에서 1초로 줄였습니다.\n• [사용한 방법]을 적용했습니다.');
  assert.equal(screenExample('Kafka로 동기화해 불일치를 90% 줄였습니다.', SOURCES), null, 'invented number');
  assert.equal(screenExample('Kafka로 동기화해 불일치를 [예: 90%] 줄였습니다.', SOURCES), null, 'numbers inside a blank are invented too');
  assert.equal(screenExample('Flink로 주문 데이터를 동기화했습니다.', SOURCES), null, 'tech not in facts');
  assert.equal(screenExample('주문 데이터 동기화를 총괄했습니다.', SOURCES), null, 'scope inflation');
  assert.equal(screenExample('성공적으로 주문 데이터를 동기화했습니다.', SOURCES), null, 'evaluative word');
  assert.equal(screenExample('가'.repeat(EXAMPLE_MAX + 1), SOURCES), null);
  assert.equal(screenExample(null, SOURCES), null);
  assert.equal(screenExample('   ', SOURCES), null);
});

test('규칙 점검 항목의 예시: 긴 문장은 원래 문장을 나눠 보여 주고, 결과 없음·기간·직무는 빈칸 틀, 중복은 예시 없음', () => {
  const long = { id: 'l1', category: 'responsibility', statement: `${'차트 런타임을 설계했습니다. '.repeat(6)}렌더러를 분리해 같은 코어를 쓰게 했습니다. 대용량 데이터에는 다운샘플링을 적용하고 연산을 Web Worker로 분리하도록 했습니다.` };
  const facts = [
    { id: 'e1', category: 'employer', statement: '예시회사' },
    long,
    { id: 'd1', category: 'responsibility', statement: '정산 화면을 개발했습니다.' }, { id: 'd2', category: 'responsibility', statement: '정산 화면을 개발했습니다.' },
    { id: 's1', category: 'responsibility', statement: '탁월한 설계로 화면을 만들었습니다.' },
  ];
  const findings = reviewFacts(facts).findings;
  const byKind = kind => findings.find(item => item.kind === kind);
  const longExample = byKind('long_statement').example;
  assert.ok(longExample.split('\n').length >= 2, 'split into bullet lines');
  assert.ok(longExample.split('\n').every(line => line.startsWith('• ')));
  assert.ok(longExample.includes('대용량 데이터에는 다운샘플링을 적용하고 연산을 Web Worker로 분리하도록 했습니다.'), 'original sentences kept verbatim');
  assert.ok(hasBlank(byKind('no_result').example));
  assert.ok(hasBlank(byKind('missing_role').example));
  assert.ok(hasBlank(byKind('missing_period').example));
  assert.equal(byKind('duplicate').example, null);
  assert.doesNotMatch(byKind('slop').example, /탁월한/);
  assert.match(byKind('slop').example, /설계로 화면을 만들었습니다/);
  for (const item of findings) if (item.example) assert.doesNotMatch(item.example.replace(/\[[^\]]*\]/g, ''), /\d{2,}/, `${item.kind} has no invented numbers`);
});

test('AI 점검 응답(보완 대화 ② 단계·한 번 호출·1차 점검·JD 점검)의 example을 서버가 거른다', () => {
  const finding = (example, extra = {}) => ({ fact_ids: ['f1'], title: '결과가 보이지 않아요', detail: 'd', question: '기록이 있나요?', example, ...extra });
  const good = 'Kafka 기반으로 주문 데이터 변경 사항을 동기화해 불일치를 [이전 건수]에서 [이후 건수]로 줄였습니다.';
  const stage = screenReviewStage({ reply: 'r', questions: [], findings: [finding(good), finding('불일치를 90% 줄였습니다.', { title: '다른 항목' }), finding(null, { title: '세 번째' })] }, FACTS);
  assert.deepEqual(stage.findings.map(item => item.example), [good, null, null]);
  assert.equal(stage.findings.length, 3, 'a bad example drops only the example, not the finding');
  const single = screenSupplement({ reply: 'r', findings: [finding(good)], candidates: [], drafts: [], questions: [] }, { facts: FACTS, userMessages: [] });
  assert.equal(single.findings[0].example, good);
  const first = screenReview({ summary: 's', items: [finding('Flink로 동기화했습니다.')] }, FACTS);
  assert.equal(first.items[0].example, null);
  const checks = [{ requirement_id: 'r1', requirement: 'Kafka 운영 경험', importance: 'required', status: 'weak', fact_ids: ['f1'], note: 'n' }];
  const jd = screenJdReview({ reply: 'r', questions: [], findings: [{ requirement_id: 'r1', fact_ids: ['f1'], title: 't', question: 'q', example: '[운영한 클러스터 규모]의 Kafka를 운영했습니다.' }] }, checks, FACTS);
  assert.equal(jd.findings[0].example, '[운영한 클러스터 규모]의 Kafka를 운영했습니다.');
});

test('빈칸이 남은 사용자 문장은 경력 후보가 되지 않는다(서버 안전장치)', () => {
  const message = { id: 'm1', content: '주문 불일치를 [이전 건수]에서 [이후 건수]로 줄였습니다.' };
  const out = screenSupplement({ reply: 'r', findings: [], candidates: [{ statement: message.content, category: 'achievement', supplements_fact_id: null }], drafts: [], questions: [] }, { facts: FACTS, userMessages: [message] });
  assert.equal(out.candidates.length, 0);
});

test('Liner 점검 요청: 작성 예시 규칙·schema가 있고, 길어진 응답을 위해 출력 상한을 늘리며 예약 금액도 그만큼 잡는다', () => {
  const patterns = { family: 'general', label: '공통', principles: [], examples: [] };
  const checks = [{ requirement_id: 'r1', requirement: 'Kafka', importance: 'required', status: 'weak', fact_ids: ['f1'], note: 'n' }];
  const job = { company_name: '합성회사', title: '백엔드 개발자', content_text: 'Kafka', requirements: [] };
  const requests = {
    supplementReview: buildReviewStageRequest({ facts: FACTS, patterns, ruleFindings: [] }, 'balanced'),
    supplement: buildSupplementRequest({ facts: FACTS, patterns, history: [], message: null }, 'balanced'),
    review: buildReviewRequest({ facts: FACTS, patterns }, 'balanced'),
    jdReview: buildJdReviewRequest({ job, facts: FACTS, checks }, 'balanced'),
  };
  for (const [name, request] of Object.entries(requests)) {
    assert.ok(request.messages[0].content.includes(EXAMPLE_RULE), name);
    assert.equal(request.max_completion_tokens, REVIEW_MAX_COMPLETION_TOKENS, name);
    assert.match(JSON.stringify(request.response_format.json_schema.schema), /"example"/, name);
  }
  for (const rule of [/대괄호 빈칸/, /숫자를 넣지 않는다/, /지어내지/]) assert.match(EXAMPLE_RULE, rule);
  assert.ok(REVIEW_MAX_COMPLETION_TOKENS > MAX_COMPLETION_TOKENS);
  assert.ok(reserveMicroUsd('x', REVIEW_MAX_COMPLETION_TOKENS) > reserveMicroUsd('x'));
});
