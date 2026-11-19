// 사실 후보는 사용자가 직접 쓴 문장이어야 한다. 모델이 어미·조사를 조금 바꿨으면 사용자 메시지에서 가장 비슷한 문장
// (글자 겹침 60% 이상)을 대신 쓴다. 후보 문장은 항상 사용자 원문이며 AI 문장을 사실로 재수집하지 않는다(실호출 관찰, S4-14).
// 맞춤 대화(tailor_resume)와 기본 이력서 보완 대화(supplement_resume, S1-16)가 같은 규칙을 쓴다.

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

// '이 요구에 답하기'(‘요구’ 관련:)·'이 질문에 답하기'(‘질문’에 대한 답:)가 입력창 맨 앞에 붙이는 머리말.
// 무엇에 대한 답인지는 대화에 남기되, 경력 후보 문장에는 넣지 않는다. 뗀 나머지도 사용자 원문의 일부다.
// 맞춤 대화는 이미 쓴 글 다음 줄에 머리말을 붙이므로 줄마다 맨 앞을 본다.
const ANSWER_CONTEXT = /^[ \t]*‘[^’\n]{1,400}’[ \t]*(?:관련|에 대한 답)[ \t]*:[ \t]*/gm;
export function withoutAnswerContext(text: string): string {
  return text.replace(ANSWER_CONTEXT, '');
}

export function userSentenceFor(rawMessage: string, rawProposed: string): string | null {
  const userMessage = withoutAnswerContext(rawMessage);
  const proposed = withoutAnswerContext(rawProposed);
  const target = squash(proposed);
  if (!target) return null;
  if (squash(userMessage).includes(target)) return target;
  const sentences = userMessage.split(/(?<=[.!?。]|[요다]\.?)\s+|\n+/).map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const chars = (text: string) => Array.from(text.replace(/\s+/g, ''));
  let best: { text: string; score: number } | null = null;
  for (const sentence of sentences) {
    const pool = chars(sentence);
    let hits = 0;
    for (const char of chars(proposed)) { const at = pool.indexOf(char); if (at >= 0) { hits++; pool.splice(at, 1); } }
    const score = hits / Math.max(chars(proposed).length, chars(sentence).length);
    if (!best || score > best.score) best = { text: sentence, score };
  }
  return best && best.score >= 0.6 ? best.text : null;
}

// 메시지를 문장 단위로 나눈다(보완 대화 mock이 사용자 답변의 각 문장을 후보로 만들 때 쓴다).
export function sentencesOf(message: string): string[] {
  return withoutAnswerContext(message).split(/(?<=[.!?。]|[요다]\.?)\s+|\n+/).map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
