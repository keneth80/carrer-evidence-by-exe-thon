import { useState } from 'react';
import { sectionLabel, TAILORED_SECTION } from '../../../../packages/tailor/src/types.ts';
import type { ProposedChange, ResumeBlock } from '../../../../packages/tailor/src/types.ts';
import type { ResumeFact } from '../../../../packages/resume/src/types.ts';
import type { EditProposal, FactRevision } from '../resume/api.ts';
import { statementConfirmed } from './data.ts';

// 변경 제안 카드: 대상 구역, 변경 전·후, 이유, 근거 사실, 수용(전체·일부)·거절. 새 사실은 경력 정보로 확인한 뒤에만 적용한다.

const OPERATION: Record<ProposedChange['operation'], string> = { replace: '수정', insert: '추가', remove: '삭제', reorder: '순서 변경' };
const STATE: Record<EditProposal['state'], string> = { proposed: '변경 제안', accepted: '적용됨', rejected: '거절함', stale: '다시 비교 필요' };
const FACT_CATEGORIES = [['achievement', '성과'], ['responsibility', '담당 업무'], ['role', '직무'], ['other', '기타']] as const;

type Props = {
  proposal: EditProposal; blocks: ResumeBlock[]; facts: ResumeFact[]; head: FactRevision | null; busy: boolean;
  onAccept: (indexes: number[]) => void; onReject: () => void; onConfirmFact: (statement: string, category: string) => void; onAskAgain: () => void;
};

function ChangeRow({ change, blocks, facts, head }: { change: ProposedChange; blocks: ResumeBlock[]; facts: ResumeFact[]; head: FactRevision | null }) {
  const section = blocks.find(block => block.id === change.block_id)?.section ?? (change.operation === 'insert' ? TAILORED_SECTION : '');
  const byId = new Map([...facts, ...(head?.facts ?? [])].map(fact => [fact.id, fact.statement]));
  const target = blocks.find(block => block.id === change.block_id)?.text;
  return <div className="change-body">
    <div className="change-head"><span className="tag">{OPERATION[change.operation]}</span> <strong>{sectionLabel(section) || '문서'}</strong></div>
    {change.operation === 'reorder' && <p className="muted">‘{target}’을(를) 구역 맨 앞으로 옮깁니다.</p>}
    {change.before !== null && <p className="before"><span className="sr-only">변경 전: </span>{change.before}</p>}
    {change.after !== null && <p className="after"><span className="sr-only">변경 후: </span>{change.after}</p>}
    <p className="reason">{change.reason}</p>
    <p className="evidence-line">근거: {change.needs_fact_confirmation
      ? (statementConfirmed(head, change.after) ? '경력 정보로 확인한 사용자 진술' : '사용자 진술 — 아직 경력 정보로 확인되지 않음')
      : change.fact_ids.map(id => `‘${byId.get(id) ?? id}’`).join(', ') || '없음'}</p>
  </div>;
}

export function ProposalCard({ proposal, blocks, facts, head, busy, onAccept, onReject, onConfirmFact, onAskAgain }: Props) {
  const [selected, setSelected] = useState<number[]>(() => proposal.changes.map((_, index) => index));
  const [category, setCategory] = useState('achievement');
  const open = proposal.state === 'proposed';
  const pendingFacts = proposal.changes.filter(change => change.needs_fact_confirmation && !statementConfirmed(head, change.after));
  const blocked = selected.some(index => proposal.changes[index].needs_fact_confirmation && !statementConfirmed(head, proposal.changes[index].after));
  return <article className={`proposal ${proposal.state}`} aria-label={`${STATE[proposal.state]} ${proposal.changes.length}건`}>
    <div className="proposal-head"><span className={`state-pill ${proposal.state}`}>{STATE[proposal.state]}</span><span className="muted">{proposal.changes.length}건{open ? ' · 문서에 반영하려면 적용을 눌러야 합니다' : ''}</span></div>
    <ul className="change-list">{proposal.changes.map((change, index) => <li key={index}>
      {open && proposal.changes.length > 1 && <input type="checkbox" aria-label={`${index + 1}번 변경 선택`} checked={selected.includes(index)}
        onChange={() => setSelected(current => current.includes(index) ? current.filter(item => item !== index) : [...current, index].sort((a, b) => a - b))} />}
      <ChangeRow change={change} blocks={blocks} facts={facts} head={head} />
    </li>)}</ul>
    {proposal.unresolved_questions.length > 0 && <ul className="questions">{proposal.unresolved_questions.map(question => <li key={question}>{question}</li>)}</ul>}
    {open && pendingFacts.length > 0 && <div className="fact-confirm" role="group" aria-label="경력 정보 추가 확인">
      <p><strong>이 내용을 경력 정보에 추가할까요?</strong> 직접 쓴 문장 그대로 저장되며, 원문 대신 대화 진술이 근거로 남습니다.</p>
      <label>분류 <select value={category} onChange={event => setCategory(event.target.value)}>{FACT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {pendingFacts.map(change => <button key={change.block_id} className="outline small" disabled={busy} onClick={() => onConfirmFact(change.after ?? '', category)}>‘{change.after}’ 경력 정보에 추가</button>)}
    </div>}
    {proposal.state === 'stale' && <div className="stale-note" role="status">다른 변경이 있어 다시 비교가 필요해요. 이 제안은 이전 문서 기준이라 적용하지 않았습니다.
      <button className="outline small" disabled={busy} onClick={onAskAgain}>현재 문서 기준으로 다시 요청</button></div>}
    {open && <div className="proposal-actions">
      <button className="primary" disabled={busy || selected.length === 0 || blocked} title={blocked ? '먼저 경력 정보로 확인하세요' : undefined}
        onClick={() => onAccept(selected)}>{selected.length === proposal.changes.length ? '모두 적용' : `선택한 ${selected.length}건 적용`}</button>
      <button className="outline small" disabled={busy} onClick={onReject}>거절</button>
    </div>}
  </article>;
}
