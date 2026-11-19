import { reviewFacts } from './review.ts';
import { REVIEW_LIMITS } from './review-provider.ts';
import type { ReviewItem } from './review-provider.ts';
import { guardDraft, screenCritic, screenDraftStage, screenReviewStage, screenSupplement, SUPPLEMENT_LIMITS } from './supplement.ts';
import type { DroppedDraft, PipelineSummary, SupplementDraft, SupplementInput, SupplementProvider, SupplementTurn, UserMessage } from './supplement.ts';
import type { ChatCallContext } from './provider.ts';
import { createTracker, LeaseLost } from './stage-tracker.ts';
import type { PipelineMode, StageProgress, StageState, Tracker, Transmission, TurnProgress as GenericTurnProgress } from './stage-tracker.ts';

// 보완 대화 오케스트레이션(DECISIONS S1-17). 한 턴을 역할이 다른 단계로 나눈다.
//  ① 규칙 점검(모델 없음) → ② AI 점검(첫 턴): 규칙이 못 보는 문제·질문만 찾고 문장은 고치지 않는다.
//  ③ 초안(답변 턴): 사용자 문장 후보 + 다듬은 초안 → ④ 근거 검토: 다른 호출이 초안을 근거와 대조해 판정하고, 결정적 가드가 한 번 더 거른다.
// ④가 실패하면(한도 거절·전송 불명·형식 오류) 초안은 보여 주지 않는다(닫힌 쪽 실패). 보낸 뒤에는 재시도하지 않는다.
// 단계 기록·호출별 전송 상태는 공고 맞춤 대화(S1-18)와 같은 기록기(stage-tracker.ts)를 쓴다.

