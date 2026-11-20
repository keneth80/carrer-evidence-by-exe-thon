import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HR_PERSONA, HR_CRITERIA } from '../packages/liner/src/persona.ts';
import { buildChatRequest } from '../packages/liner/src/chat.ts';
import { buildReviewRequest } from '../packages/liner/src/review.ts';
import { buildSupplementRequest, buildReviewStageRequest, buildCriticRequest } from '../packages/liner/src/supplement.ts';
import { buildJdReviewRequest, buildTailorCriticRequest, buildJdExtractRequest } from '../packages/liner/src/tailor-stages.ts';

// 사용자 요청(2026-11-19): 모든 Liner 대화 호출은 HR 전문가 페르소나로 시작한다.
// 페르소나는 관점·말투만 정하고, 호출마다 있는 근거 규칙이 그대로 남아야 한다. 합성 자료만 쓴다(전송 없음).

const DAY = new Date('2026-11-19T00:00:00Z');
const PATTERNS = { family: 'general', label: '공통', principles: [], examples: [] };
const FACTS = [{ id: 'f1', category: 'skill', statement: 'React' }, { id: 'f2', category: 'responsibility', statement: '정산 화면을 개발했습니다.' }];
const JOB = { company_name: '예시회사 (합성)', title: '프론트엔드 개발자', content_text: 'React 개발', requirements: [{ id: 'r1', kind: 'required', text: 'React 개발 경험' }] };

const requests = {
  chat: () => buildChatRequest({ job: JOB, facts: FACTS, blocks: [], history: [], message: 'React를 강조해줘' }, 'balanced'),
  review: () => buildReviewRequest({ facts: FACTS, patterns: PATTERNS }, 'balanced', DAY),
  supplement: () => buildSupplementRequest({ facts: FACTS, patterns: PATTERNS, history: [], message: '정산 화면을 만들었어요.' }, 'balanced', DAY),
  supplementReview: () => buildReviewStageRequest({ facts: FACTS, patterns: PATTERNS, ruleFindings: [] }, 'balanced', DAY),
  supplementCritic: () => buildCriticRequest({ facts: FACTS, userMessages: [{ id: 'm1', content: '정산 화면을 만들었어요.' }], drafts: [{ index: 0, text: '정산 화면을 만들었습니다.', fact_ids: ['f2'] }] }, 'balanced', DAY),
  jdReview: () => buildJdReviewRequest({ job: JOB, facts: FACTS, checks: [] }, 'balanced', DAY),
  jdCritic: () => buildTailorCriticRequest({ job: JOB, facts: FACTS, userMessages: [], changes: [] }, 'balanced', DAY),
  jdExtract: () => buildJdExtractRequest({ job: JOB }, 'balanced'),
};

test('페르소나: HR 전문가 관점이며 규칙보다 앞서지 않고, 합격 단정·사칭·근거 없는 사실을 막는다', () => {
  assert.match(HR_PERSONA, /HR 전문가/);
  assert.match(HR_PERSONA, /규칙보다 앞서지 않/);
  assert.match(HR_PERSONA, /합격/);
  assert.match(HR_PERSONA, /실존/);
});

for (const [name, build] of Object.entries(requests)) {
  test(`Liner ${name} 요청: 시스템 메시지가 HR 전문가 페르소나로 시작하고 작업 규칙이 이어진다`, () => {
    const system = build().messages[0];
    assert.equal(system.role, 'system');
    assert.ok(system.content.startsWith(HR_PERSONA), 'persona first');
    assert.match(system.content, /이번 작업:/);
    // 정체성은 페르소나 하나뿐이다('너는 … 도우미다'가 다시 나오지 않는다).
    assert.equal((system.content.match(/너는 /g) ?? []).length, 1);
  });
}

test('서류 검토 기준: 점검·초안·공고 맞춤 호출에는 붙고, 근거 검토 호출에는 붙지 않는다. 수치는 사용자가 말한 것만', () => {
  assert.match(HR_CRITERIA, /사용자가 말한 수치만/);
  for (const name of ['chat', 'review', 'supplement', 'supplementReview', 'jdReview']) assert.ok(requests[name]().messages[0].content.includes(HR_CRITERIA), name);
  for (const name of ['supplementCritic', 'jdCritic']) assert.ok(!requests[name]().messages[0].content.includes(HR_CRITERIA), name);
});

