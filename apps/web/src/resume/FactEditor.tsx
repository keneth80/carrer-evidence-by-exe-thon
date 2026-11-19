import { FACT_CATEGORIES } from '../../../../packages/resume/src/types.ts';
import { statementWithinEvidence } from '../../../../packages/resume/src/source.ts';
import type { FactCategory, ResumeFact } from '../../../../packages/resume/src/types.ts';
import type { Span } from './SourcePanel.tsx';
import { pagelessLabel } from './SourcePanel.tsx';

// 추출 후보를 사용자가 고치고 포함 여부를 정한다. 원래 문장과 다르면 '사용자가 수정'으로 표시한다.

export type EditableFact = { fact: ResumeFact; original: string; included: boolean; origin: 'extracted' | 'user_added' | 'confirmed' };

export function isWithinEvidence(item: EditableFact): boolean {
  return statementWithinEvidence(item.fact.statement, item.fact.evidence.map(evidence => evidence.quote));
}

export const categoryLabel: Record<FactCategory, string> = {
  role: '직무', employer: '회사', period: '기간', skill: '기술', responsibility: '담당 업무', achievement: '성과',
  education: '학력', certification: '자격', location: '지역', other: '기타',
};

function locationText(fact: ResumeFact, inputKind?: string) {
  const evidence = fact.evidence[0];
  if (!evidence || evidence.kind !== 'document') return '근거 없음';
  return `${evidence.page === null ? pagelessLabel(inputKind) : `${evidence.page}쪽`} · ${evidence.start}–${evidence.end}`;
}

function originBadge(item: EditableFact) {
  if (!isWithinEvidence(item)) return <span className="tag invalid">원문에 없는 표현 · 저장 불가</span>;
  if (item.fact.statement !== item.original) return <span className="tag edited">사용자가 수정</span>;
  if (item.origin === 'user_added') return <span className="tag added">원문에서 직접 추가</span>;
  if (item.origin === 'confirmed') return <span className="tag confirmed">확정됨</span>;
  return <span className="tag extracted">원문에서 추출</span>;
}

type Props = { items: EditableFact[]; readOnly: boolean; onChange: (index: number, next: EditableFact) => void; onShow: (span: Span) => void; inputKind?: string };

export function FactEditor({ items, readOnly, onChange, onShow, inputKind }: Props) {
  if (items.length === 0) return <p className="muted">경력 항목이 없습니다. 왼쪽 원문에서 줄을 골라 추가하세요.</p>;
  return <ol className="fact-list">
    {items.map((item, index) => {
      const evidence = item.fact.evidence[0];
      const span = evidence && evidence.kind === 'document' ? { page: evidence.page, start: evidence.start, end: evidence.end } : null;
      return <li key={item.fact.id} className={item.included ? '' : 'excluded'}>
        <div className="fact-head">
          <label className="check"><input type="checkbox" checked={item.included} disabled={readOnly} onChange={event => onChange(index, { ...item, included: event.target.checked })} /> 포함</label>
          <select aria-label="항목 분류" value={item.fact.category} disabled={readOnly} onChange={event => onChange(index, { ...item, fact: { ...item.fact, category: event.target.value as FactCategory } })}>
            {FACT_CATEGORIES.map(category => <option key={category} value={category}>{categoryLabel[category]}</option>)}
          </select>
          {originBadge(item)}
        </div>
        <textarea aria-label="항목 내용" value={item.fact.statement} readOnly={readOnly} rows={Math.min(4, Math.ceil(item.fact.statement.length / 48) || 1)}
          onChange={event => onChange(index, { ...item, fact: { ...item.fact, statement: event.target.value } })} />
        {!readOnly && item.included && !isWithinEvidence(item) && <p className="field-error" role="alert">원문 근거 안의 표현으로만 줄이거나 다듬을 수 있습니다. 원문에 없는 수치·역할·자격은 아직 확정할 수 없습니다.</p>}
        <div className="fact-evidence">
          <span className="muted">근거: “{evidence?.quote}”</span>
          {span && <button type="button" className="ghost" onClick={() => onShow(span)}>원문 위치 보기 ({locationText(item.fact, inputKind)})</button>}
        </div>
      </li>;
    })}
  </ol>;
}
