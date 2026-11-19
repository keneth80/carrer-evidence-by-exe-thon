import type { FactCategory, ResumeFact } from '../../../../packages/resume/src/types.ts';
import type { EditableFact } from './FactEditor.tsx';
import type { Span } from './SourcePanel.tsx';

// 추출 확인 화면의 일괄 선택. 후보가 수백 개인 이력서도 분류 단위로 포함/제외하고, 원문 줄을 묶어서 추가한다.
// 항목 내용은 바꾸지 않고 포함 여부·추가만 다룬다(확정은 저장 때 서버가 근거를 다시 검증한다).

export type SourceLine = { span: Span; quote: string };

// 서버 확정 한도(packages/resume/src/confirm.ts FACT_LIMITS.maxFacts)와 같은 값. confirm.ts는 node:crypto를 써서 브라우저에서 import할 수 없다.
// 두 값이 어긋나지 않는지는 tests/fact-bulk.test.mjs가 확인한다.
export const MAX_SAVED_FACTS = 300;
export type CategoryCount = { category: FactCategory; total: number; included: number };

// category를 주면 그 분류만, 없으면 전체를 바꾼다. 바뀌지 않는 항목은 같은 객체를 그대로 둔다.
export function setIncluded(items: EditableFact[], included: boolean, category?: FactCategory): EditableFact[] {
  return items.map(item => (category && item.fact.category !== category) || item.included === included ? item : { ...item, included });
}

export function categorySummary(items: EditableFact[]): CategoryCount[] {
  const order: FactCategory[] = [];
  const counts = new Map<FactCategory, { total: number; included: number }>();
  for (const item of items) {
    const category = item.fact.category;
    const current = counts.get(category) ?? { total: 0, included: 0 };
    if (!counts.has(category)) order.push(category);
    counts.set(category, { total: current.total + 1, included: current.included + (item.included ? 1 : 0) });
  }
  return order.map(category => ({ category, ...(counts.get(category) as { total: number; included: number }) }));
}

const spanKey = (page: number | null, start: number, end: number) => `${page ?? '-'}:${start}-${end}`;

// 이미 같은 원문 위치를 근거로 가진 항목이 있으면 다시 만들지 않는다. id는 prefix와 위치 번호로 겹치지 않게 만든다.
export function addLines(items: EditableFact[], lines: SourceLine[], documentId: string, idPrefix: string): EditableFact[] {
  const seen = new Set(items.flatMap(item => item.fact.evidence.flatMap(evidence => evidence.kind === 'document' ? [spanKey(evidence.page, evidence.start, evidence.end)] : [])));
  const ids = new Set(items.map(item => item.fact.id));
  const added: EditableFact[] = [];
  for (const { span, quote } of lines) {
    const key = spanKey(span.page, span.start, span.end);
    if (!quote.trim() || seen.has(key)) continue;
    seen.add(key);
    let n = items.length + added.length;
    while (ids.has(`fact_${idPrefix}_${n}`)) n++;
    const id = `fact_${idPrefix}_${n}`;
    ids.add(id);
    const fact: ResumeFact = { id, category: 'other', statement: quote, evidence: [{ kind: 'document', document_id: documentId, page: span.page, start: span.start, end: span.end, quote }] };
    added.push({ fact, original: quote, included: true, origin: 'user_added' });
  }
  return added.length === 0 ? items : [...items, ...added];
}
