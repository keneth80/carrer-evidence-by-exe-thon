import { checkRequirements, JD_LIMITS, screenAssessments, screenExtractedRequirements, screenJdReview } from './jd-check.ts';
import type { CriticChange, JdFinding, RequirementCheck, TailorStageProvider } from './jd-check.ts';
import { isChatOutput } from './provider.ts';
import type { ChatCallContext, ChatJob, ChatOutput, ChatProvider, ChatRequirementCheck, ChatTurn } from './provider.ts';
import { researchJob } from './research.ts';
import type { ResearchProvider } from './research.ts';
import { guardReason, screenChanges } from './screen-changes.ts';
import { createTracker, LeaseLost } from './stage-tracker.ts';
import type { StageSummary, Tracker, Transmission, TurnProgress } from './stage-tracker.ts';
import { screenCritic } from './supplement.ts';
import type { FactLike, ProposedChange, ResumeBlock } from './types.ts';

// 공고(JD) 맞춤 점검·수정 오케스트레이션(DECISIONS S1-18). 보완 대화(S1-17)와 같은 4단계 구조다.
//  첫 턴(JD 점검): ① 요구사항 대조(모델 없음) → ② AI 점검(근거 약함·미기재 요구에 질문만). 문서는 고치지 않는다.
//   요구사항 목록이 없는 공고(실시간 검색 요약)는 ①에서 공고 글의 요구를 추출한 뒤 대조한다(인용 확인은 서버, 2026-11-20).
//  답변 턴: ③ 수정안 작성(기존 맞춤 대화 제안) → ④ 근거 검토(다른 호출이 수정안마다 keep/drop) → keep도 결정적 가드로 다시 거른다.
// ④가 실패하면(한도 거절·전송 불명·형식 오류) 수정안은 보이지 않는다(닫힌 쪽). 사용자 문장 후보는 검토 없이 기존 확인 절차로 남는다.
// stages provider가 없으면(기존 단일 호출 경로) ②·④를 건너뛰고 그 사실을 단계 기록에 남긴다.