export type { PipelineMode, StageState, Transmission };
export type StageKey = 'rules' | 'review' | 'draft' | 'critic' | 'single';
export type TurnProgress = GenericTurnProgress<StageKey> & { stages: StageProgress<StageKey>[] };
export type PipelineDeps = {
  provider: SupplementProvider; mode: PipelineMode; taskId: string; now: () => number;
  report: (progress: TurnProgress) => boolean;
  invoke: <T>(work: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  call?: ChatCallContext;
};
export type PipelineInput = Omit<SupplementInput, 'signal' | 'call'> & { userMessages: UserMessage[] };
export type PipelineResult =
  | { kind: 'ok'; turn: SupplementTurn; transmission: Transmission }
  | { kind: 'failed'; code: string; transmission: Transmission }
  | { kind: 'lease_lost' };

export const STAGE_LABELS: Record<StageKey, string> = { rules: '규칙 점검', review: 'AI 점검', draft: '초안 작성', critic: '근거 검토', single: 'AI 응답' };

function tracker(deps: PipelineDeps, keys: StageKey[]): Tracker<StageKey> {
  return createTracker<StageKey>({ taskId: deps.taskId, mode: deps.mode, now: deps.now, providerMode: deps.provider.mode, report: progress => deps.report(progress as TurnProgress), invoke: deps.invoke }, keys, STAGE_LABELS, 'SUPPLEMENT_PROVIDER_FAILED');
}

const asItem = (finding: { fact_ids: string[]; title: string; detail: string; question: string | null }): ReviewItem => ({ fact_ids: finding.fact_ids, title: finding.title, detail: finding.detail, question: finding.question });
const sameFinding = (a: ReviewItem, b: ReviewItem) => a.title === b.title && a.fact_ids.join() === b.fact_ids.join();

async function firstTurn(deps: PipelineDeps, input: PipelineInput, t: Tracker<StageKey>): Promise<PipelineResult> {
  t.set('rules', 'running');
  const ruleFindings = reviewFacts(input.facts).findings.map(asItem);
  t.set('rules', 'done', `${ruleFindings.length}개`);
  t.set('review', 'running');
  const reviewed = await t.call(signal => deps.provider.review({ facts: input.facts, patterns: input.patterns, ruleFindings, signal, call: deps.call }));
  const screened = reviewed.ok ? screenReviewStage(reviewed.value, input.facts) : null;
  const aiFindings = (screened?.findings ?? []).filter(item => !ruleFindings.some(rule => sameFinding(rule, item)));
  const failedCode = !reviewed.ok ? reviewed.code : screened ? null : 'SUPPLEMENT_OUTPUT_INVALID';
  t.set('review', failedCode ? 'failed' : 'done', failedCode ? `실패(${failedCode})` : `${aiFindings.length}개 추가`);
  t.set('draft', 'skipped', '첫 점검에는 초안이 없어요');
  t.set('critic', 'skipped', '첫 점검에는 초안이 없어요');
  const findings = [...ruleFindings, ...aiFindings].slice(0, REVIEW_LIMITS.items);
  // AI 점검 실패를 숨기지 않는다: 규칙 점검 결과만 보여 준다고 답에 적는다.
  const reply = screened?.reply || (failedCode ? `규칙 점검 결과 ${ruleFindings.length}개를 보여 드려요. AI 점검은 하지 못했어요(${failedCode}). 질문에 답하시면 이어서 도와드릴게요.` : '점검을 마쳤어요.');
  const pipeline: PipelineSummary = { mode: 'staged', stages: t.summary(), rule_findings: Math.min(ruleFindings.length, findings.length), ai_findings: findings.length - Math.min(ruleFindings.length, findings.length), drafts_reviewed: 0, dropped_drafts: [], drafts_withheld: false };
  return { kind: 'ok', turn: { reply, findings, candidates: [], drafts: [], questions: (screened?.questions ?? []).slice(0, SUPPLEMENT_LIMITS.questions), pipeline }, transmission: t.transmission() };
}

// ④ 근거 검토: 판정 keep인 초안만 결정적 가드로 다시 거른다. 판정이 없거나 형식이 틀리면 초안을 내지 않는다.
async function criticize(deps: PipelineDeps, input: PipelineInput, drafts: SupplementDraft[], t: Tracker<StageKey>): Promise<{ drafts: SupplementDraft[]; dropped: DroppedDraft[]; withheld: boolean }> {
  if (drafts.length === 0) { t.set('critic', 'skipped', '검토할 초안이 없어요'); return { drafts: [], dropped: [], withheld: false }; }
  t.set('critic', 'running');
  const criticDrafts = drafts.map((draft, index) => ({ index, text: draft.text, fact_ids: draft.fact_ids }));
  const judged = await t.call(signal => deps.provider.critic({ facts: input.facts, userMessages: input.userMessages, drafts: criticDrafts, signal, call: deps.call }));
  const verdicts = judged.ok ? screenCritic(judged.value, drafts.length) : null;
  if (!verdicts) {
    t.set('critic', 'failed', `초안 ${drafts.length}개 보류(${judged.ok ? 'SUPPLEMENT_OUTPUT_INVALID' : judged.code})`);
    return { drafts: [], dropped: [], withheld: true };
  }
  const kept: SupplementDraft[] = [];
  const dropped: DroppedDraft[] = [];
  drafts.forEach((draft, index) => {
    const verdict = verdicts.get(index);
    if (!verdict || verdict.verdict === 'drop') { dropped.push({ text: draft.text, reason: verdict?.reason ?? '검토 판정이 없어 뺐어요.', by: 'critic' }); return; }
    const guard = guardDraft(draft, input.facts, input.userMessages);
    if (guard) dropped.push({ text: draft.text, reason: guard, by: 'guard' });
    else kept.push(draft);
  });
  t.set('critic', 'done', `${kept.length}개 통과, ${dropped.length}개 제외`);
  return { drafts: kept, dropped, withheld: false };
}

async function answerTurn(deps: PipelineDeps, input: PipelineInput, t: Tracker<StageKey>): Promise<PipelineResult> {
  t.set('rules', 'skipped', '답변 턴에는 다시 하지 않아요');
  t.set('review', 'skipped', '답변 턴에는 다시 하지 않아요');
  t.set('draft', 'running');
  const drafted = await t.call(signal => deps.provider.respond({ facts: input.facts, patterns: input.patterns, history: input.history, message: input.message, signal, call: deps.call }));
  if (!drafted.ok) { t.set('draft', 'failed', `실패(${drafted.code})`); return { kind: 'failed', code: drafted.code, transmission: t.transmission() }; }
  const stage = screenDraftStage(drafted.value, { facts: input.facts, userMessages: input.userMessages });
  if (!stage) { t.set('draft', 'failed', '실패(SUPPLEMENT_OUTPUT_INVALID)'); return { kind: 'failed', code: 'SUPPLEMENT_OUTPUT_INVALID', transmission: t.transmission() }; }
  t.set('draft', 'done', `후보 ${stage.candidates.length}개, 초안 ${stage.drafts.length}개`);
  const reviewed = await criticize(deps, input, stage.drafts, t);
  const notes = reviewed.withheld ? ['근거 검토를 하지 못해 다듬은 초안은 보여 드리지 않아요. 후보(내가 쓴 문장)는 그대로 추가할 수 있어요.'] : [];
  const pipeline: PipelineSummary = { mode: 'staged', stages: t.summary(), rule_findings: 0, ai_findings: 0, drafts_reviewed: stage.drafts.length, dropped_drafts: reviewed.dropped, drafts_withheld: reviewed.withheld };
  const questions = [...new Set([...notes, ...stage.questions])].slice(0, SUPPLEMENT_LIMITS.questions);
  return { kind: 'ok', turn: { reply: stage.reply, findings: [], candidates: stage.candidates, drafts: reviewed.drafts, questions, pipeline }, transmission: t.transmission() };
}

// 비교용 한 번 호출 모드(SUPPLEMENT_PIPELINE=single). 기존 S1-16 동작과 같다.
async function singleTurn(deps: PipelineDeps, input: PipelineInput, t: Tracker<StageKey>): Promise<PipelineResult> {
  t.set('single', 'running');
  const answered = await t.call(signal => deps.provider.respond({ facts: input.facts, patterns: input.patterns, history: input.history, message: input.message, signal, call: deps.call }));
  if (!answered.ok) { t.set('single', 'failed', `실패(${answered.code})`); return { kind: 'failed', code: answered.code, transmission: t.transmission() }; }
  const turn = screenSupplement(answered.value, { facts: input.facts, userMessages: input.userMessages });
  if (!turn) { t.set('single', 'failed', '실패(SUPPLEMENT_OUTPUT_INVALID)'); return { kind: 'failed', code: 'SUPPLEMENT_OUTPUT_INVALID', transmission: t.transmission() }; }
  t.set('single', 'done');
  const pipeline: PipelineSummary = { mode: 'single', stages: t.summary(), rule_findings: 0, ai_findings: turn.findings.length, drafts_reviewed: 0, dropped_drafts: [], drafts_withheld: false };
  return { kind: 'ok', turn: { ...turn, pipeline }, transmission: t.transmission() };
}

export async function runSupplementPipeline(deps: PipelineDeps, input: PipelineInput): Promise<PipelineResult> {
  const t = tracker(deps, deps.mode === 'single' ? ['single'] : ['rules', 'review', 'draft', 'critic']);
  try {
    if (deps.mode === 'single') return await singleTurn(deps, input, t);
    return input.message === null ? await firstTurn(deps, input, t) : await answerTurn(deps, input, t);
  } catch (error) {
    if (error instanceof LeaseLost) return { kind: 'lease_lost' };
    throw error;
  }
}
