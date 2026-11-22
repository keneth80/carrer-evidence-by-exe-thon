import { useEffect, useState } from 'react';
import type { Task } from './api.ts';
import { extractionStep } from './extraction-step.ts';

// 이력서를 읽는 동안의 단계 표시(사용자 요청 2026-11-21, DECISIONS S1-31).
// 단계는 추정하지 않고 작업의 실제 상태에서 읽는다: 대기·실행(state)과 AI 호출의 전송 상태(provider_transmission).
// AI 정리가 꺼져 있으면(mock) 2단계를 거치지 않고 바로 끝난다.

const STEPS = [
  { label: '파일 읽기', doing: '파일에서 글을 읽고 줄을 나누고 있어요' },
  { label: 'AI 정리', doing: 'AI가 원문 전체를 보고 HR 담당자가 보기 좋게 항목을 정리하고 있어요' },
  { label: '원문 대조·저장', doing: '정리한 항목이 원문과 같은지 대조하고 저장하고 있어요' },
];
const PERCENT = [12, 55, 92];

export function ExtractionProgress({ task, since }: { task: Task | null; since: string }) {
  const step = extractionStep(task);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const started = Date.parse(since);
  const seconds = Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 1000)) : 0;
  return <div className="agent-progress" data-stage={`extract-${step}`}>
    <div className="agent-progress-head">
      <span className="agent-pulse" aria-hidden="true" />
      <strong>이력서를 읽고 있어요</strong>
      <span className="agent-elapsed">{seconds}초</span>
    </div>
    <p className="agent-progress-now" aria-live="polite">{STEPS[step].doing}… <span className="agent-step-count">({step + 1}/{STEPS.length})</span></p>
    <div className="agent-bar" role="progressbar" aria-label="이력서 읽기 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={PERCENT[step]} aria-valuetext={`${STEPS.length}단계 중 ${step + 1}단계, ${STEPS[step].label}`}>
      <div className="agent-bar-fill" style={{ width: `${PERCENT[step]}%` }} />
    </div>
    <ol className="agent-steps">
      {STEPS.map((item, index) => <li key={item.label} className={`agent-step ${index < step ? 'done' : index === step ? 'running' : 'pending'}`} aria-current={index === step ? 'step' : undefined}>
        <span className="agent-step-dot" aria-hidden="true">{index < step ? '✓' : index + 1}</span>
        <span className="agent-step-label">{item.label}</span>
        <span className="agent-step-note">{index < step ? '' : index === step ? '진행 중' : '대기'}</span>
      </li>)}
    </ol>
    <p className="muted">새로고침해도 같은 작업을 이어서 확인합니다. AI 정리는 보통 10~30초 걸리고, 실패하면 규칙으로 나눈 결과를 보여 드려요. 스캔본은 글자 인식 때문에 1분쯤 더 걸릴 수 있어요.</p>
  </div>;
}
