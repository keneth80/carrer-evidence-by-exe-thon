import { codePointLength, codePointSlice, splitLines, statementWithinEvidence } from './source.ts';
import type { SourceText } from './source.ts';
import { FACT_CATEGORIES } from './types.ts';
import type { DocumentEvidence, ExtractionWarning, FactCategory, ResumeFact } from './types.ts';

// 추출 후보의 정리(사용자 요청 2026-11-21, DECISIONS S1-30·S1-31).
// 규칙 추출은 줄 단위라 형식이 특이한 이력서에서 문장이 중간에 끊기거나, 한 줄에 여러 내용이 붙거나, 제목·장식 줄이 항목이 된다.
// 모델은 줄 번호와 작업(그대로·빼기·앞줄에 잇기·나누기), 분류, 속한 회사 줄 번호만 돌려준다.
// 문장은 새로 쓰지 않는다. 이은 문장과 나눈 조각은 원문에 글자 그대로 있어야 하며, 아니면 그 작업만 버린다(AI 문장을 새 사실로 만들지 않는다).
// 묶음은 따로 저장하지 않는다. 속한 회사 밑으로 줄을 옮겨 순서로 표현하므로 화면·Word·PDF의 묶음 규칙(fact-groups.ts, layout.ts)이 그대로 따른다.

export type StructureCall = { workspaceId: string; taskId: string; leaseGeneration: number };
export type StructureLine = { n: number; category: FactCategory; statement: string };
export const STRUCTURE_ACTIONS = ['keep', 'drop', 'join', 'join_nospace', 'split'] as const;
// under: 이 줄이 속한 회사 줄의 번호(지금 위치 그대로면 null). parts: split일 때만, 원문 글자 그대로의 조각.
export type StructureItem = { n: number; action?: string; category: string; under: number | null; parts?: { text: string; category: string }[] | null };
// adds: 규칙이 분류하지 못해 빠진 줄(unclassified)을 항목으로 살린다. w는 그 줄의 번호.
export type StructureAdd = { w: number; category: string; under: number | null };
export type StructureOutput = { items: StructureItem[]; adds?: StructureAdd[] };
// 이력서 전체의 문맥은 원문 줄 위치로 전달하고, 경력 후보로 쓸 수 있는 줄은 따로 표시한다.
export type SourceLineView = { s: number; text: string };
export type Unclassified = { w: number; s: number; page: number | null; start: number; end: number; text: string };
export type StructureContext = { source: SourceLineView[]; unclassified: Unclassified[]; factLine: (number | null)[] };
export type StructureProvider = {
  classify(input: { lines: StructureLine[]; context?: StructureContext; call: StructureCall; signal?: AbortSignal }): Promise<StructureOutput>;
  draft?(input: { source: SourceText; call: StructureCall; signal?: AbortSignal }): Promise<unknown>;
};
export type StructureResult = { facts: ResumeFact[]; dropped: ResumeFact[]; added: Unclassified[]; changed: number; moved: number; joined: number; split: number };

const HEADER_NOTE = '머리글';

