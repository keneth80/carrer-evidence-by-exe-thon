import { screenExample } from './example.ts';
import type { ReviewItem } from './review-provider.ts';
import type { RolePatterns } from './patterns.ts';
import type { ChatCallContext } from './provider.ts';
import { createTracker, LeaseLost } from './stage-tracker.ts';
import type { StageProgress, Transmission, TurnProgress as GenericTurnProgress } from './stage-tracker.ts';
import { screenCritic } from './supplement.ts';
import type { DroppedDraft, PipelineSummary, SupplementCriticInput, UserMessage } from './supplement.ts';
import type { FactLike } from './types.ts';

// 점검 항목별 추천 문장(사용자 요청 2026-11-20: "완성 문장을 주고 고를 수 있게, 없으면 직접 쓰게", DECISIONS S1-24).
// 사용자가 항목에서 '문장 추천받기'를 누를 때만 만든다: ① 추천 문장 작성 → ② 근거 검토(다른 호출이 keep/drop).
// 추천 문장은 사실이 아니다. 확정 경력에 없는 수치·범위는 [빈칸]이고, 사용자가 고르고 채워 '내 문장'으로 반영할 때 근거(user_statement)가 된다.
// ②가 실패하면 추천 문장을 보여 주지 않는다(닫힌 쪽). 결정적 검사(screenExample)는 ① 직후와 ② 뒤에 모두 적용한다.

export const SUGGESTION_STYLES = ['concise', 'scope', 'result'] as const;
export type SuggestionStyle = typeof SUGGESTION_STYLES[number];
export const SUGGESTION_LABELS: Record<SuggestionStyle, string> = { concise: '간결형', scope: '범위형', result: '성과형' };
export type SuggestionOption = { style: SuggestionStyle; text: string; fact_ids: string[] };
export type SuggestionSet = { source_message_id: string; finding_index: number; finding_title: string; target_fact_ids: string[]; options: SuggestionOption[] };
export type SuggestInput = { facts: FactLike[]; finding: ReviewItem; patterns: RolePatterns; signal?: AbortSignal; call?: ChatCallContext };
export type SuggestProvider = {
  readonly mode: 'mock' | 'live';
  suggest(input: SuggestInput): Promise<unknown>;
  critic(input: SupplementCriticInput): Promise<unknown>;
};

export const SUGGEST_LIMITS = { options: 3, text: 300 } as const;
const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

// ① 응답 거르기: 형식이 틀리면 null(실패). 항목 단위 문제(근거 밖 표현·빈칸 안 숫자·평가어·중복·형식)는 그 문장만 뺀다.
export function screenSuggestions(raw: unknown, facts: FactLike[]): SuggestionOption[] | null {
  const value = record(raw);
  if (!value || !Array.isArray(value.options)) return null;
  const known = new Set(facts.map(fact => fact.id));
  const sources = facts.map(fact => fact.statement).join('\n');
  const kept: SuggestionOption[] = [];
  for (const entry of value.options) {
    const item = record(entry);
    const style = item?.style;
    if (!item || typeof style !== 'string' || !(SUGGESTION_STYLES as readonly string[]).includes(style)) continue;
    const text = screenExample(item.text, sources);
    if (!text || text.length > SUGGEST_LIMITS.text || kept.some(option => squash(option.text) === squash(text))) continue;
    const factIds = Array.isArray(item.fact_ids) ? [...new Set(item.fact_ids.filter((id): id is string => typeof id === 'string' && known.has(id)))] : [];
    kept.push({ style: style as SuggestionStyle, text, fact_ids: factIds });
    if (kept.length >= SUGGEST_LIMITS.options) break;
  }
  return kept;
}

// mock 추천(규칙 기반 합성 응답): 대상 문장 그대로(간결형), 범위 빈칸(범위형), 결과 빈칸(성과형).
export function mockSuggestions(input: Pick<SuggestInput, 'facts' | 'finding'>) {
  const target = input.facts.find(fact => input.finding.fact_ids.includes(fact.id));
  const base = target?.statement.replace(/\s+/g, ' ').trim() ?? '[한 일]을 했습니다.';
  const stem = base.replace(/(했|였|었|았)?습니다\.?$/, '').replace(/[.。]$/, '');
  const ids = target ? [target.id] : [];
  return { options: [
    { style: 'concise', text: base, fact_ids: ids },
    { style: 'scope', text: `[팀 인원]명 팀에서 [맡은 범위]를 맡아 ${base}`, fact_ids: ids },
    { style: 'result', text: `${stem}해 [무엇]을 [이전 값]에서 [이후 값]으로 바꿨습니다.`, fact_ids: ids },
  ] };
}

