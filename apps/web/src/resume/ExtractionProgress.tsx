import { useEffect, useState } from 'react';
import type { LinerMessages } from '../../../../packages/liner/src/chat.ts';
import { api } from './api.ts';
import type { Task } from './api.ts';
import { extractionStep, linerExchange } from './extraction-step.ts';

// 이력서를 읽는 동안의 단계 표시(사용자 요청 2026-11-21, DECISIONS S1-31).
// 단계는 추정하지 않고 작업의 실제 상태에서 읽는다: 대기·실행(state)과 AI 호출의 전송 상태(provider_transmission).
// AI 정리가 꺼져 있으면(mock) 2단계를 거치지 않고 바로 끝난다.

const STEPS = [
  { label: '파일 읽기', doing: '파일에서 글을 읽고 줄을 나누고 있어요' },
  { label: 'AI 정리', doing: 'AI가 원문 전체를 보고 HR 담당자가 보기 좋게 항목을 정리하고 있어요' },
  { label: '원문 대조·저장', doing: '정리한 항목이 원문과 같은지 대조하고 저장하고 있어요' },
];
const PERCENT = [12, 55, 92];

export function LinerExchange({ task }: { task: Task }) {
  const { request, response } = linerExchange(task);
  const [open, setOpen] = useState(true);
  const [body, setBody] = useState<LinerMessages | null>();
  const [failed, setFailed] = useState(false);
  const { id, updated_at: updatedAt, provider_transmission: transmission } = task;
  useEffect(() => {
    if (!open || !transmission || transmission === 'not_dispatched') return;
    let current = true;
    api.linerMessages(id).then(({ messages }) => {
      if (current) { setBody(messages); setFailed(false); }
    }, () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [id, open, transmission, updatedAt]);
  return <section className="panel liner-exchange" aria-labelledby="liner-exchange-title">
    <h2 id="liner-exchange-title">라이너 API 송수신 내역</h2>
    <dl aria-live="polite">
      <div><dt>요청 송신</dt><dd>{request}</dd></div>
      <div><dt>응답 수신</dt><dd>{response}</dd></div>
    </dl>
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>요청·응답 메시지</summary>
      {failed && <p className="muted">메시지를 불러오지 못했습니다. 접었다 다시 열어 주세요.</p>}
      {body ? <div className="liner-messages">
        <section>
          <h3>보낸 메시지</h3>
          {body.request.map((message, index) => <div key={index}>
            <h4>{message.role}</h4>
            <pre tabIndex={0}>{message.content}</pre>
          </div>)}
        </section>
        <section>
          <h3>받은 메시지</h3>
          {body.response ? <><h4>{body.response.role}</h4><pre tabIndex={0}>{body.response.content}</pre></>
            : <p className="muted">{task.state === 'running' && transmission === 'dispatched' ? '라이너의 응답을 기다리는 중입니다.' : '확인할 수 있는 응답 본문이 없습니다.'}</p>}
        </section>
      </div> : !failed && <p className="muted">{!transmission || transmission === 'not_dispatched' ? '표시할 메시지가 없습니다.'
        : body === undefined ? '메시지를 불러오는 중…' : '이 작업의 메시지가 서버 메모리에 없습니다.'}</p>}
    </details>
  </section>;
}

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
    <p className="muted">새로고침해도 같은 작업을 이어서 확인합니다. AI 정리는 보통 10~30초 걸리고, 실패하면 규칙으로 나눈 결과를 보여 드려요.</p>
  </div>;
}
