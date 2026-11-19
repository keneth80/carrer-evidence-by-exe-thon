import { ChatProviderError } from './provider.ts';

// 단계별 오케스트레이션 공통 기록기(DECISIONS S1-17·S1-18). 보완 대화와 공고 맞춤 대화가 함께 쓴다.
// - 단계 상태가 바뀔 때마다 진행 기록을 report로 저장한다(화면 진행 표시용). report가 false면 lease를 잃은 것이라 멈춘다.
// - 모델 호출마다 전송 상태를 모아, 하나라도 불명이면 턴 전체를 불명으로 본다(자동 재시도 금지).

export type StageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';
export type StageProgress<K extends string = string> = { key: K; label: string; state: StageState; started_at: string | null; finished_at: string | null; note: string | null };
export type StageSummary<K extends string = string> = { key: K; label: string; state: StageState; note: string | null };
export type PipelineMode = 'staged' | 'single';
export type TurnProgress<K extends string = string> = { task_id: string; mode: PipelineMode; stages: StageProgress<K>[]; started_at: string };
export type Transmission = 'not_dispatched' | 'completed' | 'unknown';
export type CallOutcome<T> = { ok: true; value: T } | { ok: false; code: string };

export type TrackerDeps = {
  taskId: string; mode: PipelineMode; now: () => number; providerMode: 'mock' | 'live';
  report: (progress: TurnProgress) => boolean;
  invoke: <T>(work: (signal: AbortSignal) => Promise<T>) => Promise<T>;
};

export class LeaseLost extends Error {}

// 호출 실패를 코드와 전송 상태로 나눈다. mock은 네트워크가 없으므로 전송 불명이 없다.
export function failureOf(error: unknown, mode: 'mock' | 'live', fallbackCode: string): { code: string; transmission: Transmission } {
  if (error instanceof ChatProviderError) return { code: error.code, transmission: mode === 'live' ? error.transmission : 'completed' };
  return { code: fallbackCode, transmission: mode === 'live' ? 'unknown' : 'completed' };
}

export function createTracker<K extends string>(deps: TrackerDeps, keys: K[], labels: Record<K, string>, fallbackCode: string) {
  const iso = () => new Date(deps.now()).toISOString();
  let stages: StageProgress<K>[] = keys.map(key => ({ key, label: labels[key], state: 'pending', started_at: null, finished_at: null, note: null }));
  const started = iso();
  const sent: Transmission[] = [];
  const save = () => { if (!deps.report({ task_id: deps.taskId, mode: deps.mode, stages, started_at: started })) throw new LeaseLost(); };
  const set = (key: K, state: StageState, note: string | null = null) => {
    const at = iso();
    stages = stages.map(stage => stage.key !== key ? stage : {
      ...stage, state, note: note ?? stage.note,
      started_at: state === 'running' ? at : stage.started_at,
      finished_at: state === 'running' || state === 'pending' ? null : at,
    });
    save();
  };
  // 모델 호출 하나. 성공하면 completed, 실패하면 그 호출의 전송 상태를 남기고 실패 정보를 돌려준다.
  const call = async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<CallOutcome<T>> => {
    try {
      const value = await deps.invoke(work);
      sent.push('completed');
      return { ok: true, value };
    } catch (error) {
      if (error instanceof LeaseLost) throw error;
      const failure = failureOf(error, deps.providerMode, fallbackCode);
      sent.push(failure.transmission);
      return { ok: false, code: failure.code };
    }
  };
  // 형식 검사에서 실패한 응답도 전송은 끝났다(completed). 호출 자체가 없었으면 not_dispatched.
  const transmission = (): Transmission => sent.includes('unknown') ? 'unknown' : sent.includes('completed') ? 'completed' : 'not_dispatched';
  const summary = (): StageSummary<K>[] => stages.map(stage => ({ key: stage.key, label: stage.label, state: stage.state, note: stage.note }));
  return { set, call, transmission, summary, save };
}
export type Tracker<K extends string> = ReturnType<typeof createTracker<K>>;
