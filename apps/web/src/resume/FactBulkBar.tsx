import { categoryLabel } from './FactEditor.tsx';
import type { EditableFact } from './FactEditor.tsx';
import { categorySummary, MAX_SAVED_FACTS, setIncluded } from './bulk.ts';

// 경력 항목 일괄 선택. 분류 버튼은 그 분류가 모두 포함이면 모두 제외, 아니면 모두 포함으로 바꾼다.
export function FactBulkBar({ items, onChange }: { items: EditableFact[]; onChange: (next: EditableFact[]) => void }) {
  if (items.length === 0) return null;
  const included = items.filter(item => item.included).length;
  return <div className="bulk-bar" role="group" aria-label="경력 항목 일괄 선택">
    <div className="bulk-row">
      <span className="muted">포함 {included} / {items.length}</span>
      <button type="button" className="ghost" disabled={included === items.length} onClick={() => onChange(setIncluded(items, true))}>모두 포함</button>
      <button type="button" className="ghost" disabled={included === 0} onClick={() => onChange(setIncluded(items, false))}>모두 제외</button>
    </div>
    <div className="bulk-row">
      <span className="muted">분류별</span>
      {categorySummary(items).map(({ category, total, included: count }) => {
        const all = count === total;
        return <button key={category} type="button" className={`chip${all ? ' on' : count === 0 ? '' : ' partial'}`} aria-pressed={all}
          title={all ? `${categoryLabel[category]} ${total}개 모두 제외` : `${categoryLabel[category]} ${total}개 모두 포함`}
          onClick={() => onChange(setIncluded(items, !all, category))}>{categoryLabel[category]} {count}/{total}</button>;
      })}
    </div>
    {included > MAX_SAVED_FACTS && <p className="field-error" role="alert">한 번에 저장할 수 있는 항목은 {MAX_SAVED_FACTS}개입니다. {included - MAX_SAVED_FACTS}개를 더 제외하세요.</p>}
  </div>;
}
