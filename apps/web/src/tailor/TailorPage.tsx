import { useCallback, useEffect, useRef, useState } from 'react';
import { explainMatch } from '../../../../packages/search/src/match.ts';
import { checkRequirements } from '../../../../packages/tailor/src/jd-check.ts';
import type { ResumeFact } from '../../../../packages/resume/src/types.ts';
import { api, ApiError, describeError } from '../resume/api.ts';
import type { EditProposal } from '../resume/api.ts';
import { navigate } from '../router.ts';
import { ChatPanel } from './ChatPanel.tsx';
import { useLiveChat } from './chatMode.ts';
import type { ChatStatus } from './ChatPanel.tsx';
import { loadTailor, replyState, statementConfirmed } from './data.ts';
import type { TailorData } from './data.ts';
import { changedBlockIds, ResumePreview } from './ResumePreview.tsx';

// U04 대화형 맞춤 편집: 공고 요구 / AI 대화 / 이력서 미리보기. 작은 화면은 탭으로 전환한다.
// 문서는 제안을 '적용'했을 때만 새 revision으로 바뀐다. 오래된 화면·제안은 서버가 409로 거절한다.

type Tab = 'job' | 'chat' | 'preview';
const ERROR_TEXT: Record<string, string> = {
  PROPOSAL_STALE: '다른 변경이 있어 다시 비교가 필요해요. 최신 문서를 불러왔습니다.',
  RESUME_REVISION_CONFLICT: '다른 화면에서 문서가 바뀌었습니다. 최신 문서를 불러왔습니다.',
  FACT_CONFIRMATION_REQUIRED: '이 변경은 먼저 경력 정보로 확인해야 적용할 수 있어요.',
  RESPONSE_PENDING: '이전 메시지의 답변을 만드는 중입니다.',
};

// 서버 작업 기록에서 대화 상태를 정한다. 실패한 응답은 '다시 시도'를, 진행 중이면 대기 표시를 보여준다.
function statusFrom(data: TailorData): { status: ChatStatus; taskId: string | null } {
  const state = replyState(data);
  if (state.kind === 'failed') return { status: { kind: 'failed', messageId: state.messageId, code: state.code }, taskId: null };
  if (state.kind === 'jd_failed') return { status: { kind: 'jd_failed', code: state.code }, taskId: null };
  if (state.kind === 'pending') return { status: { kind: 'pending', jdCheck: state.jdCheck }, taskId: state.taskId };
  return { status: { kind: 'idle' }, taskId: null };
}

