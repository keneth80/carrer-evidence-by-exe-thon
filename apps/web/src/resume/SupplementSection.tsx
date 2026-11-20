import { useEffect, useState } from 'react';
import type { ResumeFact } from '../../../../packages/resume/src/types.ts';
import { api, ApiError, describeError } from './api.ts';
import type { FactRevision, SupplementCandidate, SupplementSession, SupplementTurn } from './api.ts';
import { SupplementTurnView } from './SupplementTurnView.tsx';
import { BLANK_LEFT } from './ExampleBox.tsx';
import { hasBlank } from '../../../../packages/tailor/src/example.ts';
import { AgentProgress } from './AgentProgress.tsx';
import { factChange, findingProgress } from './finding-state.ts';
import type { AdoptAction } from './SuggestionPicker.tsx';
import { replaceFact, replaceTarget } from './similar.ts';
import { useLiveChat } from '../tailor/chatMode.ts';

// 에이전트 이력서 점검·보완(DECISIONS S1-16). 확정 경력을 점검받고, 질문에 답한 '내 문장'만 경력 후보가 된다.
// 후보 추가는 기존 확정 API로 새 경력 버전을 만든다(근거 = 내 메시지, user_statement). 이전 버전은 그대로 남는다.

const STORE = (documentId: string) => `supplement-session:${documentId}`;
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
function remember(documentId: string, sessionId: string | null) {
  try { if (sessionId) localStorage.setItem(STORE(documentId), sessionId); else localStorage.removeItem(STORE(documentId)); } catch { /* 저장소가 막혀도 화면은 동작한다 */ }
}
function recall(documentId: string): string | null {
  try { return localStorage.getItem(STORE(documentId)); } catch { return null; }
}

type Props = { documentId: string; extractionId: string; head: FactRevision; onConfirmed: () => void };

