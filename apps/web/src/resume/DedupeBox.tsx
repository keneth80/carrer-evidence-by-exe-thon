import { useState } from 'react';
import type { ResumeFact } from '../../../../packages/resume/src/types.ts';

// 중복 정리(사용자 테스트 2026-11-20). 같은 내용이 반복된 점검 항목에서 남길 문장 하나를 고르고 나머지를 확정 경력에서 뺀다.
// 모델을 부르지 않는다. 빼는 것은 새 확정 버전이며 이전 버전은 그대로 남는다.

export function DedupeBox({ facts, busy, onKeep }: { facts: ResumeFact[]; busy: boolean; onKeep: (keepId: string, removeIds: string[]) => void }) {
  // 기본값은 가장 자세한(긴) 문장이다.
  const [keep, setKeep] = useState(() => [...facts].sort((a, b) => b.statement.length - a.statement.length)[0]?.id ?? '');
  return <div className="suggest-box">
    <p className="fine-print">같은 내용이 {facts.length}번 있어요. 남길 문장 하나를 고르면 나머지는 확정 경력에서 빠져요.</p>
    <div role="radiogroup" aria-label="남길 문장" className="suggest-options">
      {facts.map(fact => <label key={fact.id} className={`suggest-option ${keep === fact.id ? 'on' : ''}`}>
        <input type="radio" name={`dedupe-${facts.map(item => item.id).join('-')}`} checked={keep === fact.id} onChange={() => setKeep(fact.id)} />
        <span className="tag">{keep === fact.id ? '남김' : '뺌'}</span>
        <span className="suggest-text">{fact.statement}</span>
      </label>)}
    </div>
    <div className="row-actions">
      <button type="button" className="primary small" disabled={busy || !keep} onClick={() => onKeep(keep, facts.filter(fact => fact.id !== keep).map(fact => fact.id))}>이 문장만 남기기</button>
    </div>
  </div>;
}