export type TailorStageKey = 'match' | 'review' | 'draft' | 'critic';
export const TAILOR_STAGE_LABELS: Record<TailorStageKey, string> = { match: '요구사항 대조', review: 'HR 전문가 점검', draft: '수정안 작성', critic: '근거 검토' };
export type DroppedChange = { text: string; reason: string; by: 'critic' | 'guard' };
export type TailorPipelineSummary = {
  mode: 'staged' | 'single'; stages: StageSummary<TailorStageKey>[]; requirements_checked: number; ai_findings: number;
  changes_reviewed: number; dropped_changes: DroppedChange[]; changes_withheld: boolean;
};
export type TailorTurn = { kind: 'jd_check' | 'answer'; requirements: RequirementCheck[]; findings: JdFinding[]; pipeline: TailorPipelineSummary };
export type TailorPipelineDeps = {
  chat: ChatProvider; stages: TailorStageProvider | null; research?: ResearchProvider | null; taskId: string; now: () => number;
  report: (progress: TurnProgress<TailorStageKey>) => boolean;
  invoke: <T>(work: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  call?: ChatCallContext;
};
// checks: 직전 JD 점검의 요구사항 판정(답변 턴의 수정안 작성 자료). 없으면 공고 글만 보고 쓴다.
export type TailorPipelineInput = { job: ChatJob; facts: FactLike[]; blocks: ResumeBlock[]; history: ChatTurn[]; message: string | null; userMessages: { id: string; content: string }[]; checks?: ChatRequirementCheck[] };
export type TailorPipelineResult =
  | { kind: 'ok'; reply: string; changes: ProposedChange[]; questions: string[]; turn: TailorTurn; transmission: Transmission }
  | { kind: 'failed'; code: string; transmission: Transmission }
  | { kind: 'lease_lost' };

const KEYS: TailorStageKey[] = ['match', 'review', 'draft', 'critic'];
const DROPPED_LIMIT = 10;
type T = Tracker<TailorStageKey>;

const countOf = (checks: RequirementCheck[], status: RequirementCheck['status']) => checks.filter(check => check.status === status).length;
const changeText = (change: ProposedChange) => (change.after ?? change.before ?? `${change.operation} ${change.block_id}`).slice(0, 1000);

function summary(deps: TailorPipelineDeps, t: T, extra: Omit<TailorPipelineSummary, 'mode' | 'stages'>): TailorPipelineSummary {
  return { mode: deps.stages ? 'staged' : 'single', stages: t.summary(), ...extra };
}

type Matched = { checks: RequirementCheck[]; job: ChatJob; extracted: number; failed: string | null };

// ① 요구사항 대조. 공고에 요구 목록이 없고 추출 provider가 있으면 먼저 공고 글에서 요구를 뽑는다.
async function matchRequirements(deps: TailorPipelineDeps, source: TailorPipelineInput, t: T): Promise<Matched> {
  t.set('match', 'running');
  // 정보가 부족하면 먼저 검색으로 보충한다(S1-29): 요약뿐인 공고 글, 회사 참고 정보. 실패해도 점검은 계속한다.
  const researched = deps.research ? await researchJob(deps.research, source.job, work => t.call(work), deps.call) : null;
  const input = researched ? { ...source, job: researched.job } : source;
  const found = await matchWith(deps, input, t);
  if (researched?.note) t.set('match', found.failed ? 'failed' : 'done', `${t.summary().find(stage => stage.key === 'match')?.note ?? ''} · ${researched.note}`);
  return found;
}

async function matchWith(deps: TailorPipelineDeps, input: TailorPipelineInput, t: T): Promise<Matched> {
  const extract = deps.stages?.extract;
  if (input.job.requirements.length > 0 || !extract) {
    const checks = await assess(deps, input, input.job, checkRequirements(input.facts, input.job), t);
    t.set('match', 'done', countsOf(checks.checks) + checks.note);
    return { checks: checks.checks, job: input.job, extracted: 0, failed: null };
  }
  const got = await t.call(signal => extract({ job: input.job, signal, call: deps.call }));
  const requirements = got.ok ? screenExtractedRequirements(got.value, input.job.content_text) : null;
  if (!requirements) {
    const code = got.ok ? 'CHAT_OUTPUT_INVALID' : got.code;
    t.set('match', 'failed', `요구사항 추출 실패(${code})`);
    return { checks: [], job: input.job, extracted: 0, failed: code };
  }
  const job = { ...input.job, requirements };
  const checks = await assess(deps, input, job, checkRequirements(input.facts, job), t);
  t.set('match', 'done', `${sourceName(job)}에서 요구사항 ${requirements.length}개 추출 · ${countsOf(checks.checks)}${checks.note}`);
  return { checks: checks.checks, job, extracted: requirements.length, failed: null };
}

const sourceName = (job: ChatJob) => job.content_source === 'pasted' ? '붙여넣은 공고 본문' : job.content_source === 'searched' ? '공고 글(검색 보충)' : '공고 글';

// 근거 판정(S1-28): 규칙 대조 결과를 HR 판정 호출이 요구마다 다시 본다. 실패하면 규칙 대조 결과를 그대로 쓰고 그 사실을 단계 기록에 남긴다.
async function assess(deps: TailorPipelineDeps, input: TailorPipelineInput, job: ChatJob, checks: RequirementCheck[], t: T): Promise<{ checks: RequirementCheck[]; note: string }> {
  const run = deps.stages?.assess;
  if (!run || checks.length === 0) return { checks, note: '' };
  const got = await t.call(signal => run({ job, facts: input.facts, blocks: input.blocks, checks, signal, call: deps.call }));
  const judged = got.ok ? screenAssessments(got.value, checks, input.facts, input.blocks) : null;
  if (!judged) return { checks, note: ` · HR 근거 판정 실패(${got.ok ? 'CHAT_OUTPUT_INVALID' : got.code}), 규칙 대조만 했어요` };
  return { checks: judged, note: ` · HR 근거 판정 ${judged.filter(check => check.judged_by === 'ai').length}개` };
}

const countsOf = (checks: RequirementCheck[]) => `충족 ${countOf(checks, 'met')} · 근거 약함 ${countOf(checks, 'weak')} · 미기재 ${countOf(checks, 'missing')}`;
const NO_TABLE = '공고 원문을 열어 자격 요건을 확인해 주세요. \'이 공고에 맞춰 수정해줘\'로 공고 요약 기준 수정안은 받을 수 있어요.';

async function jdCheckTurn(deps: TailorPipelineDeps, input: TailorPipelineInput, t: T): Promise<TailorPipelineResult> {
  const { checks, job, extracted, failed: extractFailed } = await matchRequirements(deps, input, t);
  const counts = countsOf(checks);
  let screened: ReturnType<typeof screenJdReview> = null;
  let failed: string | null = null;
  if (!deps.stages) t.set('review', 'skipped', 'HR 전문가 점검 provider가 설정되지 않았어요');
  // 대조할 요구가 없으면 유료 점검 호출을 하지 않는다(빈 점검표에 질문을 받을 수 없다).
  else if (checks.length === 0) t.set('review', 'skipped', '대조할 요구사항이 없어요');
  else {
    t.set('review', 'running');
    const stages = deps.stages;
    const reviewed = await t.call(signal => stages.review({ job, facts: input.facts, checks, signal, call: deps.call }));
    screened = reviewed.ok ? screenJdReview(reviewed.value, checks, input.facts) : null;
    failed = !reviewed.ok ? reviewed.code : screened ? null : 'CHAT_OUTPUT_INVALID';
    t.set('review', failed ? 'failed' : 'done', failed ? `실패(${failed})` : `질문 ${screened!.findings.length}개`);
  }
  t.set('draft', 'skipped', 'JD 점검에는 수정안이 없어요');
  t.set('critic', 'skipped', 'JD 점검에는 수정안이 없어요');
  const findings = screened?.findings ?? [];
  // AI 점검 실패를 숨기지 않는다: 대조 결과만 보여 준다고 답에 적는다. 추출한 요구는 요약에서 읽었다고 밝힌다.
  const pasted = job.content_source === 'pasted';
  const source = extracted > 0 ? (pasted ? `붙여넣은 공고 본문에서 요구사항 ${extracted}개를 읽어 확정 경력과 대조했어요(${counts}).` : `공고 글(검색 요약)에서 요구사항 ${extracted}개를 읽어 확정 경력과 대조했어요(${counts}). 요약에서 읽은 목록이라 공고 원문과 다를 수 있어요.`) : `요구사항 ${checks.length}개를 확정 경력과 대조했어요(${counts}).`;
  const reply = checks.length === 0
    ? `${extractFailed ? `공고에서 요구사항을 읽지 못했어요(${extractFailed}).` : '이 공고 글에서는 대조할 요구사항을 찾지 못했어요.'} ${NO_TABLE}`
    : screened?.reply ? (extracted > 0 ? `${screened.reply}\n\n${pasted ? '(요구사항은 붙여넣은 공고 본문에서 읽었어요.)' : job.content_source === 'searched' ? '(공고 요약이 짧아 같은 공고를 검색해 내용을 보충하고 요구사항을 읽었어요. 원문과 다를 수 있으니 공고 본문을 붙여넣으면 더 정확해요.)' : '(요구사항은 검색 요약에서 읽었어요. 공고 원문과 다를 수 있어요. 공고 본문을 붙여넣으면 더 정확해요.)'}` : screened.reply)
    : failed ? `${source} HR 전문가 점검은 하지 못했어요(${failed}). 근거가 약한 요구를 직접 말씀해 주시면 수정안을 만들어 드릴게요.` : `${source} 근거가 약한 요구에 대해 알려 주시면 수정안을 만들어 드릴게요.`;
  const questions = [...new Set([...findings.map(item => item.question), ...(screened?.questions ?? [])])].slice(0, JD_LIMITS.questions);
  const turn: TailorTurn = { kind: 'jd_check', requirements: checks, findings, pipeline: summary(deps, t, { requirements_checked: checks.length, ai_findings: findings.length, changes_reviewed: 0, dropped_changes: [], changes_withheld: false }) };
  return { kind: 'ok', reply, changes: [], questions, turn, transmission: t.transmission() };
}

type Reviewed = { kept: ProposedChange[]; dropped: DroppedChange[]; withheld: boolean };

// ④ 근거 검토: 수정안(사실 확인 후보 제외)마다 판정을 받는다. 판정이 없으면 빼고, 호출·형식이 실패하면 모두 보류한다.
async function criticize(deps: TailorPipelineDeps, input: TailorPipelineInput, edits: ProposedChange[], t: T): Promise<Reviewed> {
  if (edits.length === 0) { t.set('critic', 'skipped', '검토할 수정안이 없어요'); return { kept: [], dropped: [], withheld: false }; }
  if (!deps.stages) { t.set('critic', 'skipped', '근거 검토 provider가 없어 결정적 검사만 했어요'); return { kept: edits, dropped: [], withheld: false }; }
  t.set('critic', 'running');
  const stages = deps.stages;
  const changes: CriticChange[] = edits.map((change, index) => ({ index, operation: change.operation, before: change.before, after: change.after, fact_ids: change.fact_ids }));
  const judged = await t.call(signal => stages.critic({ job: input.job, facts: input.facts, userMessages: input.userMessages, changes, signal, call: deps.call }));
  const verdicts = judged.ok ? screenCritic(judged.value, edits.length) : null;
  if (!verdicts) {
    t.set('critic', 'failed', `수정안 ${edits.length}개 보류(${judged.ok ? 'CHAT_OUTPUT_INVALID' : judged.code})`);
    return { kept: [], dropped: [], withheld: true };
  }
  const kept: ProposedChange[] = [];
  const dropped: DroppedChange[] = [];
  edits.forEach((change, index) => {
    const verdict = verdicts.get(index);
    if (verdict?.verdict === 'keep') kept.push(change);
    else dropped.push({ text: changeText(change), reason: verdict?.reason ?? '검토 판정이 없어 뺐어요.', by: 'critic' });
  });
  return { kept, dropped, withheld: false };
}

async function answerTurn(deps: TailorPipelineDeps, input: TailorPipelineInput, message: string, t: T): Promise<TailorPipelineResult> {
  t.set('match', 'skipped', '답변 턴에는 다시 하지 않아요');
  t.set('review', 'skipped', '답변 턴에는 다시 하지 않아요');
  t.set('draft', 'running');
  const drafted = await t.call(signal => deps.chat.respond({ job: input.job, facts: input.facts, blocks: input.blocks, history: input.history, message, checks: input.checks, signal, call: deps.call }));
  if (!drafted.ok) { t.set('draft', 'failed', `실패(${drafted.code})`); return { kind: 'failed', code: drafted.code, transmission: t.transmission() }; }
  if (!isChatOutput(drafted.value)) { t.set('draft', 'failed', '실패(CHAT_OUTPUT_INVALID)'); return { kind: 'failed', code: 'CHAT_OUTPUT_INVALID', transmission: t.transmission() }; }
  const output: ChatOutput = drafted.value;
  const edits = output.changes.filter(change => !change.needs_fact_confirmation);
  t.set('draft', 'done', `수정안 ${edits.length}개, 확인할 사실 ${output.changes.length - edits.length}개`);
  const reviewed = await criticize(deps, input, edits, t);
  // 판정 keep(또는 검토 없음)인 수정안과 사용자 문장 후보만 결정적 검사로 보낸다. 원래 순서를 지킨다.
  const passed = new Set(reviewed.kept);
  const forwarded = output.changes.filter(change => change.needs_fact_confirmation || passed.has(change));
  const screened = screenChanges({ ...output, changes: forwarded }, { blocks: input.blocks, facts: input.facts, userMessage: message });
  const survived = new Set(screened.changes);
  const guarded: DroppedChange[] = reviewed.kept.filter(change => !survived.has(change))
    .map(change => ({ text: changeText(change), reason: guardReason(change, input.facts) ?? '현재 문서와 맞지 않아 뺐어요.', by: 'guard' }));
  const dropped = [...reviewed.dropped, ...guarded].slice(0, DROPPED_LIMIT);
  if (deps.stages && edits.length > 0 && !reviewed.withheld) t.set('critic', 'done', `${edits.length - dropped.length}개 통과, ${dropped.length}개 제외`);
  const notes = reviewed.withheld ? ['근거 검토를 하지 못해 수정안은 보여 드리지 않아요. 내가 말한 경력 후보는 그대로 확인할 수 있어요.'] : [];
  const turn: TailorTurn = { kind: 'answer', requirements: [], findings: [], pipeline: summary(deps, t, { requirements_checked: 0, ai_findings: 0, changes_reviewed: deps.stages ? edits.length : 0, dropped_changes: dropped, changes_withheld: reviewed.withheld }) };
  // 품질 검증(2026-11-20): 답이 근거 검토에서 빠진 수정까지 했다고 말할 수 있다 → 뺀 수정안이 있으면 답에 알린다.
  const reply = dropped.length > 0 ? `${output.reply}\n\n근거 검토에서 수정안 ${dropped.length}개를 뺐어요. 위 설명 중 아래 수정안 목록에 없는 내용은 적용되지 않아요.` : output.reply;
  return { kind: 'ok', reply, changes: screened.changes, questions: [...new Set([...notes, ...screened.questions])], turn, transmission: t.transmission() };
}

export async function runTailorPipeline(deps: TailorPipelineDeps, input: TailorPipelineInput): Promise<TailorPipelineResult> {
  const t = createTracker<TailorStageKey>({
    taskId: deps.taskId, mode: deps.stages ? 'staged' : 'single', now: deps.now, providerMode: deps.chat.mode,
    report: progress => deps.report(progress as TurnProgress<TailorStageKey>), invoke: deps.invoke,
  }, KEYS, TAILOR_STAGE_LABELS, 'CHAT_PROVIDER_FAILED');
  try {
    return input.message === null ? await jdCheckTurn(deps, input, t) : await answerTurn(deps, input, input.message, t);
  } catch (error) {
    if (error instanceof LeaseLost) return { kind: 'lease_lost' };
    throw error;
  }
}
