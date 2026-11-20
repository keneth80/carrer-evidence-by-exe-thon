import { FACT_CATEGORIES } from '../../resume/src/types.ts';
import type { FactCategory } from '../../resume/src/types.ts';
import { hasBlank, screenExample } from './example.ts';
import { checkSupported } from './guard.ts';
import { reviewFacts } from './review.ts';
import { REVIEW_LIMITS } from './review-provider.ts';
import type { ReviewItem } from './review-provider.ts';
import { findSlop } from './slop.ts';
import { sentencesOf, userSentenceFor } from './user-sentence.ts';
import type { RolePatterns } from './patterns.ts';
import type { ChatCallContext, ChatTurn } from './provider.ts';
import type { FactLike } from './types.ts';
import { mockSuggestions } from './suggest.ts';
import type { SuggestInput } from './suggest.ts';

// 기본 이력서 보완 대화(DECISIONS S1-16·S1-17). 에이전트는 확정 경력을 점검해 질문하고, 사용자가 답한 문장만 경력 후보로 돌려준다.
// - 후보(candidates)는 사용자 메시지 안의 문장이어야 한다(AI 문장을 사실로 재수집하지 않는다, S4-05와 같은 규칙).
// - 초안(drafts)은 다듬은 문장 제안일 뿐 사실이 아니다. 근거(확정 경력·사용자 답변)에 없는 숫자·기술·역할(S4-04)과 평가어가 있으면 버린다.
//   사용자가 초안을 쓰려면 본인 메시지로 다시 보내야 하고, 그때부터 그 문장이 후보가 될 수 있다.
// 단계별 실행 순서(규칙 점검 → AI 점검 / 초안 → 근거 검토)는 supplement-pipeline.ts가 정한다.

export type SupplementCandidate = { statement: string; category: FactCategory; supplements_fact_id: string | null; message_id: string };
export type SupplementDraft = { text: string; fact_ids: string[]; note: string };
export type StageSummary = { key: string; label: string; state: string; note: string | null };
export type DroppedDraft = { text: string; reason: string; by: 'critic' | 'guard' };
export type PipelineSummary = {
  mode: 'staged' | 'single'; stages: StageSummary[]; rule_findings: number; ai_findings: number;
  drafts_reviewed: number; dropped_drafts: DroppedDraft[]; drafts_withheld: boolean;
};
export type SupplementTurn = { reply: string; findings: ReviewItem[]; candidates: SupplementCandidate[]; drafts: SupplementDraft[]; questions: string[]; pipeline?: PipelineSummary };
export type SupplementInput = { facts: FactLike[]; patterns: RolePatterns; history: ChatTurn[]; message: string | null; signal?: AbortSignal; call?: ChatCallContext };
export type UserMessage = { id: string; content: string };
export type SupplementReviewInput = { facts: FactLike[]; patterns: RolePatterns; ruleFindings: ReviewItem[]; signal?: AbortSignal; call?: ChatCallContext };
export type CriticDraft = { index: number; text: string; fact_ids: string[] };
export type SupplementCriticInput = { facts: FactLike[]; userMessages: UserMessage[]; drafts: CriticDraft[]; signal?: AbortSignal; call?: ChatCallContext };
// provider는 모델 응답 원본을 돌려주고, 저장 전에 screen* 함수가 거른다.
// respond = 한 번에 답하는 호출(single 모드, staged의 ③ 초안 단계), review = ② AI 점검, critic = ④ 근거 검토.
export type SupplementProvider = {
  readonly mode: 'mock' | 'live';
  respond(input: SupplementInput): Promise<unknown>;
  review(input: SupplementReviewInput): Promise<unknown>;
  critic(input: SupplementCriticInput): Promise<unknown>;
  // 점검 항목별 추천 문장(S1-24). 사용자가 '문장 추천받기'를 누를 때만 부른다.
  suggest?(input: SuggestInput): Promise<unknown>;
};

export const SUPPLEMENT_LIMITS = { reply: 2000, candidates: 10, drafts: 5, questions: 8, statement: 1000, note: 300, question: 400, reason: 300 } as const;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const isText = (value: unknown, max: number, min = 1): value is string => typeof value === 'string' && value.trim().length >= min && value.length <= max;
const MEASURED = /\d+(\.\d+)?\s*(%|배|건|명|개|억|만\s*원|초|분|시간|개월|년)/;
const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const textList = (value: unknown, max: number): string[] => Array.isArray(value) ? value.filter((item): item is string => isText(item, max)).map(item => item.trim()) : [];

