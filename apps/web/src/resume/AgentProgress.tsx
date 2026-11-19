import { useEffect, useRef, useState } from 'react';
import type { SupplementProgress } from './api.ts';
import { progressView, SUPPLEMENT_PROGRESS } from './progress.ts';
import type { ProgressProfile } from './progress.ts';

// 에이전트가 일하는 동안 눈에 띄게 보여 주는 진행 패널(DECISIONS S1-17, 사용자 요청).
// 단계 표시(규칙 점검 → AI 점검 → 초안 작성 → 근거 검토), 움직이는 막대, 지금 하는 일, 경과 초를 보여 준다.
// 움직임 줄이기 설정이면 애니메이션을 끄고(CSS), 화면 읽기 프로그램에는 단계가 바뀔 때만 알린다.

// profile: 단계 이름·문구(보완 대화 기본, 공고 맞춤 대화는 TAILOR_PROGRESS). title: 패널 머리말.
type Props = { progress: SupplementProgress | null; taskId: string | null; mode: 'staged' | 'single'; firstTurn: boolean; profile?: ProgressProfile; title?: string };

export function AgentProgress({ progress, taskId, mode, firstTurn, profile = SUPPLEMENT_PROGRESS, title = 'HR 전문가가 작업 중이에요' }: Props) {
  const view = progressView(progress, taskId, mode, firstTurn, profile);
  const own = progress && progress.task_id === taskId ? progress : null;
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  // 패널이 화면 아래에서 시작하면 단계 줄이 하단 고정 버튼(action-bar)에 가린다. 나타날 때 한 번 가운데로 올린다.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    box.current?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, []);
  const since = own ? Date.parse(own.started_at) : mountedAt;
  const seconds = Math.max(0, Math.round((now - (Number.isFinite(since) ? since : mountedAt)) / 1000));

  return <div ref={box} className="agent-progress" data-stage={view.currentKey ?? 'waiting'}>
    <div className="agent-progress-head">
      <span className="agent-pulse" aria-hidden="true" />
      <strong>{title}</strong>
      <span className="agent-elapsed">{seconds}초</span>
    </div>
    <p className="agent-progress-now" aria-live="polite">{view.message}… <span className="agent-step-count">({view.position}/{view.total})</span></p>
    <div className="agent-bar" role="progressbar" aria-label="HR 전문가 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent} aria-valuetext={`${view.total}단계 중 ${view.position}단계, ${view.percent}%`}>
      <div className="agent-bar-fill" style={{ width: `${Math.max(view.percent, 6)}%` }} />
    </div>
    <ol className="agent-steps">
      {view.stages.map((stage, index) => <li key={stage.key} className={`agent-step ${stage.state}`} aria-current={stage.state === 'running' ? 'step' : undefined}>
        <span className="agent-step-dot" aria-hidden="true">{stage.state === 'done' ? '✓' : stage.state === 'failed' ? '!' : index + 1}</span>
        <span className="agent-step-label">{stage.label}</span>
        <span className="agent-step-note">{stage.state === 'skipped' ? '이번엔 생략' : stage.state === 'running' ? '진행 중' : stage.note ?? (stage.state === 'pending' ? '대기' : '')}</span>
      </li>)}
    </ol>
  </div>;
}