// 살릴 수 있는 줄은 규칙이 '분류하지 못함'으로 남긴 줄뿐이다. 부정·미확인·희망 조건·개인정보 줄은 모델이 사실로 만들 수 없다.
export function structureContext(source: SourceText, facts: ResumeFact[], warnings: ExtractionWarning[]): StructureContext {
  const located = warnings.filter(item => item.start !== null && item.end !== null) as (ExtractionWarning & { start: number; end: number })[];
  const excluded = located.filter(item => item.code === 'PERSONAL_INFO_EXCLUDED' || (item.code === 'UNCLASSIFIED_LINE' && item.message.includes(HEADER_NOTE)));
  const lines = source.pages.flatMap(page => splitLines(page.text).filter(line => line.text).map(line => ({ page: page.page, ...line })));
  const lineOf = (page: number | null, start: number) => { const at = lines.findIndex(line => line.page === page && line.start <= start && start < line.end); return at === -1 ? null : at; };
  const overlaps = (line: typeof lines[number], item: { page: number | null; start: number; end: number }) => item.page === line.page && item.start < line.end && line.start < item.end;
  const unclassified = located.filter(item => item.code === 'UNCLASSIFIED_LINE' && !item.message.includes(HEADER_NOTE)).flatMap(item => {
    const s = lineOf(item.page, item.start);
    const page = source.pages.find(candidate => candidate.page === item.page);
    const text = page ? codePointSlice(page.text, item.start, item.end) : '';
    // 앞뒤 공백이 낀 구간은 위치와 문장이 어긋날 수 있어 살리지 않는다.
    return s === null || !text.trim() || text !== text.trim() || excluded.some(item => overlaps(lines[s], item)) ? [] : [{ s, page: item.page, start: item.start, end: item.end, text }];
  }).map((item, w) => ({ w, ...item }));
  const factLine = facts.map(fact => { const evidence = fact.evidence[0]; return evidence?.kind === 'document' ? lineOf(evidence.page, evidence.start) : null; });
  return { source: lines.map((line, s) => ({ s, text: line.text })), unclassified, factLine };
}

export const structureLines = (facts: ResumeFact[]): StructureLine[] => facts.map((fact, n) => ({ n, category: fact.category, statement: fact.statement }));

const META = new Set<string>(['role', 'period', 'location']);
const SPAN_END = new Set<string>(['employer', 'education', 'certification']);
// 모델이 내용을 과하게 빼는 것을 막는다. 넘으면 빼기 작업 전체를 무시한다(뺀 줄은 경고로 남아 다시 넣을 수 있지만 기본값은 보수적으로 둔다).
export const MAX_DROP_RATIO = 0.3;
// 짧은 이력서에서도 제목·쪽 번호 몇 줄은 뺄 수 있게 한다.
const MIN_DROP_ALLOWANCE = 3;
const MAX_STATEMENT = 1000;
const MAX_PARTS = 8;
// 확정 요청 한도(confirm.ts FACT_LIMITS.maxFacts)와 같다. confirm.ts는 node:crypto를 써서 여기서 import하지 않는다.
const MAX_FACTS = 300;
const isCategory = (value: unknown): value is FactCategory => (FACT_CATEGORIES as readonly unknown[]).includes(value);
const onlyEvidence = (fact: ResumeFact): DocumentEvidence | null => fact.evidence.length === 1 && fact.evidence[0].kind === 'document' ? fact.evidence[0] : null;

// 바로 이어진 두 줄만 잇는다. 사이에 다른 글자(가려진 연락처 등)나 빈 줄이 있으면 잇지 않는다.
function joinFacts(head: ResumeFact, tail: ResumeFact, tight: boolean, source: SourceText | undefined): ResumeFact | null {
  const a = onlyEvidence(head);
  const b = onlyEvidence(tail);
  const page = a && source?.pages.find(item => item.page === a.page);
  if (!a || !b || !page || a.page !== b.page || a.document_id !== b.document_id || a.end > b.start) return null;
  const gap = codePointSlice(page.text, a.end, b.start);
  if (/\S/.test(gap) || /\n\s*\n/.test(gap)) return null;
  const quote = codePointSlice(page.text, a.start, b.end);
  const statement = `${head.statement}${tight ? '' : ' '}${tail.statement}`;
  if (statement.length > MAX_STATEMENT || !statementWithinEvidence(statement, [quote])) return null;
  return { ...head, statement, evidence: [{ ...a, end: b.end, quote }] };
}