export function SupplementSection({ documentId, extractionId, head, onConfirmed }: Props) {
  const live = useLiveChat();
  const [sessionId, setSessionId] = useState<string | null>(() => recall(documentId));
  const [session, setSession] = useState<SupplementSession | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startKey, setStartKey] = useState(() => crypto.randomUUID());
  const [sendKey, setSendKey] = useState(() => crypto.randomUUID());
  // 점검을 시작한 확정 경력 버전. 점검 항목의 '대상' 문장이 그 뒤에 바뀌었는지 비교한다.
  const [started, setStarted] = useState<FactRevision | null>(null);
  // 지금 추천 문장을 만드는 점검 항목(메시지 ID·순번). 이 동안은 아래쪽 진행 패널 대신 항목 안에 상태를 보인다.
  const [suggesting, setSuggesting] = useState<{ messageId: string; index: number; taskId: string } | null>(null);

  const pending = session?.latest_task ? ['queued', 'running'].includes(session.latest_task.state) : false;
  // 추천 작업이 끝나면(같은 작업 ID가 더는 진행 중이 아니면) 항목 안 상태 표시를 끈다.
  const suggestDone = Boolean(suggesting && session?.latest_task?.id === suggesting.taskId && !pending);
  useEffect(() => { if (suggestDone) setSuggesting(null); }, [suggestDone]);
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => api.supplement(sessionId).then(value => {
      if (!alive) return;
      setSession(value);
      if (value.latest_task && ['queued', 'running'].includes(value.latest_task.state)) timer = setTimeout(poll, 1500);
    }).catch(failure => {
      if (!alive) return;
      if (failure instanceof ApiError && failure.status === 404) { remember(documentId, null); setSessionId(null); return; }
      setError(describeError(failure));
    });
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [sessionId, documentId, sendKey]);
  useEffect(() => {
    if (!session) return;
    api.factRevision(session.fact_revision_id).then(value => setStarted(value)).catch(() => setStarted(null));
  }, [session?.fact_revision_id]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const accepted = await api.createSupplement(head.id, startKey);
      remember(documentId, accepted.resource_id);
      setSession(null); setSessionId(accepted.resource_id); setStartKey(crypto.randomUUID());
    } catch (failure) { setError(describeError(failure)); } finally { setBusy(false); }
  };
  const send = async (content: string) => {
    if (!sessionId || !content.trim()) return;
    if (hasBlank(content)) { setError(BLANK_LEFT); return; }
    setBusy(true); setError(null);
    try {
      await api.sendSupplement(sessionId, content, sendKey);
      setText(''); setSendKey(crypto.randomUUID());
    } catch (failure) { setError(describeError(failure)); } finally { setBusy(false); }
  };
  // 후보는 내 메시지 문장이다. 확정하면 서버가 그 메시지를 다시 확인해 근거(user_statement)로 저장한다.
  const stated = (candidate: SupplementCandidate): ResumeFact => ({ id: `fact_s${Date.now().toString(36)}`, category: candidate.category, statement: candidate.statement, evidence: [{ kind: 'user_statement', message_id: candidate.message_id, confirmed_at: new Date().toISOString(), quote: candidate.statement }] });
  const confirmFacts = async (facts: ResumeFact[]) => {
    setBusy(true); setError(null);
    try {
      await api.confirm(documentId, { extraction_id: extractionId, expected_parent_revision_id: head.id, facts }, crypto.randomUUID());
      onConfirmed();
    } catch (failure) {
      setError(failure instanceof ApiError && failure.problem.code === 'FACT_REVISION_CONFLICT' ? '다른 화면에서 경력이 바뀌었습니다. 새로고침한 뒤 다시 추가하세요.' : describeError(failure));
    } finally { setBusy(false); }
  };
  const add = (candidate: SupplementCandidate) => confirmFacts([...head.facts, stated(candidate)]);
  // 추천 문장 받기(S1-24): 이 항목 하나만 추천 문장 작성 → 근거 검토 작업을 만든다(유료 호출).
  const suggest = async (messageId: string, index: number) => {
    if (!sessionId) return;
    setBusy(true); setError(null);
    try {
      const accepted = await api.suggestSupplement(sessionId, { message_id: messageId, finding_index: index }, crypto.randomUUID());
      setSuggesting({ messageId, index, taskId: accepted.task.id }); setSendKey(crypto.randomUUID());
    } catch (failure) { setError(describeError(failure)); } finally { setBusy(false); }
  };
  // 고른(또는 직접 쓴) 문장을 내 진술로 기록하고(모델 없음), 그 메시지를 근거로 기존 항목을 바꾸거나 새 항목으로 추가한다.
  const adopt = async (action: AdoptAction) => {
    if (!sessionId) return;
    setBusy(true); setError(null);
    try {
      const message = await api.recordStatement(sessionId, action.text, crypto.randomUUID());
      const fact: ResumeFact = { id: `fact_s${Date.now().toString(36)}`, category: action.category, statement: message.content, evidence: [{ kind: 'user_statement', message_id: message.id, confirmed_at: new Date().toISOString(), quote: message.content }] };
      setBusy(false);
      await confirmFacts(action.targetId ? replaceFact(head.facts, action.targetId, fact) : [...head.facts, fact]);
      setSendKey(crypto.randomUUID());
    } catch (failure) { setError(describeError(failure)); setBusy(false); }
  };
  // 중복 정리: 고른 문장만 남기고 나머지를 뺀 새 확정 버전을 만든다(모델 없음).
  const removeFacts = (ids: string[]) => confirmFacts(head.facts.filter(fact => !ids.includes(fact.id)));
  // 이 점검 항목의 가장 최근 추천 응답.
  const suggestionFor = (messageId: string) => (index: number) => {
    const found = [...(session?.messages ?? [])].reverse().find(message => message.turn?.suggestion?.source_message_id === messageId && message.turn.suggestion.finding_index === index);
    return found?.turn?.suggestion ? { set: found.turn.suggestion, reply: found.turn.reply } : null;
  };
  const isSuggestion = (turn: SupplementTurn | null) => Boolean(turn?.suggestion);
  // 어미만 다른 기존 항목(또는 에이전트가 지목한 보완 대상)을 새 문장으로 바꾼다. 같은 내용이 두 번 남지 않는다(S1-17).
  const replace = (candidate: SupplementCandidate, targetId: string) => confirmFacts(replaceFact(head.facts, targetId, stated(candidate)));
  const targetFor = (candidate: SupplementCandidate) => replaceTarget(candidate, head.facts);
  const isAdded = (candidate: SupplementCandidate) => head.facts.some(fact => squash(fact.statement) === squash(candidate.statement));
  const startFacts = started && started.id === session?.fact_revision_id ? started.facts : null;
  const factState = (id: string) => factChange(id, startFacts, head.facts);
  const findings = session?.messages.flatMap(message => message.turn?.findings ?? []) ?? [];
  const resolved = findings.filter(item => findingProgress(item.fact_ids, startFacts, head.facts) !== 'open').length;
  const failed = session?.latest_task?.state === 'failed' ? session.latest_task.error_code : null;
  const mode = session?.provider_mode ?? (live ? 'live' : 'mock');

  return <section className="panel supplement" aria-labelledby="supplement-title">
    <h2 id="supplement-title">HR 전문가 이력서 점검·보완 <span className="pill">{mode === 'live' ? 'Liner' : 'mock(규칙 기반 합성 응답)'}</span></h2>
    <p className="muted">HR 전문가가 확정 경력을 점검하고 질문합니다. 답한 내용 중 <strong>내가 쓴 문장만</strong> 경력 후보가 되고, 추가하면 새 경력 버전으로 저장됩니다. HR 전문가가 숫자·기술·직책을 지어내 넣지 않습니다.</p>
    {mode === 'live' && <p className="fine-print">대화 내용과 확정 경력이 Liner(외부 서비스)로 전송됩니다(최대 60일 보관, 해외 제공사 경유 가능, 이메일·전화번호는 가림). 턴마다 유료 호출 1건이 쓰입니다.</p>}
    {!sessionId && <button className="primary" disabled={busy} onClick={start}>HR 전문가에게 점검받기</button>}
    {session && session.fact_revision_id !== session.head_fact_revision_id && <div className="notice">
      <strong>버전 안내</strong>
      <span>이 대화는 확정 경력 {started?.revision ?? '이전'}번째 버전에서 시작했고, 지금은 {head.revision}번째 버전입니다(대화에서 추가·변경한 항목 포함).{findings.length > 0 && ` 점검 항목 ${findings.length}개 중 ${resolved}개에 반영했어요. 점검 내용은 시작 버전 기준 기록이라 그대로 두고, 반영한 항목에 표시만 합니다. 바뀐 내용으로 다시 점검받으려면 아래 버튼을 누르세요(유료 호출 1건).`}</span>
      <button className="outline small" disabled={busy || pending} onClick={() => { remember(documentId, null); setSessionId(null); setSession(null); }}>현재 버전으로 새로 점검받기</button>
    </div>}
    {sessionId && !session && <p role="status" className="status-line">대화를 불러오는 중…</p>}
    {session && <div className="supp-chat">
      {session.messages.map(message => message.role === 'user'
        ? <div key={message.id} className="supp-user"><span className="fine-print">나</span><p>{message.content}</p></div>
        // 추천 문장 응답은 대화가 아니라 해당 점검 항목 아래에 보인다.
        : message.turn && !isSuggestion(message.turn) && <SupplementTurnView key={message.id} turn={message.turn} busy={busy || pending} isAdded={isAdded} factState={factState} startFacts={startFacts} headFacts={head.facts} targetFor={targetFor}
          suggestionFor={suggestionFor(message.id)} suggesting={suggesting?.messageId === message.id ? suggesting.index : null} canSuggest={!pending}
          onSuggest={index => suggest(message.id, index)} onAdopt={(_index, action) => adopt(action)} onRemove={removeFacts}
          onAnswer={(question, example) => setText(current => example ? [current.trim(), `‘${question}’에 대한 답: ${example}`].filter(Boolean).join('\n\n') : current || `‘${question}’에 대한 답: `)} onAdd={add} onReplace={replace} onAdoptDraft={draft => send(draft)} />)}
      {pending && !suggesting && <AgentProgress progress={session.progress} taskId={session.latest_task?.id ?? null} mode={session.progress?.mode ?? 'staged'} firstTurn={!session.messages.some(message => message.role === 'user')} />}
      {failed && <div className="error" role="alert">응답을 만들지 못했어요({failed}). 메시지를 다시 보내 주세요.</div>}
      <div className="supp-input">
        <textarea aria-label="HR 전문가에게 답하기" value={text} maxLength={2000} disabled={pending} placeholder={pending ? 'HR 전문가가 작업을 마치면 보낼 수 있어요.' : '질문에 답하거나, 빠진 경력·성과를 내 말로 적어 주세요.'} onChange={event => setText(event.target.value)} />
        <button className="primary" disabled={busy || pending || !text.trim()} onClick={() => send(text)}>보내기</button>
      </div>
      <p className="fine-print">'이 문장으로 답하기'를 누르면 HR 전문가 초안을 내 진술로 보냅니다. 사실과 다르면 고쳐서 직접 보내세요.</p>
    </div>}
    {error && <div className="error" role="alert">{error}</div>}
  </section>;
}