// sources: 확정 경력 문장 전체. 작성 예시(example)는 이 범위 안의 내용과 [빈칸]만 허용한다(S1-22).
export function screenFindings(value: unknown, known: Set<string>, sources: string): ReviewItem[] {
  if (!Array.isArray(value)) return [];
  const items: ReviewItem[] = [];
  for (const entry of value) {
    const item = record(entry);
    if (!item || !isText(item.title, REVIEW_LIMITS.title) || !isText(item.detail, REVIEW_LIMITS.detail)) continue;
    if (item.question !== null && !isText(item.question, REVIEW_LIMITS.question)) continue;
    const ids = Array.isArray(item.fact_ids) ? item.fact_ids.filter((id): id is string => typeof id === 'string' && known.has(id)) : [];
    items.push({ fact_ids: [...new Set(ids)], title: item.title.trim(), detail: item.detail.trim(), question: item.question === null ? null : String(item.question).trim(), example: screenExample(item.example, sources) });
    if (items.length >= REVIEW_LIMITS.items) break;
  }
  return items;
}

// 최근 메시지부터 찾아 사용자 원문 문장과 그 메시지 ID를 돌려준다.
function ownSentence(statement: string, messages: UserMessage[]): { text: string; message_id: string } | null {
  for (const message of [...messages].reverse()) {
    const text = userSentenceFor(message.content, statement);
    if (text) return { text, message_id: message.id };
  }
  return null;
}

export function screenCandidates(value: unknown, facts: FactLike[], messages: UserMessage[], questions: string[]): SupplementCandidate[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(facts.map(fact => fact.id));
  const existing = new Set(facts.map(fact => squash(fact.statement)));
  const kept: SupplementCandidate[] = [];
  for (const entry of value) {
    const item = record(entry);
    if (!item || !isText(item.statement, SUPPLEMENT_LIMITS.statement) || !FACT_CATEGORIES.includes(item.category as FactCategory)) continue;
    const own = ownSentence(item.statement, messages);
    // 작성 예시의 [빈칸]이 남은 문장은 아직 사실이 아니다(S1-22).
    if (own && hasBlank(own.text)) { questions.push('빈칸 [ ]이 남은 문장은 경력 후보로 만들지 않았어요. 빈칸을 실제 내용으로 채우거나 지운 뒤 다시 보내 주세요.'); continue; }
    if (!own || own.text.length > SUPPLEMENT_LIMITS.statement) { questions.push('사용자 메시지에 없는 내용은 경력 후보로 만들지 않았어요. 사실이면 직접 말해 주세요.'); continue; }
    if (existing.has(squash(own.text))) { questions.push('이미 확정 경력에 있는 문장은 후보로 다시 만들지 않았어요.'); continue; }
    if (kept.some(candidate => squash(candidate.statement) === squash(own.text))) continue;
    const target = typeof item.supplements_fact_id === 'string' && known.has(item.supplements_fact_id) ? item.supplements_fact_id : null;
    kept.push({ statement: own.text, category: item.category as FactCategory, supplements_fact_id: target, message_id: own.message_id });
    if (kept.length >= SUPPLEMENT_LIMITS.candidates) break;
  }
  return kept;
}

// 초안의 형식만 거른다(내용 검사는 guardDraft). 모르는 사실 ID는 뺀다.
export function parseDrafts(value: unknown, facts: FactLike[]): SupplementDraft[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(facts.map(fact => fact.id));
  const kept: SupplementDraft[] = [];
  for (const entry of value) {
    const item = record(entry);
    if (!item || !isText(item.text, SUPPLEMENT_LIMITS.statement) || !isText(item.note, SUPPLEMENT_LIMITS.note, 0)) continue;
    const factIds = Array.isArray(item.fact_ids) ? [...new Set(item.fact_ids.filter((id): id is string => typeof id === 'string' && known.has(id)))] : [];
    kept.push({ text: item.text.trim(), fact_ids: factIds, note: item.note.trim() });
    if (kept.length >= SUPPLEMENT_LIMITS.drafts) break;
  }
  return kept;
}

// 결정적 근거 가드(S4-04 + 안티슬롭). 문제가 있으면 이유, 없으면 null. 사용자 답변도 초안의 근거로 본다.
export function guardDraft(draft: SupplementDraft, facts: FactLike[], messages: UserMessage[]): string | null {
  const spoken: FactLike[] = messages.map(message => ({ id: `said:${message.id}`, category: 'other', statement: message.content }));
  const sources = [...facts.filter(fact => draft.fact_ids.includes(fact.id)), ...spoken];
  const issues = checkSupported(draft.text, sources.map(fact => fact.id), [...facts, ...spoken]);
  if (issues.length > 0) return `근거(확정 경력·내 답변)에 없는 표현: ${issues.map(issue => issue.detail).join(' ')}`.slice(0, SUPPLEMENT_LIMITS.reason);
  const slop = findSlop(draft.text, sources.map(fact => fact.statement));
  if (slop.length > 0) return `평가어·상투 표현: “${slop.map(item => item.phrase).join('”, “')}”`.slice(0, SUPPLEMENT_LIMITS.reason);
  return null;
}

