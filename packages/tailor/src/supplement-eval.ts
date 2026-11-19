import { readdirSync, readFileSync } from 'node:fs';
import { patternsFor } from './patterns.ts';
import { runSupplementPipeline } from './supplement-pipeline.ts';
import type { PipelineMode } from './supplement-pipeline.ts';
import type { SupplementProvider, SupplementTurn, UserMessage } from './supplement.ts';
import type { ChatCallContext, ChatTurn } from './provider.ts';
import type { FactLike } from './types.ts';

// 보완 대화 single(한 번 호출)과 staged(단계별) 비교 평가(DECISIONS S1-17). 문제를 심어 둔 합성 이력서로
//  - recall: 심어 둔 문제(seeded_issues)를 첫 턴 점검이 몇 개 찾았나(fact_ids가 겹치거나 키워드가 나오면 찾은 것)
//  - inflated_drafts_shown: 사용자에게 보인 초안 중 답변·경력에 없는 표현(forbidden)이 든 것
//  - calls: 모델 호출 시도 수
// 를 센다. 확정 경력은 바꾸지 않는다(후보를 추가하지 않고 답변만 이어 간다).

export type EvalIssue = { id: string; note: string; fact_ids: string[]; keywords: string[] };
export type EvalAnswer = { text: string; adversarial: boolean; forbidden: string[] };
export type EvalFixture = { id: string; label: string; facts: FactLike[]; seeded_issues: EvalIssue[]; answers: EvalAnswer[] };
export type EvalRun = {
  fixture: string; mode: PipelineMode; seeded: number; found: string[]; missed: string[];
  drafts_shown: number; inflated_drafts_shown: number; inflated_examples: string[];
  dropped_by_critic: number; dropped_by_guard: number; drafts_withheld: number; calls: number; failures: string[];
};
export type EvalSummary = { seeded_issues: number; found: number; recall: number; drafts_shown: number; inflated_drafts_shown: number; calls: number; failures: number };
export type EvalReport = { runs: EvalRun[]; summary: Record<string, EvalSummary> };
export type EvalOptions = {
  fixtures: EvalFixture[]; provider: SupplementProvider; modes: PipelineMode[];
  // live 평가는 원장 lease 확인에 쓸 호출 맥락이 필요하다(스크립트가 임시 DB에 작업 행을 만든다).
  callFor?: (fixture: string, mode: PipelineMode) => ChatCallContext;
};

const FIXTURE_DIR = new URL('../../../fixtures/eval/supplement/', import.meta.url);

export function loadEvalFixtures(dir: URL = FIXTURE_DIR): EvalFixture[] {
  return readdirSync(dir).filter(name => name.endsWith('.synthetic.json')).sort()
    .map(name => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as EvalFixture);
}

// 호출 시도 수를 센다(성공·실패 모두).
function counted(provider: SupplementProvider): { provider: SupplementProvider; calls: () => number } {
  let calls = 0;
  const count = <T>(work: () => Promise<T>) => { calls++; return work(); };
  return {
    provider: { mode: provider.mode, respond: input => count(() => provider.respond(input)), review: input => count(() => provider.review(input)), critic: input => count(() => provider.critic(input)) },
    calls: () => calls,
  };
}

function foundIssues(turn: SupplementTurn | null, issues: EvalIssue[]): string[] {
  if (!turn) return [];
  return issues.filter(issue => turn.findings.some(finding => {
    const text = `${finding.title} ${finding.detail} ${finding.question ?? ''}`;
    return finding.fact_ids.some(id => issue.fact_ids.includes(id)) || issue.keywords.some(keyword => text.includes(keyword));
  })).map(issue => issue.id);
}

async function runOne(options: EvalOptions, fixture: EvalFixture, mode: PipelineMode): Promise<EvalRun> {
  const { provider, calls } = counted(options.provider);
  const patterns = patternsFor(fixture.facts.filter(fact => fact.category === 'role').map(fact => fact.statement));
  const call = options.callFor?.(fixture.id, mode);
  const deps = { provider, mode, taskId: `eval_${fixture.id}_${mode}`, now: () => 0, report: () => true, invoke: <T>(work: (signal: AbortSignal) => Promise<T>) => work(new AbortController().signal), call };
  const failures: string[] = [];
  const history: ChatTurn[] = [];
  const userMessages: UserMessage[] = [];
  const opening = await runSupplementPipeline(deps, { facts: fixture.facts, patterns, history: [], message: null, userMessages: [] });
  const first = opening.kind === 'ok' ? opening.turn : null;
  if (opening.kind === 'failed') failures.push(opening.code);
  if (first) history.push({ role: 'assistant', content: first.reply });
  const run: EvalRun = { fixture: fixture.id, mode, seeded: fixture.seeded_issues.length, found: [], missed: [], drafts_shown: 0, inflated_drafts_shown: 0, inflated_examples: [], dropped_by_critic: 0, dropped_by_guard: 0, drafts_withheld: 0, calls: 0, failures };
  run.found = foundIssues(first, fixture.seeded_issues);
  run.missed = fixture.seeded_issues.map(issue => issue.id).filter(id => !run.found.includes(id));
  for (const [index, answer] of fixture.answers.entries()) {
    const message = { id: `said_${index}`, content: answer.text };
    userMessages.push(message);
    const result = await runSupplementPipeline(deps, { facts: fixture.facts, patterns, history: [...history], message: answer.text, userMessages: [...userMessages] });
    history.push({ role: 'user', content: answer.text });
    if (result.kind !== 'ok') { failures.push(result.kind === 'failed' ? result.code : 'LEASE_LOST'); continue; }
    history.push({ role: 'assistant', content: result.turn.reply });
    const forbidden = answer.forbidden.map(pattern => new RegExp(pattern));
    const inflated = result.turn.drafts.filter(draft => forbidden.some(pattern => pattern.test(draft.text)));
    run.drafts_shown += result.turn.drafts.length;
    run.inflated_drafts_shown += inflated.length;
    run.inflated_examples.push(...inflated.map(draft => draft.text));
    run.dropped_by_critic += result.turn.pipeline?.dropped_drafts.filter(item => item.by === 'critic').length ?? 0;
    run.dropped_by_guard += result.turn.pipeline?.dropped_drafts.filter(item => item.by === 'guard').length ?? 0;
    run.drafts_withheld += result.turn.pipeline?.drafts_withheld ? 1 : 0;
  }
  return { ...run, calls: calls() };
}

function summarize(runs: EvalRun[]): EvalSummary {
  const seeded = runs.reduce((sum, run) => sum + run.seeded, 0);
  const found = runs.reduce((sum, run) => sum + run.found.length, 0);
  return {
    seeded_issues: seeded, found, recall: seeded ? Math.round((found / seeded) * 1000) / 1000 : 0,
    drafts_shown: runs.reduce((sum, run) => sum + run.drafts_shown, 0),
    inflated_drafts_shown: runs.reduce((sum, run) => sum + run.inflated_drafts_shown, 0),
    calls: runs.reduce((sum, run) => sum + run.calls, 0),
    failures: runs.reduce((sum, run) => sum + run.failures.length, 0),
  };
}

// 순서대로 실행한다(유료 호출이 겹치지 않게, 한도 초과 시 원장이 거절한다).
export async function runSupplementEval(options: EvalOptions): Promise<EvalReport> {
  const runs: EvalRun[] = [];
  for (const mode of options.modes) {
    for (const fixture of options.fixtures) runs.push(await runOne(options, fixture, mode));
  }
  const summary = Object.fromEntries(options.modes.map(mode => [mode, summarize(runs.filter(run => run.mode === mode))]));
  return { runs, summary };
}
