import { applyChanges } from './blocks.ts';
import { hasBlank } from './example.ts';
import { checkChange } from './guard.ts';
import { findSlop } from './slop.ts';
import { userSentenceFor } from './user-sentence.ts';
import type { ChatOutput } from './provider.ts';
import { TEXT_LIMIT } from './types.ts';
import type { FactLike, ProposedChange, ResumeBlock } from './types.ts';

// 공고 맞춤 대화 제안의 결정적 검사(S4-04 근거·S4-13 안티슬롭·적용 가능성). 대화 worker와 단계별 파이프라인(S1-18)이 같이 쓴다.
// 제외한 이유는 사용자에게 질문으로 보여준다. 사실 확인 변경은 사용자 메시지 안의 문장만 허용한다.

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

export type ScreenContext = { blocks: ResumeBlock[]; facts: FactLike[]; userMessage: string };

export function screenChanges(output: ChatOutput, context: ScreenContext): { changes: ProposedChange[]; questions: string[] } {
  const kept: ProposedChange[] = [];
  const questions = [...output.questions];
  for (const change of output.changes) {
    if (change.needs_fact_confirmation) {
      // 새 사실 후보는 사용자가 직접 쓴 문장 안의 표현만 허용한다(AI 문장을 사실로 재수집하지 않는다).
      const shaped = change.operation === 'insert' && change.before === null && !!change.after?.trim() && change.fact_ids.length === 0;
      const own = shaped ? userSentenceFor(context.userMessage, change.after!) : null;
      if (!shaped || change.after!.length > TEXT_LIMIT) questions.push(`사실 확인 후보의 형식이 맞지 않거나 ${TEXT_LIMIT}자를 넘어 제외했어요.`);
      else if (!own || own.length > TEXT_LIMIT) questions.push('사용자 메시지에 없는 내용을 경력 정보 후보로 만든 제안은 제외했어요.');
      // 작성 예시의 [빈칸]이 남은 문장은 아직 사실이 아니다(S1-22).
      else if (hasBlank(own)) questions.push('빈칸 [ ]이 남은 문장은 경력 정보 후보로 만들지 않았어요. 빈칸을 실제 내용으로 채우거나 지운 뒤 다시 보내 주세요.');
      else if (context.blocks.some(block => block.id === change.block_id) || kept.some(item => item.block_id === change.block_id)) questions.push('같은 내용이 이미 문서나 다른 제안에 있어 다시 넣지 않았어요.');
      else kept.push({ ...change, after: own });
      continue;
    }
    const issues = checkChange(change, context.facts);
    if (issues.length) { questions.push(`근거를 확인할 수 없어 제외한 제안이 있어요: ${issues[0].detail} 사실이라면 구체적으로 알려 주세요.`); continue; }
    // 안티슬롭(S4-13): AI가 새로 넣은 상투 표현·근거 없는 평가어가 있으면 문서에 넣지 않는다. 사용자 원문에 있던 표현은 허용한다.
    if (change.after !== null) {
      const own = [change.before ?? '', ...context.facts.filter(fact => change.fact_ids.includes(fact.id)).map(fact => fact.statement)];
      const slop = findSlop(change.after, own);
      if (slop.length) { questions.push(`'${slop.map(item => item.phrase).join("', '")}' 같은 상투적·과장 표현이 들어간 제안은 제외했어요. ${slop[0].hint}`); continue; }
    }
    // 실제 이력서 테스트(2026-11-21): 맞춤 요약에 본문 문장을 글자 그대로 다시 넣어 같은 문장이 두 번 나왔다.
    if (change.operation === 'insert' && change.after !== null && context.blocks.some(block => squash(block.text) === squash(change.after!))) {
      questions.push('이미 이력서에 있는 문장과 같은 요약 문장은 다시 넣지 않았어요.');
      continue;
    }
    const applied = applyChanges(context.blocks, [...kept.filter(item => !item.needs_fact_confirmation), change]);
    if (applied.ok) kept.push(change);
    else questions.push(`현재 문서와 맞지 않아 제외한 제안이 있어요: ${applied.message}`);
  }
  return { changes: kept, questions: [...new Set(questions)] };
}

// 결정적 검사가 한 제안을 뺀 이유 한 줄(단계 요약의 '뺀 수정안' 표시용). 통과하면 null.
export function guardReason(change: ProposedChange, facts: FactLike[]): string | null {
  const issues = checkChange(change, facts);
  if (issues.length) return issues[0].detail;
  if (change.operation === 'insert' && change.after !== null && facts.some(fact => squash(fact.statement) === squash(change.after!))) return '이미 이력서에 있는 문장과 같아요.';
  if (change.after !== null) {
    const own = [change.before ?? '', ...facts.filter(fact => change.fact_ids.includes(fact.id)).map(fact => fact.statement)];
    const slop = findSlop(change.after, own);
    if (slop.length) return `평가어·상투 표현: '${slop.map(item => item.phrase).join("', '")}'`;
  }
  return null;
}