function screenDrafts(value: unknown, facts: FactLike[], messages: UserMessage[], questions: string[]): SupplementDraft[] {
  return parseDrafts(value, facts).filter(draft => {
    const reason = guardDraft(draft, facts, messages);
    if (reason) questions.push(reason.startsWith('평가어') ? '평가어·상투 표현이 들어간 초안은 뺐어요.' : '근거(확정 경력·내 답변)에 없는 수치·기술·역할이 들어간 초안은 뺐어요.');
    return !reason;
  });
}

// single 모드: 모델 응답 하나를 저장 전에 거른다. 형식 자체가 틀리면 null(작업 실패), 항목 단위 문제는 버리고 질문으로 알린다.
export function screenSupplement(raw: unknown, context: { facts: FactLike[]; userMessages: UserMessage[] }): SupplementTurn | null {
  const value = record(raw);
  if (!value || !isText(value.reply, SUPPLEMENT_LIMITS.reply, 0) || !Array.isArray(value.questions)) return null;
  const questions = textList(value.questions, SUPPLEMENT_LIMITS.question);
  const findings = screenFindings(value.findings, new Set(context.facts.map(fact => fact.id)), context.facts.map(fact => fact.statement).join('\n'));
  const candidates = screenCandidates(value.candidates, context.facts, context.userMessages, questions);
  const drafts = screenDrafts(value.drafts, context.facts, context.userMessages, questions);
  return { reply: value.reply.trim(), findings, candidates, drafts, questions: [...new Set(questions)].slice(0, SUPPLEMENT_LIMITS.questions) };
}

// ② AI 점검 단계 응답: { reply, findings, questions }.
export function screenReviewStage(raw: unknown, facts: FactLike[]): { reply: string; findings: ReviewItem[]; questions: string[] } | null {
  const value = record(raw);
  if (!value || !isText(value.reply, SUPPLEMENT_LIMITS.reply, 0) || !Array.isArray(value.findings) || !Array.isArray(value.questions)) return null;
  return { reply: value.reply.trim(), findings: screenFindings(value.findings, new Set(facts.map(fact => fact.id)), facts.map(fact => fact.statement).join('\n')), questions: textList(value.questions, SUPPLEMENT_LIMITS.question) };
}

// ③ 초안 단계 응답: 후보는 사용자 문장만 남기고, 초안은 형식만 거른 채 ④ 근거 검토로 넘긴다.
export function screenDraftStage(raw: unknown, context: { facts: FactLike[]; userMessages: UserMessage[] }): { reply: string; candidates: SupplementCandidate[]; drafts: SupplementDraft[]; questions: string[] } | null {
  const value = record(raw);
  if (!value || !isText(value.reply, SUPPLEMENT_LIMITS.reply, 0) || !Array.isArray(value.questions)) return null;
  const questions = textList(value.questions, SUPPLEMENT_LIMITS.question);
  const candidates = screenCandidates(value.candidates, context.facts, context.userMessages, questions);
  return { reply: value.reply.trim(), candidates, drafts: parseDrafts(value.drafts, context.facts), questions };
}

// ④ 근거 검토 응답: 초안 번호별 판정. 형식이 틀리면 null(초안 보류). 판정이 없는 초안은 호출부가 뺀다.
export function screenCritic(raw: unknown, count: number): Map<number, { verdict: 'keep' | 'drop'; reason: string }> | null {
  const value = record(raw);
  if (!value || !Array.isArray(value.verdicts)) return null;
  const verdicts = new Map<number, { verdict: 'keep' | 'drop'; reason: string }>();
  for (const entry of value.verdicts) {
    const item = record(entry);
    if (!item || !Number.isInteger(item.index) || (item.index as number) < 0 || (item.index as number) >= count) continue;
    if (item.verdict !== 'keep' && item.verdict !== 'drop') continue;
    const reason = isText(item.reason, SUPPLEMENT_LIMITS.reason) ? item.reason.trim() : (item.verdict === 'keep' ? '근거와 맞아요.' : '근거와 맞지 않아요.');
    if (!verdicts.has(item.index as number)) verdicts.set(item.index as number, { verdict: item.verdict, reason });
  }
  return verdicts;
}

// '했어요' 같은 대화체 어미만 이력서 문체로 바꾼 초안. 내용은 바꾸지 않는다.
// 과거형(았·었·였·했)과 '이에요/예요'만 바꾼다. '만들어요' 같은 현재형을 '었습니다'로 바꾸면 시제가 달라지므로 그대로 둔다.
function formal(sentence: string): string {
  return sentence.replace(/([았었였했])어요\.?$/, '$1습니다.').replace(/(이에요|예요|에요)\.?$/, '입니다.');
}

