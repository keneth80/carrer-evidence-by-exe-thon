import type { SupplementProgress, SupplementStage } from './api.ts';

// 에이전트 진행 표시 계산(DECISIONS S1-17·S1-18). 화면 컴포넌트(AgentProgress)와 분리해 테스트한다.
// 보완 대화와 공고(JD) 맞춤 대화가 같은 계산을 쓰고, 단계 이름·지금 하는 일 문구만 profile로 다르게 준다.
// 단계 이름은 서버(supplement-pipeline.ts STAGE_LABELS, tailor-pipeline.ts TAILOR_STAGE_LABELS)와 같다. 진행 기록이 오기 전(작업 대기)에만 이 기본값을 쓴다.

export type ProgressProfile = { keys: string[]; labels: Record<string, string>; doing: Record<string, string>; firstTurnSkips: string[]; answerTurnSkips: string[]; singleKey: string | null };

export const SUPPLEMENT_PROGRESS: ProgressProfile = {
  keys: ['rules', 'review', 'draft', 'critic'],
  labels: { rules: '규칙 점검', review: 'HR 전문가 점검', draft: '초안 작성', critic: '근거 검토', single: 'HR 전문가 응답' },
  doing: {
    rules: '규칙으로 확정 경력을 훑고 있어요',
    review: 'HR 전문가가 규칙이 못 본 문제를 찾고 있어요',
    draft: '답변으로 경력 후보와 문장 초안을 만들고 있어요',
    critic: '초안이 확정 경력·내 답변과 맞는지 검토하고 있어요',
    single: 'HR 전문가가 답변을 만들고 있어요',
  },
  firstTurnSkips: ['draft', 'critic'], answerTurnSkips: ['rules', 'review'], singleKey: 'single',
};

export const TAILOR_PROGRESS: ProgressProfile = {
  keys: ['match', 'review', 'draft', 'critic'],
  labels: { match: '요구사항 대조', review: 'HR 전문가 점검', draft: '수정안 작성', critic: '근거 검토' },
  doing: {
    match: '공고 요구사항을 확정 경력과 하나씩 대조하고 있어요',
    review: 'HR 전문가가 근거가 약한 공고 요구를 찾아 질문을 만들고 있어요',
    draft: '공고에 맞춘 수정안(변경 전후)을 만들고 있어요',
    critic: '수정안이 확정 경력·내 답변과 맞는지 검토하고 있어요',
  },
  firstTurnSkips: ['draft', 'critic'], answerTurnSkips: ['match', 'review'], singleKey: null,
};

// 보완 대화 단계 이름(서버 supplement-pipeline.ts STAGE_LABELS와 같아야 한다 — 테스트가 대조한다).
export const STAGE_LABELS = SUPPLEMENT_PROGRESS.labels;

export type ProgressView = { stages: SupplementStage[]; position: number; total: number; percent: number; message: string; currentKey: string | null };

function defaultStages(mode: 'staged' | 'single', firstTurn: boolean, profile: ProgressProfile): SupplementStage[] {
  if (mode === 'single' && profile.singleKey) return [{ key: profile.singleKey, label: profile.labels[profile.singleKey], state: 'pending', note: null }];
  const skipped = firstTurn ? profile.firstTurnSkips : profile.answerTurnSkips;
  return profile.keys.map(key => ({ key, label: profile.labels[key], state: skipped.includes(key) ? 'skipped' : 'pending', note: null }));
}

// progress가 이 작업(taskId) 것이 아니면(이전 턴 기록) 기본 단계로 본다.
export function progressView(progress: SupplementProgress | null, taskId: string | null, mode: 'staged' | 'single', firstTurn: boolean, profile: ProgressProfile = SUPPLEMENT_PROGRESS): ProgressView {
  const own = progress && taskId && progress.task_id === taskId ? progress : null;
  const stages: SupplementStage[] = own ? own.stages.map(({ key, label, state, note }) => ({ key, label, state, note })) : defaultStages(mode, firstTurn, profile);
  const active = stages.filter(stage => stage.state !== 'skipped');
  const current = stages.find(stage => stage.state === 'running') ?? active.find(stage => stage.state === 'pending') ?? null;
  const finished = active.filter(stage => stage.state === 'done' || stage.state === 'failed').length;
  const running = stages.some(stage => stage.state === 'running') ? 0.5 : 0;
  const percent = active.length ? Math.min(99, Math.round(((finished + running) / active.length) * 100)) : 0;
  const position = current ? active.indexOf(current) + 1 : active.length;
  const message = !own ? 'HR 전문가가 작업을 시작하고 있어요' : current ? profile.doing[current.key] ?? `${current.label} 중이에요` : '결과를 정리하고 있어요';
  return { stages, position: Math.max(1, position), total: Math.max(1, active.length), percent, message, currentKey: current?.key ?? null };
}

// 끝난 턴의 한 줄 요약: '규칙 점검 ✓ 3개 · AI 점검 ✓ 1개 추가 · 근거 검토 ✓ 1개 통과, 1개 제외'.
export function stageSummary(stages: SupplementStage[]): string {
  const mark: Record<SupplementStage['state'], string> = { done: '✓', failed: '✕', skipped: '', pending: '…', running: '…' };
  return stages.filter(stage => stage.state !== 'skipped').map(stage => `${stage.label} ${mark[stage.state]}${stage.note ? ` ${stage.note}` : ''}`.trim()).join(' · ');
}