test('내부 ID: 페르소나가 문장에 ID를 쓰지 말라고 하고, 서버는 설명 문장에서만 ID를 지우고 근거 필드는 그대로 둔다', async () => {
  const { withoutInternalIds, scrubProse } = await import('../packages/liner/src/scrub.ts');
  assert.match(HR_PERSONA, /내부 ID/);
  assert.equal(withoutInternalIds('운영 대시보드 경력(fact_005, fact_011)에 이어 붙일 수 있도록 정리했습니다.'), '운영 대시보드 경력에 이어 붙일 수 있도록 정리했습니다.');
  assert.equal(withoutInternalIds('요구(req_p1)와 블록 [blk_new_1]을 봤어요.'), '요구와 블록을 봤어요.');
  assert.equal(withoutInternalIds('ID 없는 문장은 그대로입니다.'), 'ID 없는 문장은 그대로입니다.');
  const raw = {
    reply: '경력(fact_005)을 보완했어요.', questions: ['fact_011 문장의 기간은요?'],
    findings: [{ fact_ids: ['fact_005'], title: '범위(fact_005)', detail: 'd', question: '언제(fact_005)였나요?' }],
    candidates: [{ statement: 'fact_005 그대로 둔다', supplements_fact_id: 'fact_005' }],
    drafts: [{ text: 'fact_001 원문', fact_ids: ['fact_001'], note: '어미(fact_001)만' }],
    verdicts: [{ index: 0, verdict: 'drop', reason: '근거(fact_009)에 없음' }],
    changes: [{ block_id: 'blk_1', before: 'blk_1 원문', after: 'req_1 원문', fact_ids: ['fact_1'], reason: '요구(req_1) 연결' }],
  };
  const out = scrubProse(raw);
  assert.equal(out.reply, '경력을 보완했어요.');
  assert.equal(out.questions[0], '문장의 기간은요?');
  assert.deepEqual(out.findings[0], { fact_ids: ['fact_005'], title: '범위', detail: 'd', question: '언제였나요?' });
  assert.deepEqual(out.candidates[0], raw.candidates[0], 'statement is evidence and stays verbatim');
  assert.deepEqual(out.drafts[0], { text: 'fact_001 원문', fact_ids: ['fact_001'], note: '어미만' });
  assert.equal(out.verdicts[0].reason, '근거에 없음');
  assert.deepEqual(out.changes[0], { ...raw.changes[0], reason: '요구 연결' });
  assert.equal(raw.reply, '경력(fact_005)을 보완했어요.', 'input is not mutated');
});

test('HR 전문가다운 결과: 서류 통과 영향 순서, 검토자 관점 설명, 상황·행동·결과 질문, 긴 경력은 최근 중심, 공백은 단정 없이 묻기, 강점 먼저', async () => {
  const { HR_REVIEW_GUIDE, HR_DRAFT_GUIDE } = await import('../packages/liner/src/persona.ts');
  for (const rule of [/서류 통과/, /검토자/, /상황.*행동.*결과/, /최근 5~7년/, /공백/, /강점/]) assert.match(HR_REVIEW_GUIDE, rule);
  for (const rule of [/동사/, /결과/, /근거/]) assert.match(HR_DRAFT_GUIDE, rule);
  assert.ok(requests.supplementReview().messages[0].content.includes(HR_REVIEW_GUIDE));
  assert.ok(requests.review().messages[0].content.includes(HR_REVIEW_GUIDE));
  assert.ok(requests.jdReview().messages[0].content.includes(HR_REVIEW_GUIDE));
  assert.ok(requests.supplement().messages[0].content.includes(HR_DRAFT_GUIDE));
  assert.ok(requests.chat().messages[0].content.includes(HR_DRAFT_GUIDE));
  for (const name of ['supplementCritic', 'jdCritic']) assert.ok(!requests[name]().messages[0].content.includes(HR_REVIEW_GUIDE), name);
});

test('표현 다듬기(품질 검증 2026-11-20): 점검 제목은 해요체 서술문, 답에 입력 필드 이름·영어 상태값 금지, 수정 답은 실제 changes만 말한다', async () => {
  const { FINDING_LENGTH_RULE, TITLE_TONE_RULE } = await import('../packages/liner/src/persona.ts');
  assert.match(TITLE_TONE_RULE, /해요체/);
  assert.ok(FINDING_LENGTH_RULE.includes(TITLE_TONE_RULE));
  for (const name of ['review', 'supplementReview', 'jdReview']) assert.ok(requests[name]().messages[0].content.includes(TITLE_TONE_RULE), name);
  for (const word of ['checks', 'facts', 'met', 'weak', 'missing']) assert.ok(HR_PERSONA.includes(word), `persona forbids field name ${word} in prose`);
  assert.match(requests.chat().messages[0].content, /changes에 실제로 담은 수정만/);
});