// mock 근거 검토: 근거(확정 경력·답변)에 없는 숫자·영문 기술명·범위 표현이 있으면 뺀다(규칙 기반 합성 판정).
const CRITIC_TOKENS = /\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9.+#-]*|리드|리딩|총괄|주도|이끌|책임|팀장/g;
function mockVerdict(draft: CriticDraft, sources: string): { index: number; verdict: 'keep' | 'drop'; reason: string } {
  // [빈칸]은 사용자가 채울 자리라 근거 위반이 아니다(S1-24 추천 문장).
  const missing = [...new Set(draft.text.replace(/\[[^\]\n]*\]/g, ' ').match(CRITIC_TOKENS) ?? [])].filter(token => !sources.includes(token));
  return missing.length > 0
    ? { index: draft.index, verdict: 'drop', reason: `근거에 없는 표현이 있어요: ${missing.join(', ')}` }
    : { index: draft.index, verdict: 'keep', reason: '답변·확정 경력에 있는 내용만 썼어요.' };
}

// mock 추가 점검: 규칙이 보지 않는 '범위 표현'을 확인 질문으로 만든다(규칙 기반 합성 응답).
const SCOPE = /(리드|리딩|총괄|주도|이끌|책임지)/;
function mockReviewFindings(facts: FactLike[], ruleFindings: ReviewItem[]): ReviewItem[] {
  const covered = new Set(ruleFindings.flatMap(item => item.fact_ids));
  return facts.filter(fact => SCOPE.test(fact.statement) && !covered.has(fact.id)).slice(0, 3).map(fact => ({
    fact_ids: [fact.id], title: '맡은 범위를 확인해 주세요', detail: '리드·총괄 같은 범위 표현은 팀 규모나 직접 맡은 일이 함께 있으면 더 정확해요.', question: '직접 맡은 범위와 함께한 인원을 알려 주실 수 있나요?',
    example: '[인원]명 팀에서 [직접 맡은 범위: 설계·일정·코드 리뷰 등]를 맡았습니다.',
  }));
}

// mock: 첫 턴은 규칙 점검(review.ts)을, 답변 턴은 사용자 문장을 그대로 후보로 돌려준다(규칙 기반 합성 응답).
export function createMockSupplementProvider(): SupplementProvider {
  return {
    mode: 'mock',
    async respond(input) {
      if (input.message === null) {
        const review = reviewFacts(input.facts);
        return {
          reply: `mock 점검(규칙 기반 합성 응답): 확정 경력 ${review.checked}개를 훑고 보완하면 좋은 점 ${review.findings.length}개를 찾았어요. 아래 질문에 답해 주시면 답한 문장을 경력 후보로 정리해 드릴게요.`,
          findings: review.findings.map(item => ({ fact_ids: item.fact_ids, title: item.title, detail: item.detail, question: item.question, example: item.example ?? null })),
          candidates: [], drafts: [], questions: [],
        };
      }
      const sentences = sentencesOf(input.message).filter(sentence => sentence.length >= 6 && !/[?？]$/.test(sentence)).slice(0, 5);
      const measured = sentences.some(sentence => MEASURED.test(sentence));
      return {
        reply: `mock 응답(규칙 기반 합성): 말씀하신 내용에서 경력 후보 ${sentences.length}개를 찾았어요. 본인 경력이 맞으면 '경력에 추가'를 눌러 주세요.`,
        findings: [],
        candidates: sentences.map(sentence => ({ statement: sentence, category: MEASURED.test(sentence) ? 'achievement' : 'responsibility', supplements_fact_id: null })),
        drafts: sentences.map(sentence => ({ text: formal(sentence), fact_ids: [], note: '대화체 어미를 이력서 문체로 바꿨어요. 내용은 그대로입니다.' })).filter((draft, index) => draft.text !== sentences[index]),
        questions: measured ? [] : ['결과를 숫자나 전후 변화로 말할 수 있나요? (예: 처리 시간, 사용자 수)'],
      };
    },
    async review(input) {
      const findings = mockReviewFindings(input.facts, input.ruleFindings);
      return {
        reply: `mock 점검(규칙 기반 합성 응답): 규칙 점검 ${input.ruleFindings.length}개에 더해 확인할 점 ${findings.length}개를 찾았어요. 질문에 답해 주시면 답한 문장을 경력 후보로 정리해 드릴게요.`,
        findings, questions: [],
      };
    },
    async critic(input) {
      const sources = [...input.facts.map(fact => fact.statement), ...input.userMessages.map(message => message.content)].join('\n');
      return { verdicts: input.drafts.map(draft => mockVerdict(draft, sources)) };
    },
    async suggest(input) {
      return mockSuggestions(input);
    },
  };
}
