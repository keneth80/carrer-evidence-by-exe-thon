import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HR_PERSONA, HR_CRITERIA } from '../packages/liner/src/persona.ts';
import { buildChatRequest } from '../packages/liner/src/chat.ts';
import { buildReviewRequest } from '../packages/liner/src/review.ts';
import { buildSupplementRequest, buildReviewStageRequest, buildCriticRequest } from '../packages/liner/src/supplement.ts';
import { buildJdReviewRequest, buildTailorCriticRequest } from '../packages/liner/src/tailor-stages.ts';

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