export function TailorPage({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<TailorData | 'not_found' | null>(null);
  const liveChat = useLiveChat();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<ChatStatus>({ kind: 'idle' });
  const [pendingTask, setPendingTask] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [sendKey, setSendKey] = useState(() => crypto.randomUUID());
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const value = await loadTailor(sessionId);
      if (ticket !== latest.current) return null;
      setData(value);
      return value;
    } catch (failure) {
      if (ticket !== latest.current) return null;
      if (failure instanceof ApiError && failure.status === 401) { window.location.assign('/start'); return null; }
      if (failure instanceof ApiError && failure.status === 404) { setData('not_found'); return null; }
      setError(describeError(failure));
      return null;
    }
  }, [sessionId]);

  const applyStatus = useCallback((value: TailorData) => {
    const next = statusFrom(value);
    setStatus(next.status); setPendingTask(next.taskId);
  }, []);
  useEffect(() => { refresh().then(value => { if (value) applyStatus(value); }); }, [refresh, applyStatus]);

  // 답변 생성 작업을 확인한다. 작업이 끝나면 서버 기록으로 상태(완료·실패)를 다시 정한다.
  useEffect(() => {
    if (status.kind !== 'pending') return;
    const timer = window.setTimeout(async () => {
      setPolls(count => count + 1);
      if (pendingTask) {
        const task = await api.task(pendingTask).catch(() => null);
        if (task && (task.state === 'queued' || task.state === 'running')) {
          // 진행 패널(S1-18)이 단계를 따라가도록 세션의 진행 기록만 다시 읽는다. 대화·문서는 작업이 끝난 뒤 한 번에 갱신한다.
          const fresh = await api.tailoringSession(sessionId).catch(() => null);
          if (fresh) setData(current => current && current !== 'not_found' ? { ...current, session: fresh } : current);
          return;
        }
      }
      const value = await refresh();
      if (value) applyStatus(value);
    }, polls > 20 ? 4000 : 1000);
    return () => window.clearTimeout(timer);
  }, [status, pendingTask, polls, refresh, applyStatus]);

  if (error && !data) return <div role="alert" className="error">{error}</div>;
  if (!data) return <p role="status" className="status-line">편집 세션을 불러오는 중…</p>;
  if (data === 'not_found') return <div role="alert" className="error">이 편집 세션을 찾을 수 없습니다. 다른 사용자로 연결했거나 없는 세션입니다. <a href="/start">내 이력서로</a></div>;
  const { session, job, revision, revisions, messages, proposals, facts, head } = data;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await work(); await refresh(); } catch (failure) {
      const code = failure instanceof ApiError ? failure.problem.code : '';
      setError(ERROR_TEXT[code] ?? describeError(failure));
      await refresh();
    } finally { setBusy(false); }
  };

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setBusy(true); setError(null);
    try {
      const accepted = await api.sendMessage(session.id, { expected_resume_revision_id: revision.id, content }, sendKey);
      setDraft(''); setSendKey(crypto.randomUUID()); setPendingTask(accepted.task.id); setPolls(0); setStatus({ kind: 'pending', jdCheck: false });
      await refresh();
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.problem.code : '';
      setError(ERROR_TEXT[code] ?? describeError(failure));
      // 서버가 거절한 요청만 새 key로 바꾼다. 네트워크 오류는 같은 key로 다시 보낸다.
      if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500) setSendKey(crypto.randomUUID());
      if (code === 'RESUME_REVISION_CONFLICT') await refresh();
    } finally { setBusy(false); }
  };

  // JD 점검(S1-18): 문서를 바꾸지 않고 요구사항 대조 → AI 점검 작업을 만든다.
  const requestJdCheck = () => run(async () => {
    const accepted = await api.requestJdCheck(session.id, { expected_resume_revision_id: revision.id }, crypto.randomUUID());
    setPendingTask(accepted.task.id); setPolls(0); setStatus({ kind: 'pending', jdCheck: true }); setTab('chat');
  });
  const retry = (messageId: string) => run(async () => {
    const accepted = await api.retryMessage(session.id, messageId, crypto.randomUUID());
    setPendingTask(accepted.task.id); setPolls(0); setStatus({ kind: 'pending', jdCheck: false });
  });
  const acceptProposal = (proposal: EditProposal, indexes: number[]) => run(() => api.acceptProposal(proposal.id, {
    expected_resume_revision_id: revision.id, expected_content_hash: revision.content_hash, ...(indexes.length === proposal.changes.length ? {} : { change_indexes: indexes }),
  }, crypto.randomUUID()));
  const rejectProposal = (proposal: EditProposal) => run(() => api.rejectProposal(proposal.id, crypto.randomUUID()));
  // 대화 진술을 경력 정보로 확정한다. 근거는 그 문장을 쓴 사용자 메시지다.
  const confirmFact = (statement: string, category: string) => run(async () => {
    const message = [...messages].reverse().find(item => item.role === 'user' && item.content.replace(/\s+/g, ' ').includes(statement));
    if (!head || !data.extractionId || !message) throw new Error('확인할 경력 정보 또는 대화 근거를 찾지 못했습니다.');
    const fact: ResumeFact = { id: `fact_u${Date.now().toString(36)}`, category: category as ResumeFact['category'], statement, evidence: [{ kind: 'user_statement', message_id: message.id, confirmed_at: new Date().toISOString(), quote: statement }] };
    await api.confirm(data.documentId, { extraction_id: data.extractionId, expected_parent_revision_id: head.id, facts: [...head.facts, fact] }, crypto.randomUUID());
  });
  const restore = (sourceId: string) => run(() => api.restore(session.id, { source_revision_id: sourceId, expected_resume_revision_id: revision.id }, crypto.randomUUID()));

  const explained = explainMatch(facts, [], job);
  const linked = new Map(explained.reasons.map(reason => [reason.requirement_id, reason]));
  // JD 점검표와 같은 기준(S1-18)으로 상태를 보인다. 기술 이름만 연결되고 쓰인 업무 문장이 없으면 '근거 약함'.
  const statusOf = new Map(checkRequirements(facts, job).map(check => [check.requirement_id, check.status]));
  // 추천 문구는 짧은 기술 이름만 쓴다(문장형 경력은 칩에 넣지 않음).
  const skillNames = new Set(facts.filter(fact => fact.category === 'skill').map(fact => fact.statement));
  const skillSuggestions = [...new Set(explained.reasons.flatMap(reason => reason.facts).filter(name => skillNames.has(name)))].slice(0, 2).map(name => `${name} 경험을 강조해줘`);
  const linkLabel = (names: string[]) => {
    const short = names.filter(name => name.length <= 30);
    const sentences = names.length - short.length;
    return [...short, ...(sentences ? [`경력 문장 ${sentences}개`] : [])].join(', ');
  };
  const parent = revisions.find(item => item.id === revision.parent_revision_id);
  const pendingFacts = proposals.filter(item => item.state === 'proposed').flatMap(item => item.changes).filter(change => change.needs_fact_confirmation && !statementConfirmed(head, change.after)).length;

  return <div className={`tailor tab-${tab}`}>
    <a className="back" href="/start" onClick={event => { event.preventDefault(); window.history.back(); }}>← 이전 화면</a>
    <header className="tailor-head">
      <div><span className="eyebrow">U04 · 공고별 맞춤 편집</span><h1>{job.company_name} · {job.title}</h1></div>
      <div className="tailor-status">
        <span className={`state-pill ${revision.state === 'final' ? 'accepted' : 'proposed'}`}>{revision.state === 'final' ? `확정 ${revision.revision}번째 버전` : `작성 중 ${revision.revision}번째 버전`}</span>
        <span className="muted">저장됨 {new Date(revision.created_at).toLocaleTimeString('ko-KR')}</span>
        {pendingFacts > 0 && <span className="tag edited">확인할 사실 {pendingFacts}</span>}
        {job.data_origin === 'synthetic' && <span className="pill">합성 공고</span>}
        <span className="pill">{liveChat ? 'Liner AI 대화' : 'mock 대화'}</span>
      </div>
    </header>
    <nav className="tailor-tabs" aria-label="편집 영역">
      {(['job', 'chat', 'preview'] as Tab[]).map(item => <button key={item} aria-pressed={tab === item} onClick={() => setTab(item)}>{item === 'job' ? '공고 요구' : item === 'chat' ? 'AI 대화' : '미리보기'}</button>)}
    </nav>
    {error && <div role="alert" className="error">{error}</div>}
    <div className="tailor-grid">
      <section className="panel pane-job" aria-labelledby="req-title">
        <h2 id="req-title">공고 요구</h2>
        <p className="muted">요구를 누르면 연결된 경력 문장을 미리보기에서 강조합니다.</p>
        <ul className="req-list">{job.requirements.map(requirement => {
          const reason = linked.get(requirement.id);
          const ids = reason?.fact_ids ?? [];
          const active = ids.length > 0 && ids.every(id => highlight.has(id));
          const status = statusOf.get(requirement.id) ?? (reason ? 'met' : 'missing');
          return <li key={requirement.id}><button className={`req ${status === 'met' ? 'linked' : status} ${active ? 'active' : ''}`} aria-pressed={active} disabled={!reason}
            onClick={() => setHighlight(active ? new Set() : new Set(ids))}>
            <span className="tag">{requirement.importance === 'required' ? '자격 요건' : '우대'}</span> {requirement.text}
            <span className="muted">{status === 'met' && reason ? `충족 · 연결: ${linkLabel(reason.facts)}` : status === 'weak' && reason ? `근거 약함 · 기술 이름만 연결: ${linkLabel(reason.facts)}` : '미기재 · 확정 경력에서 근거 미확인'}</span>
          </button></li>;
        })}</ul>
      </section>
      <section className="panel pane-chat" aria-labelledby="chat-title">
        <h2 id="chat-title">AI 대화</h2>
        {liveChat && <div className="notice" role="note"><strong>외부 AI로 전송</strong><span>이 대화의 메시지·확정 경력·공고 내용은 Liner(외부 AI 서비스)로 보내 응답을 만듭니다. Liner는 요청 내용을 최대 60일 보관하고 해외 AI 제공사를 거쳐 처리할 수 있습니다. 이메일·전화번호는 가려서 보내며, 주민등록번호 같은 민감한 정보는 쓰지 마세요. 메시지마다 유료 호출 1건이 쓰입니다.</span></div>}
        <ChatPanel liveChat={liveChat} messages={messages} proposals={proposals} revision={revision} facts={facts} head={head} draft={draft} status={status} busy={busy}
          suggestions={['이 공고에 맞춰 수정해줘', ...skillSuggestions]} progress={session.progress ?? null} pendingTaskId={pendingTask} onDraft={setDraft} onSend={send} onRetry={retry} onJdCheck={requestJdCheck}
          onAccept={acceptProposal} onReject={rejectProposal} onConfirmFact={confirmFact} />
      </section>
      <section className="panel pane-preview" aria-labelledby="preview-title">
        <h2 id="preview-title">이력서 미리보기 <span className="count">v{revision.revision}</span></h2>
        <ResumePreview blocks={revision.blocks} facts={[...facts, ...(head?.facts ?? [])]} highlightFacts={highlight} changedIds={changedBlockIds(revision.blocks, parent?.blocks)} />
        {revisions.length > 1 && <details className="history"><summary>버전 기록 ({revisions.length})</summary>
          <ul>{[...revisions].reverse().map(item => <li key={item.id}>
            <span>{item.revision}번째 · {item.state === 'final' ? '확정' : '작성 중'} · {new Date(item.created_at).toLocaleTimeString('ko-KR')}</span>
            {item.id !== revision.id && <button className="ghost" disabled={busy} onClick={() => restore(item.id)}>이 내용으로 되돌리기</button>}
          </li>)}</ul></details>}
      </section>
    </div>
    <div className="action-bar">
      <span className="muted">{session.state === 'waiting_user' ? 'AI가 확인을 요청한 내용이 있어요.' : '적용한 변경만 문서에 반영됩니다.'}</span>
      <button className="primary" disabled={busy || status.kind === 'pending'} onClick={() => navigate(`/tailoring/${session.id}/final`)}>최종 제출본 확인</button>
    </div>
  </div>;
}
