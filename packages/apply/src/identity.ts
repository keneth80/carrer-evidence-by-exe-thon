// 이름·이메일은 지원 건마다 같은 지원자 정보라 이전 지원서의 사용자 답변을 다시 쓸 수 있다(유사 공고 자동 준비와 같은 규칙).
// 지원 동기·동의는 공고마다 사용자가 직접 답한다. 가져온 값은 초안일 뿐이며, 사용자가 확인하고 저장해야 지원 내용이 된다.
export const IDENTITY_QUESTIONS = ['applicant_name', 'applicant_email'] as const;

type AnswerLike = { question_id: string; answer: string };
type ApplicationLike = { id: string; updated_at: string; current: { answers: AnswerLike[] } };

const time = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

// 현재 지원 건에서 비어 있는 이름·이메일만, 가장 최근에 고친 다른 지원 건의 비어 있지 않은 답변으로 채운다.
export function identityPrefill(currentId: string, current: AnswerLike[] | null | undefined, others: ApplicationLike[] | null | undefined): Record<string, string> {
  const filled = new Set((current ?? []).filter(item => item.answer.trim()).map(item => item.question_id));
  const sources = (others ?? []).filter(item => item.id !== currentId).sort((a, b) => time(b.updated_at) - time(a.updated_at));
  const prefill: Record<string, string> = {};
  for (const questionId of IDENTITY_QUESTIONS) {
    if (filled.has(questionId)) continue;
    const found = sources.flatMap(item => item.current.answers).find(item => item.question_id === questionId && item.answer.trim());
    if (found) prefill[questionId] = found.answer.trim();
  }
  return prefill;
}
