import { useEffect, useRef } from 'react';
import type { ResumeFact } from '../../../../packages/resume/src/types.ts';
import type { EditProposal, FactRevision, ResumeRevision, SupplementProgress, TailoringMessage } from '../resume/api.ts';
import { AgentProgress } from '../resume/AgentProgress.tsx';
import { TAILOR_PROGRESS } from '../resume/progress.ts';
import { proposalFor } from './data.ts';
import { JdCheckView, TailorPipelineNote } from './JdCheckView.tsx';
import { ProposalCard } from './ProposalCard.tsx';

// AI 대화: 일반 답변과 변경 제안 카드를 구분해 보여준다. 응답 생성 중에도 입력한 메시지는 유지한다.
// JD 점검(S1-18): 첫 턴은 요구사항 점검표와 질문, 답변 턴은 수정안 + 단계 요약(뺀 수정안과 이유). 작업 중에는 진행 패널을 보여 준다.

export type ChatStatus = { kind: 'idle' } | { kind: 'pending'; jdCheck?: boolean } | { kind: 'failed'; messageId: string; code: string | null } | { kind: 'jd_failed'; code: string | null };

type Props = {
  liveChat: boolean; messages: TailoringMessage[]; proposals: EditProposal[]; revision: ResumeRevision; facts: ResumeFact[]; head: FactRevision | null;
  draft: string; status: ChatStatus; busy: boolean; suggestions: string[]; progress: SupplementProgress | null; pendingTaskId: string | null;
  onDraft: (text: string) => void; onSend: () => void; onRetry: (messageId: string) => void; onJdCheck: () => void;
  onAccept: (proposal: EditProposal, indexes: number[]) => void; onReject: (proposal: EditProposal) => void;
  onConfirmFact: (statement: string, category: string) => void;
};

export function ChatPanel(props: Props) {
  const { messages, proposals, revision, facts, head, draft, status, busy } = props;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, proposals.length, status.kind]);
  const pending = status.kind === 'pending';
  const paired = new Set(messages.map(message => proposalFor(message, proposals)?.id).filter(Boolean));
  const unpaired = proposals.filter(item => !paired.has(item.id));
  const previousUserText = (index: number) => [...messages.slice(0, index)].reverse().find(item => item.role === 'user')?.content ?? '';
  const card = (proposal: EditProposal, askText: string) => <ProposalCard key={proposal.id} proposal={proposal} blocks={revision.blocks} facts={facts} head={head} busy={busy || pending}
    onAccept={indexes => props.onAccept(proposal, indexes)} onReject={() => props.onReject(proposal)} onConfirmFact={props.onConfirmFact} onAskAgain={() => props.onDraft(askText)} />;
  const answer = (text: string) => props.onDraft(draft.trim() ? `${draft.trim()}\n${text}` : text);
  return <div className="chat">
    <div className="jd-cta">
      <button type="button" className={messages.length === 0 ? 'primary' : 'outline small'} disabled={busy || pending} onClick={props.onJdCheck}>{messages.some(item => item.turn?.kind === 'jd_check') ? 'JD 다시 점검받기' : 'HR 전문가에게 JD 점검받기'}</button>
      <span className="muted">공고 요구사항을 확정 경력과 대조하고, 근거가 약한 요구를 물어봅니다. 문서는 바꾸지 않아요.</span>
    </div>
    <div className="chat-log" aria-live="polite">
      {messages.length === 0 && !pending && <div className="chat-empty">
        <p><strong>어떻게 고쳐 볼까요?</strong> 먼저 JD 점검을 받거나, 공고 요구와 연결되는 경력을 앞으로 옮기거나 강조할 기술을 말해 주세요. 확정 경력에 없는 성과·역할은 먼저 확인을 요청합니다.</p>
      </div>}
      {messages.map((message, index) => {
        const proposal = proposalFor(message, proposals);
        const turn = message.role === 'assistant' ? message.turn ?? null : null;
        return <div key={message.id} className={`bubble-row ${message.role}`}>
          <div className={`bubble ${message.role}`}>
            {message.role === 'assistant' && <span className="bubble-label">{props.liveChat ? 'AI · Liner' : 'AI · mock 대화'}</span>}
            <p>{message.content}</p>
            {turn?.kind === 'jd_check' && <JdCheckView turn={turn} facts={facts} busy={busy || pending} onAnswer={answer} />}
            {turn && <TailorPipelineNote turn={turn} />}
          </div>
          {proposal && card(proposal, previousUserText(index))}
        </div>;
      })}
      {unpaired.map(proposal => card(proposal, ''))}
      {pending && <AgentProgress progress={props.progress} taskId={props.pendingTaskId} mode={props.progress?.mode ?? 'staged'} firstTurn={status.jdCheck === true} profile={TAILOR_PROGRESS}
        title={status.jdCheck ? 'HR 전문가가 JD를 점검하고 있어요' : 'HR 전문가가 수정안을 만들고 있어요'} />}
      {status.kind === 'failed' && <div role="alert" className="error">답변을 만들지 못했어요{status.code ? ` (${status.code})` : ''}. 보낸 메시지와 문서는 그대로입니다.
        <button className="outline small" disabled={busy} onClick={() => props.onRetry(status.messageId)}>다시 시도</button></div>}
      {status.kind === 'jd_failed' && <div role="alert" className="error">JD 점검을 하지 못했어요{status.code ? ` (${status.code})` : ''}. 문서는 그대로입니다.
        <button className="outline small" disabled={busy} onClick={props.onJdCheck}>다시 점검받기</button></div>}
      <div ref={end} />
    </div>
    <div className="suggestions">{props.suggestions.map(text => <button key={text} className="chip-button" disabled={busy || pending} onClick={() => props.onDraft(text)}>{text}</button>)}</div>
    <form className="chat-input" onSubmit={event => { event.preventDefault(); props.onSend(); }}>
      <label htmlFor="chat-text" className="sr-only">메시지</label>
      <textarea id="chat-text" value={draft} maxLength={2000} placeholder="예: React 경험을 더 드러내줘 / 4명 팀의 코드 리뷰를 리딩했어요." onChange={event => props.onDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); props.onSend(); } }} />
      <button className="primary" type="submit" disabled={busy || pending || !draft.trim()}>{pending ? '답변 대기 중' : '보내기'}</button>
    </form>
  </div>;
}