export type SuggestStageKey = 'draft' | 'critic';
export const SUGGEST_STAGE_LABELS: Record<SuggestStageKey, string> = { draft: '추천 문장 작성', critic: '근거 검토' };
export type SuggestProgress = GenericTurnProgress<SuggestStageKey> & { stages: StageProgress<SuggestStageKey>[] };
export type SuggestDeps = {
  provider: SuggestProvider; taskId: string; now: () => number;
  report: (progress: SuggestProgress) => boolean;
  invoke: <T>(work: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  call?: ChatCallContext;
};
export type SuggestPipelineInput = { facts: FactLike[]; finding: ReviewItem; patterns: RolePatterns; userMessages: UserMessage[]; sourceMessageId: string; findingIndex: number };
export type SuggestResult =
  | { kind: 'ok'; set: SuggestionSet; reply: string; pipeline: PipelineSummary; transmission: Transmission }
  | { kind: 'failed'; code: string; transmission: Transmission }
  | { kind: 'lease_lost' };

// 대상 문장이 속한 회사 구간(앞쪽 가장 가까운 회사 ~ 다음 회사 전). 실호출 관찰(2026-11-20): 이력서 전체를 근거로 주면
// 다른 회사의 수치('5명')를 대상 회사에 붙였다. 추천 작성·결정적 검사·근거 검토 모두 이 구간만 근거로 쓴다. 대상이 없으면 전체.
export function employerScope(facts: FactLike[], targetId: string | undefined): FactLike[] {
  const at = targetId ? facts.findIndex(fact => fact.id === targetId) : -1;
  if (at < 0) return facts;
  let start = at;
  while (start > 0 && facts[start].category !== 'employer') start--;
  if (facts[start].category !== 'employer') start = 0;
  let end = at + 1;
  while (end < facts.length && facts[end].category !== 'employer') end++;
  return facts.slice(start, end);
}

export async function runSuggestPipeline(deps: SuggestDeps, input: SuggestPipelineInput): Promise<SuggestResult> {
  const scope = employerScope(input.facts, input.finding.fact_ids[0]);
  const t = createTracker<SuggestStageKey>({ taskId: deps.taskId, mode: 'staged', now: deps.now, providerMode: deps.provider.mode, report: progress => deps.report(progress as SuggestProgress), invoke: deps.invoke },
    ['draft', 'critic'], SUGGEST_STAGE_LABELS, 'SUPPLEMENT_PROVIDER_FAILED');
  try {
    t.set('draft', 'running');
    const drafted = await t.call(signal => deps.provider.suggest({ facts: scope, finding: input.finding, patterns: input.patterns, signal, call: deps.call }));
    if (!drafted.ok) { t.set('draft', 'failed', `실패(${drafted.code})`); return { kind: 'failed', code: drafted.code, transmission: t.transmission() }; }
    const options = screenSuggestions(drafted.value, scope);
    if (!options) { t.set('draft', 'failed', '실패(SUPPLEMENT_OUTPUT_INVALID)'); return { kind: 'failed', code: 'SUPPLEMENT_OUTPUT_INVALID', transmission: t.transmission() }; }
    t.set('draft', 'done', `${options.length}개`);
    let kept: SuggestionOption[] = [];
    const dropped: DroppedDraft[] = [];
    let withheld = false;
    if (options.length === 0) t.set('critic', 'skipped', '검토할 문장이 없어요');
    else {
      t.set('critic', 'running');
      const judged = await t.call(signal => deps.provider.critic({ facts: scope, userMessages: input.userMessages, drafts: options.map((option, index) => ({ index, text: option.text, fact_ids: option.fact_ids })), signal, call: deps.call }));
      const verdicts = judged.ok ? screenCritic(judged.value, options.length) : null;
      if (!verdicts) { withheld = true; t.set('critic', 'failed', `추천 문장 ${options.length}개 보류(${judged.ok ? 'SUPPLEMENT_OUTPUT_INVALID' : judged.code})`); }
      else {
        options.forEach((option, index) => {
          const verdict = verdicts.get(index);
          if (verdict?.verdict === 'keep') kept.push(option);
          else dropped.push({ text: option.text, reason: verdict?.reason ?? '검토 판정이 없어 뺐어요.', by: 'critic' });
        });
        t.set('critic', 'done', `${kept.length}개 통과, ${dropped.length}개 제외`);
      }
    }
    if (withheld) kept = [];
    const set: SuggestionSet = { source_message_id: input.sourceMessageId, finding_index: input.findingIndex, finding_title: input.finding.title, target_fact_ids: input.finding.fact_ids, options: kept };
    const reply = withheld ? '근거 검토를 하지 못해 추천 문장은 보여 드리지 않아요. 직접 쓰기로 적어 주세요.'
      : kept.length === 0 ? '근거 안에서 쓸 수 있는 추천 문장을 찾지 못했어요. 직접 쓰기로 적어 주세요.'
      : `‘${input.finding.title}’에 쓸 문장 ${kept.length}개를 추천해요. 고르거나 직접 써 주세요.`;
    const pipeline: PipelineSummary = { mode: 'staged', stages: t.summary(), rule_findings: 0, ai_findings: 0, drafts_reviewed: options.length, dropped_drafts: dropped.slice(0, 5), drafts_withheld: withheld };
    return { kind: 'ok', set, reply, pipeline, transmission: t.transmission() };
  } catch (error) {
    if (error instanceof LeaseLost) return { kind: 'lease_lost' };
    throw error;
  }
}