// 조각은 근거 원문에 순서대로, 글자 그대로 있어야 한다. 하나라도 없으면 나누지 않는다.
function splitFact(fact: ResumeFact, parts: unknown, taken: Set<string>): ResumeFact[] | null {
  const evidence = onlyEvidence(fact);
  if (!evidence || !Array.isArray(parts) || parts.length < 2 || parts.length > MAX_PARTS) return null;
  const made: ResumeFact[] = [];
  let cursor = 0;
  for (const [index, part] of parts.entries()) {
    const text = typeof part?.text === 'string' ? part.text.trim() : '';
    const id = `${fact.id}_${index + 1}`;
    const at = text ? evidence.quote.indexOf(text, cursor) : -1;
    if (at === -1 || !isCategory(part.category) || taken.has(id)) return null;
    const start = evidence.start + codePointLength(evidence.quote.slice(0, at));
    made.push({ id, category: part.category, statement: text, evidence: [{ ...evidence, start, end: start + codePointLength(text), quote: text }] });
    cursor = at + text.length;
  }
  return made;
}

type Entry = { fact: ResumeFact; lines: number[]; under: number | null; whole: boolean };

// 없는 줄 번호, 허용되지 않은 분류·작업, 형식이 다른 응답은 버린다. 같은 줄이 두 번 오면 첫 값만 쓴다.
// source가 없으면 잇기는 하지 않는다(원문과 대조할 수 없다).
// unclassified가 있으면 adds로 온 줄을 원문 순서 자리에 항목으로 넣는다(문장은 원문 그대로, 근거는 그 줄의 위치).
export function applyStructure(facts: ResumeFact[], output: unknown, source?: SourceText, unclassified: Unclassified[] = [], documentId?: string): StructureResult {
  const untouched: StructureResult = { facts, dropped: [], added: [], changed: 0, moved: 0, joined: 0, split: 0 };
  const items = (output as StructureOutput | null)?.items;
  if (!Array.isArray(items)) return untouched;
  const inRange = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < facts.length;
  const asked = new Map<number, StructureItem>();
  for (const item of items) {
    if (!item || !inRange(item.n) || asked.has(item.n) || !isCategory(item.category)) continue;
    if (item.action !== undefined && !(STRUCTURE_ACTIONS as readonly unknown[]).includes(item.action)) continue;
    asked.set(item.n, item);
  }
  const drops = [...asked.values()].filter(item => item.action === 'drop').length;
  const mayDrop = drops <= Math.max(MIN_DROP_ALLOWANCE, Math.floor(facts.length * MAX_DROP_RATIO));
  const taken = new Set(facts.map(fact => fact.id));

  // 살릴 줄: 원문에서 그 줄보다 앞에 있는 마지막 항목 바로 뒤에 넣는다(-1이면 맨 앞).
  const pageRank = new Map((source?.pages ?? []).map((page, at) => [page.page, at]));
  const before = (a: { page: number | null; start: number }, b: { page: number | null; start: number }) => (pageRank.get(a.page) ?? 0) - (pageRank.get(b.page) ?? 0) || a.start - b.start;
  const adds = new Map<number, { line: Unclassified; item: StructureAdd }[]>();
  const added: Unclassified[] = [];
  const rawAdds = (output as StructureOutput).adds;
  const seenAdds = new Set<number>();
  for (const item of Array.isArray(rawAdds) && documentId ? rawAdds : []) {
    const line = item && Number.isInteger(item.w) ? unclassified.find(candidate => candidate.w === item.w) : undefined;
    if (!line || seenAdds.has(line.w) || !isCategory(item.category) || line.text.length > MAX_STATEMENT || facts.length + seenAdds.size >= MAX_FACTS) continue;
    seenAdds.add(line.w);
    let anchor = -1;
    facts.forEach((fact, n) => { const evidence = onlyEvidence(fact); if (evidence && before(evidence, line) < 0) anchor = n; });
    adds.set(anchor, [...(adds.get(anchor) ?? []), { line, item }].sort((a, b) => before(a.line, b.line)));
  }
  const entries: Entry[] = [];
  const pushAdds = (anchor: number) => {
    for (const { line, item } of adds.get(anchor) ?? []) {
      const id = `fact_s_${line.w + 1}`;
      if (taken.has(id)) continue;
      taken.add(id);
      added.push(line);
      entries.push({ fact: { id, category: item.category as FactCategory, statement: line.text, evidence: [{ kind: 'document', document_id: documentId!, page: line.page, start: line.start, end: line.start + codePointLength(line.text), quote: line.text }] },
        lines: [], under: inRange(item.under) ? item.under : null, whole: false });
    }
  };
  pushAdds(-1);
  const dropped: ResumeFact[] = [];
  let changed = 0, joined = 0, split = 0;
  facts.forEach((fact, n) => {
    place(fact, n);
    pushAdds(n);
  });
  function place(fact: ResumeFact, n: number) {
    const item = asked.get(n);
    const action = item?.action ?? 'keep';
    if (action === 'drop' && mayDrop) { dropped.push(fact); return; }
    const previous = entries.at(-1);
    if ((action === 'join' || action === 'join_nospace') && previous?.whole && previous.lines.at(-1) === n - 1) {
      const merged = joinFacts(previous.fact, fact, action === 'join_nospace', source);
      // 이은 문장의 분류는 잇기 항목이 말한 분류를 따른다(문장 끝까지 읽어야 업무인지 성과인지 알 수 있다).
      if (merged) { entries[entries.length - 1] = { ...previous, fact: { ...merged, category: item!.category as FactCategory }, lines: [...previous.lines, n] }; joined++; return; }
    }
    const under = item && inRange(item.under) && item.under !== n ? item.under : null;
    const parts = action === 'split' ? splitFact(fact, item?.parts, taken) : null;
    if (parts) {
      for (const part of parts) { taken.add(part.id); entries.push({ fact: part, lines: [n], under, whole: false }); }
      split++;
      return;
    }
    const category = item && action !== 'drop' ? item.category as FactCategory : fact.category;
    if (category !== fact.category) changed++;
    entries.push({ fact: category === fact.category ? fact : { ...fact, category }, lines: [n], under, whole: true });
  }

  // 속한 회사 줄 번호를 정리한 뒤의 위치로 바꾼다. 회사 줄이 아닌 곳으로는 옮기지 않고, 회사 줄 자체도 옮기지 않는다.
  const entryOf = new Map<number, number>();
  entries.forEach((entry, at) => { for (const line of entry.lines) if (!entryOf.has(line)) entryOf.set(line, at); });
  const moves = new Map<number, number>();
  entries.forEach((entry, at) => {
    const target = entry.under === null ? undefined : entryOf.get(entry.under);
    if (target !== undefined && target !== at && entries[target].fact.category === 'employer' && entry.fact.category !== 'employer') moves.set(at, target);
  });
  const movedTo = (employer: number, meta: boolean) => [...moves].filter(([at, target]) => target === employer && META.has(entries[at].fact.category) === meta).map(([at]) => at).sort((a, b) => a - b);
  const order: number[] = [];
  let open: number | null = null;
  // 회사 구간이 끝날 때(다음 회사·학력·자격·문서 끝) 옮겨 온 업무·성과 줄을 붙인다. 직무·기간·지역은 회사 줄 바로 다음에 둔다.
  const close = () => { if (open !== null) order.push(...movedTo(open, false)); open = null; };
  entries.forEach((entry, at) => {
    if (moves.has(at)) return;
    if (SPAN_END.has(entry.fact.category)) close();
    order.push(at);
    if (entry.fact.category === 'employer') { open = at; order.push(...movedTo(at, true)); }
  });
  close();
  const stayed = order.every((at, index) => at === index);
  if (changed === 0 && joined === 0 && split === 0 && dropped.length === 0 && added.length === 0 && stayed) return untouched;
  return { facts: order.map(at => entries[at].fact), dropped, added, changed, moved: stayed ? 0 : moves.size, joined, split };
}
