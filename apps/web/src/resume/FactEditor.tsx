import { useMemo, useState } from 'react';
import { FACT_CATEGORIES } from '../../../../packages/resume/src/types.ts';
import { statementWithinEvidence } from '../../../../packages/resume/src/source.ts';
import type { DocumentEvidence, FactCategory, FactReview, ResumeFact } from '../../../../packages/resume/src/types.ts';
import { factGroups } from '../../../../packages/tailor/src/fact-groups.ts';
import type { FactGroup } from '../../../../packages/tailor/src/fact-groups.ts';
import type { Span } from './SourcePanel.tsx';
import { pagelessLabel } from './SourcePanel.tsx';
import type { SourceText } from './api.ts';
import { applicableWording, attentionLabel, attentionReason, groupNeedsAttention } from './attention.ts';

// 추출 후보를 사용자가 고치고 포함 여부를 정한다. 원래 문장과 다르면 '사용자가 수정'으로 표시한다.

export type EditableFact = { fact: ResumeFact; original: string; included: boolean; origin: 'extracted' | 'user_added' | 'confirmed' };

export function isWithinEvidence(item: EditableFact): boolean {
  return statementWithinEvidence(item.fact.statement, item.fact.evidence.map(evidence => evidence.quote));
}

export const categoryLabel: Record<FactCategory, string> = {
  role: '직무', employer: '회사', period: '기간', skill: '기술', responsibility: '담당 업무', achievement: '성과',
  education: '학력', certification: '자격', location: '지역', other: '기타',
};

function locationText(span: Span, inputKind?: string) {
  return `${span.page === null ? pagelessLabel(inputKind) : `${span.page}쪽`} · ${span.start}–${span.end}`;
}

function originBadge(item: EditableFact) {
  if (!isWithinEvidence(item)) return <span className="tag invalid">원문에 없는 표현 · 저장 불가</span>;
  if (item.fact.statement !== item.original) return <span className="tag edited">사용자가 수정</span>;
  if (item.origin === 'user_added') return <span className="tag added">원문에서 직접 추가</span>;
  if (item.origin === 'confirmed') return <span className="tag confirmed">확정됨</span>;
  return <span className="tag extracted">원문에서 추출</span>;
}

type Props = { items: EditableFact[]; review?: Record<string, FactReview>; source: SourceText | null; readOnly: boolean; onChange: (index: number, next: EditableFact) => void; onToggleGroup: (indexes: number[], included: boolean) => void; onShow: (span: Span) => void; inputKind?: string };

// 회사·직무·기간·지역처럼 짧은 줄은 한 줄로 보여 준다(사용자 요청 2026-11-21). 길거나 여러 줄이면 예전 카드 그대로 둔다.
const COMPACT = new Set<FactCategory>(['employer', 'role', 'period', 'location']);
const isCompact = (fact: ResumeFact) => COMPACT.has(fact.category) && fact.statement.length <= 40 && !fact.statement.includes('\n');

const KIND_LABEL: Partial<Record<FactGroup['kind'], string>> = { employer: '경력', project: '프로젝트' };

// 묶음 머리: 체크박스 하나로 묶음 전체를 넣고 뺀다. 일부만 포함이면 중간 상태로 보인다.
function GroupHead({ group, items, readOnly, onToggle, open, onOpen }: { group: FactGroup; items: EditableFact[]; readOnly: boolean; onToggle: (included: boolean) => void; open: boolean | null; onOpen: (open: boolean) => void }) {
  const included = group.indexes.filter(index => items[index].included).length;
  const all = included === group.indexes.length;
  const Heading = group.kind === 'section' ? 'h3' : group.kind === 'employer' ? 'h4' : 'h5';
  return <div className="fact-group-head">
    <Heading><label className="fact-group-title">
      <input type="checkbox" checked={all} disabled={readOnly} aria-label={`${group.title} 묶음 전체 포함`}
        ref={element => { if (element) element.indeterminate = included > 0 && !all; }} onChange={event => onToggle(event.target.checked)} />
      {KIND_LABEL[group.kind] && <span className="tag extracted">{KIND_LABEL[group.kind]}</span>}
      <span>{group.title}</span>
    </label></Heading>
    <span className="group-tools">
      <span className="muted">{open === false ? `원문 그대로 · 포함 ${included} / ${group.indexes.length}` : `포함 ${included} / ${group.indexes.length}`}</span>
      {!readOnly && open !== null && <button type="button" className="ghost" aria-expanded={open} onClick={() => onOpen(!open)}>{open ? '접기' : '펼치기'}</button>}
    </span>
  </div>;
}

