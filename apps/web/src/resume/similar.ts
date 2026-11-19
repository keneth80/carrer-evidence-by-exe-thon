import type { ResumeFact } from '../../../../packages/resume/src/types.ts';

// 보완 대화 후보와 거의 같은 확정 항목 찾기(DECISIONS S1-17). 대화체로 말한 문장과 다듬은 문장을 둘 다 추가하면
// 같은 내용이 두 번 남으므로, 공백·문장부호·어미만 다른 항목은 '기존 항목 바꾸기' 대상으로 보여 준다.

// 긴 어미부터 지운다('했습니다'를 '니다'보다 먼저). 내용 단어는 건드리지 않는다.
const ENDINGS = /(했습니다|하였습니다|였습니다|었습니다|았습니다|습니다|입니다|합니다|했어요|였어요|었어요|았어요|이에요|에요|해요|어요|아요|했음|였음|었음|았음|했다|였다|었다|았다|함|임|음)$/;

export function normalizeStatement(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s.,·!?'"“”‘’()[\]{}…~-]+/g, '').replace(ENDINGS, '');
}

type CandidateLike = { statement: string; supplements_fact_id: string | null };

// 바꿀 대상: 에이전트가 지목한 보완 대상이 있으면 그것, 없으면 어미만 다른 기존 항목. 글자까지 같으면 이미 추가된 것이라 대상이 없다.
export function replaceTarget(candidate: CandidateLike, facts: ResumeFact[]): ResumeFact | null {
  const exact = facts.some(fact => fact.statement.replace(/\s+/g, ' ').trim() === candidate.statement.replace(/\s+/g, ' ').trim());
  if (exact) return null;
  if (candidate.supplements_fact_id) {
    const named = facts.find(fact => fact.id === candidate.supplements_fact_id);
    if (named) return named;
  }
  const key = normalizeStatement(candidate.statement);
  return key ? facts.find(fact => normalizeStatement(fact.statement) === key) ?? null : null;
}

// 대상 항목 자리에 새 항목을 넣은 새 배열. 원래 배열은 바꾸지 않는다.
export function replaceFact(facts: ResumeFact[], targetId: string, next: ResumeFact): ResumeFact[] {
  return facts.map(fact => fact.id === targetId ? next : fact);
}
