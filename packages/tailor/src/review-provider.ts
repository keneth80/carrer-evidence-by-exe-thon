import { screenExample } from './example.ts';
import { reviewFacts } from './review.ts';
import type { RolePatterns } from './patterns.ts';
import type { ChatCallContext } from './provider.ts';
import type { FactLike } from './types.ts';

// AI 1차 점검 provider 경계(DECISIONS S1-14). 결과는 안내·질문이며 경력 사실·이력서 문장을 만들지 않는다.
// mock은 규칙 점검(review.ts)을 같은 모양으로 돌려준다. live는 Liner(packages/liner/src/review.ts).

// example: 작성 예시(S1-22, 계약 v0.7.7 선택 필드). 확정 경력에 없는 내용은 [빈칸]. 서버가 screenExample로 거른다.
export type ReviewItem = { fact_ids: string[]; title: string; detail: string; question: string | null; example?: string | null };
export type ReviewOutput = { summary: string; items: ReviewItem[] };
export type ReviewInput = { facts: FactLike[]; patterns: RolePatterns; signal?: AbortSignal; call?: ChatCallContext };
export type ReviewProvider = { readonly mode: 'mock' | 'live'; review(input: ReviewInput): Promise<ReviewOutput> };

export const REVIEW_LIMITS = { items: 15, title: 120, detail: 600, question: 400, summary: 800 } as const;

const isText = (value: unknown, max: number, min = 1) => typeof value === 'string' && value.trim().length >= min && value.length <= max;

// 모델 응답을 저장 전에 거른다: 형식이 틀린 항목·없는 사실 ID는 버리고, 항목 수를 제한한다. 남는 것이 없어도 실패는 아니다.
export function screenReview(raw: unknown, facts: FactLike[]): ReviewOutput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as { summary?: unknown; items?: unknown };
  if (!isText(value.summary, REVIEW_LIMITS.summary, 0) || !Array.isArray(value.items)) return null;
  const known = new Set(facts.map(fact => fact.id));
  const sources = facts.map(fact => fact.statement).join('\n');
  const items: ReviewItem[] = [];
  for (const entry of value.items) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Record<string, unknown>;
    if (!isText(item.title, REVIEW_LIMITS.title) || !isText(item.detail, REVIEW_LIMITS.detail)) continue;
    if (item.question !== null && !isText(item.question, REVIEW_LIMITS.question)) continue;
    const ids = Array.isArray(item.fact_ids) ? item.fact_ids.filter((id): id is string => typeof id === 'string' && known.has(id)) : [];
    items.push({ fact_ids: [...new Set(ids)], title: String(item.title).trim(), detail: String(item.detail).trim(), question: item.question === null ? null : String(item.question).trim(), example: screenExample(item.example, sources) });
    if (items.length >= REVIEW_LIMITS.items) break;
  }
  return { summary: String(value.summary).trim(), items };
}

export function createMockReviewProvider(): ReviewProvider {
  return {
    mode: 'mock',
    async review(input) {
      const review = reviewFacts(input.facts);
      return {
        summary: `mock 점검(규칙 기반 합성 응답): 확정 경력 ${review.checked}개에서 보완하면 좋은 점 ${review.findings.length}개를 찾았어요. 사실은 바꾸지 않았습니다.`,
        items: review.findings.map(item => ({ fact_ids: item.fact_ids, title: item.title, detail: item.detail, question: item.question, example: item.example ?? null })),
      };
    },
  };
}