export function FactEditor({ items, review, source, readOnly, onChange, onToggleGroup, onShow, inputKind }: Props) {
  const pages = useMemo(() => new Map(source?.pages.map(page => [page.page, Array.from(page.text)])), [source]);
  // 사용자가 직접 펼치거나 접은 묶음만 기억한다. 나머지는 확인할 항목이 있으면 펼치고 없으면 접는다(S1-33).
  // 접는 것은 묶음에 직접 든 항목뿐이다. 회사·프로젝트 같은 하위 묶음 제목은 늘 보여야 훑어볼 수 있다.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  if (items.length === 0) return <p className="muted">경력 항목이 없습니다. 왼쪽 원문에서 줄을 골라 추가하세요.</p>;
  const annotations = items.map(item => review?.[item.fact.id]);
  const reasons = items.map((item, index) => attentionReason(item, annotations[index]));
  const renderFact = (index: number) => {
      const item = items[index];
      const annotation = review?.[item.fact.id];
      const wording = applicableWording(item, annotation);
      const reason = reasons[index];
      const span = item.fact.evidence.find((evidence): evidence is DocumentEvidence => {
        if (evidence.kind !== 'document' || !Number.isInteger(evidence.start) || !Number.isInteger(evidence.end)) return false;
        const chars = pages.get(evidence.page);
        return !!chars && evidence.start >= 0 && evidence.end > evidence.start && evidence.end <= chars.length
          && chars.slice(evidence.start, evidence.end).join('') === evidence.quote;
      });
      const evidence = span ?? item.fact.evidence[0];
      const compact = isCompact(item.fact);
      const invalid = !readOnly && item.included && !isWithinEvidence(item);
      const setStatement = (statement: string) => onChange(index, { ...item, fact: { ...item.fact, statement } });
      return <li key={item.fact.id} className={`${item.included ? '' : 'excluded'}${compact ? ' compact' : ''}${reason && !readOnly ? ' attention' : ''}`}>
        <div className="fact-head">
          <label className="check"><input type="checkbox" checked={item.included} disabled={readOnly} onChange={event => onChange(index, { ...item, included: event.target.checked })} /> {compact ? <span className="sr-only">포함</span> : '포함'}</label>
          <select aria-label="항목 분류" value={item.fact.category} disabled={readOnly} onChange={event => onChange(index, { ...item, fact: { ...item.fact, category: event.target.value as FactCategory } })}>
            {FACT_CATEGORIES.map(category => <option key={category} value={category}>{
              category === 'other' && annotation?.section === 'intro' ? '소개'
                : category === 'achievement' && annotation?.section === 'awards' ? '상훈' : categoryLabel[category]
            }</option>)}
          </select>
          {compact && <input type="text" className="fact-line" aria-label="항목 내용" value={item.fact.statement} readOnly={readOnly} onChange={event => setStatement(event.target.value)} />}
          {originBadge(item)}
          {reason === 'sensitive_excluded' && !readOnly && <span className="tag invalid">{attentionLabel[reason]}</span>}
          {compact && span && <button type="button" className="ghost" title={`원문 위치 보기 (${locationText(span, inputKind)})`} onClick={() => onShow(span)}>원문</button>}
        </div>
        {!compact && <textarea aria-label="항목 내용" value={item.fact.statement} readOnly={readOnly} rows={Math.min(4, Math.ceil(item.fact.statement.length / 48) || 1)}
          onChange={event => setStatement(event.target.value)} />}
        {invalid && <p className="field-error" role="alert">원문 근거 안의 표현으로만 줄이거나 다듬을 수 있습니다. 원문에 없는 수치·역할·자격은 아직 확정할 수 없습니다.</p>}
        {wording && !readOnly && <div className="fact-evidence">
          <span><strong>라이너 문구 제안</strong> {wording}</span>
          <button type="button" className="ghost" onClick={() => setStatement(wording)}>제안 적용</button>
        </div>}
        {/* 원문과 같은 문장은 화면에서 한 번만 보여 준다. */}
        {((evidence && evidence.quote !== item.fact.statement) || (!compact && span)) && <div className="fact-evidence">
          {evidence && evidence.quote !== item.fact.statement && <span className="muted">근거: “{evidence.quote}”</span>}
          {!compact && span && <button type="button" className="ghost" onClick={() => onShow(span)}>원문 위치 보기 ({locationText(span, inputKind)})</button>}
        </div>}
      </li>;
  };
  const renderGroup = (group: FactGroup) => {
    const childIndexes = new Set(group.children?.flatMap(child => child.indexes));
    const ownIndexes = group.indexes.filter(index => !childIndexes.has(index));
    const open = readOnly || (opened[group.key] ?? groupNeedsAttention({ indexes: ownIndexes }, reasons));
    return <section key={group.key} className={`fact-group fact-group-${group.kind}${open || ownIndexes.length === 0 ? '' : ' collapsed'}`} aria-label={group.title}>
      <GroupHead group={group} items={items} readOnly={readOnly} onToggle={included => onToggleGroup(group.indexes, included)}
        open={ownIndexes.length > 0 ? open : null} onOpen={next => setOpened(current => ({ ...current, [group.key]: next }))} />
      {open && ownIndexes.length > 0 && <ol className="fact-list">{ownIndexes.map(renderFact)}</ol>}
      {group.children?.map(renderGroup)}
    </section>;
  };
  return <div className="fact-groups">{factGroups(items.map(item => item.fact), annotations.map(item => item?.section), annotations).map(renderGroup)}</div>;
}
