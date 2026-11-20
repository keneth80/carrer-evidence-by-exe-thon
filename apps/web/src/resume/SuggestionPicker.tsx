import { useState } from 'react';
import type { ResumeFact } from '../../../../packages/resume/src/types.ts';
import { hasBlank } from '../../../../packages/tailor/src/example.ts';
import type { SuggestionSet } from './api.ts';
import { categoryLabel } from './FactEditor.tsx';

// 점검 항목별 추천 문장 고르기(DECISIONS S1-24). 추천 문장을 고르고 [빈칸]만 입력칸에 채우거나, 직접 쓴다.
// 반영하면 그 문장을 '내 진술'로 기록하고 기존 항목을 바꾸거나 새 항목으로 추가한다(추가 모델 호출 없음).

const STYLE_LABEL = { concise: '간결형', scope: '범위형', result: '성과형' } as const;
const BLANK = /(\[[^\]\n]*\])/;
const OWN = -1;

export type AdoptAction = { text: string; targetId: string | null; category: ResumeFact['category'] };
type Props = { set: SuggestionSet; reply: string; targets: ResumeFact[]; busy: boolean; onAdopt: (action: AdoptAction) => void };

// 빈칸을 입력값으로 채운 문장. 비어 있는 칸이 있으면 빈칸이 그대로 남아 반영할 수 없다.
function filled(text: string, values: string[]): string {
  let at = 0;
  return text.split(BLANK).map(part => BLANK.test(part) ? (values[at++]?.trim() || part) : part).join('');
}

export function SuggestionPicker({ set, reply, targets, busy, onAdopt }: Props) {
  const [selected, setSelected] = useState<number>(set.options.length > 0 ? 0 : OWN);
  const [values, setValues] = useState<string[][]>(() => set.options.map(option => option.text.split(BLANK).filter(part => BLANK.test(part)).map(() => '')));
  const [own, setOwn] = useState('');
  const [targetId, setTargetId] = useState<string | null>(targets[0]?.id ?? null);
  const target = targets.find(fact => fact.id === targetId) ?? null;
  const [category, setCategory] = useState<ResumeFact['category']>(target?.category ?? 'responsibility');

  const text = (selected === OWN ? own : filled(set.options[selected].text, values[selected])).trim();
  const ready = text.length > 0 && text.length <= 2000 && !hasBlank(text);
  const setValue = (option: number, blank: number, value: string) => setValues(current => current.map((row, i) => i !== option ? row : row.map((item, j) => j === blank ? value : item)));

  return <div className="suggest-box">
    <p className="fine-print">{reply}</p>
    <div role="radiogroup" aria-label="추천 문장" className="suggest-options">
      {set.options.map((option, index) => {
        let blank = 0;
        return <label key={index} className={`suggest-option ${selected === index ? 'on' : ''}`}>
          <input type="radio" name={`suggest-${set.source_message_id}-${set.finding_index}`} checked={selected === index} onChange={() => setSelected(index)} />
          <span className="tag">{STYLE_LABEL[option.style]}</span>
          <span className="suggest-text">{option.text.split(BLANK).map((part, at) => {
            if (!BLANK.test(part)) return <span key={at}>{part}</span>;
            const slot = blank++;
            const label = part.slice(1, -1);
            return <input key={at} className="blank-input" aria-label={label} placeholder={label} value={values[index][slot] ?? ''} size={Math.max(4, label.length + 2)}
              onFocus={() => setSelected(index)} onChange={event => setValue(index, slot, event.target.value)} />;
          })}</span>
        </label>;
      })}
      <label className={`suggest-option ${selected === OWN ? 'on' : ''}`}>
        <input type="radio" name={`suggest-${set.source_message_id}-${set.finding_index}`} checked={selected === OWN} onChange={() => setSelected(OWN)} />
        <span className="tag">직접 쓰기</span>
        <span className="suggest-own">
          <textarea aria-label="직접 쓰기" value={own} maxLength={2000} placeholder="마음에 드는 문장이 없으면 직접 쓰세요." onFocus={() => setSelected(OWN)} onChange={event => setOwn(event.target.value)} />
          {set.options.length > 0 && <button type="button" className="ghost" onClick={() => { setOwn(filled(set.options[Math.max(0, selected)].text, values[Math.max(0, selected)] ?? [])); setSelected(OWN); }}>고른 문장으로 시작해 고쳐 쓰기</button>}
        </span>
      </label>
    </div>
    {targets.length > 1 && <label className="suggest-target">바꿀 문장
      <select value={targetId ?? ''} onChange={event => { setTargetId(event.target.value); setCategory(targets.find(fact => fact.id === event.target.value)?.category ?? category); }}>
        {targets.map(fact => <option key={fact.id} value={fact.id}>{fact.statement.slice(0, 60)}</option>)}
      </select>
    </label>}
    {!ready && text && hasBlank(text) && <p className="fine-print" role="status">빈칸을 모두 채우거나, 직접 쓰기로 그 부분을 지운 뒤 반영할 수 있어요.</p>}
    <div className="row-actions">
      {target && <button type="button" className="primary small" disabled={busy || !ready} onClick={() => onAdopt({ text, targetId: target.id, category: target.category })}>이 문장으로 바꾸기</button>}
      <label className="fine-print">항목 종류 <select value={category} onChange={event => setCategory(event.target.value as ResumeFact['category'])}>
        {(['responsibility', 'achievement', 'role', 'skill', 'other'] as const).map(value => <option key={value} value={value}>{categoryLabel[value]}</option>)}
      </select></label>
      <button type="button" className="outline small" disabled={busy || !ready} onClick={() => onAdopt({ text, targetId: null, category })}>새 항목으로 추가</button>
    </div>
    <p className="fine-print">반영한 문장은 ‘내가 확인한 문장’으로 확정 경력에 저장돼요. 사실과 다르면 고쳐 쓰세요.</p>
  </div>;
}
