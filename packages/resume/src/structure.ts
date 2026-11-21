import { codePointLength, codePointSlice, splitLines, statementWithinEvidence } from './source.ts';
import type { SourceText } from './source.ts';
import { FACT_CATEGORIES } from './types.ts';
import type { ExtractionWarning, FactCategory, ResumeFact } from './types.ts';

// 이력서 항목 구성(사용자 요청 2026-11-21, DECISIONS S1-32).
// 규칙으로 먼저 자르고 고치던 방식(S1-30·S1-31)은 PDF가 카드·표를 조각 줄로 내놓을 때 한계가 있었다.
// 실호출에서는 원문 전체를 모델에 보내 모델이 항목을 정한다. 모델은 "원문 몇 번째 줄부터 몇 번째 줄까지가 한 항목"인지와 분류만 돌려준다.
// 문장은 그 줄들을 원문 그대로 이은 것이고 근거는 그 줄들의 위치다. 모델이 쓴 글자는 항목에 들어가지 않는다(AI 문장을 새 사실로 만들지 않는다).
// 묶음은 저장하지 않는다. 모델이 낸 순서(회사 → 직무 → 기간 → 지역 → 업무·성과)를 그대로 두면 화면·Word·PDF의 묶음 규칙이 따른다.

export type StructureCall = { workspaceId: string; taskId: string; leaseGeneration: number };
// from~to: 한 항목이 되는 원문 줄 번호(이어진 줄). text: 한 줄 안의 일부만 쓸 때 그 줄에 있는 글자 그대로(아니면 null).
export type ComposeItem = { from: number; to: number; text: string | null; category: string };
export type ComposeOutput = { items: ComposeItem[] };
export type SourceLine = { s: number; page: number | null; start: number; end: number; text: string; state: 'open' | 'hidden' | 'blocked' };
export type StructureProvider = { compose(input: { lines: SourceLine[]; call: StructureCall; signal?: AbortSignal }): Promise<ComposeOutput> };
export type ComposeResult = { facts: ResumeFact[]; unused: SourceLine[] };

// 모델이 항목에 넣지 않은 줄의 경고 문구. 화면이 구역 제목을 찾을 때 이 문구로 알아본다(sections.ts).
export const UNUSED_NOTE = 'AI가 항목으로 넣지 않은 줄';
export const MASKED_LINE = '[개인정보로 보여 가린 줄]';
const HEADER_NOTE = '머리글';
const MAX_FACTS = 300; // 확정 요청 한도(confirm.ts FACT_LIMITS.maxFacts)와 같다. confirm.ts는 node:crypto를 써서 여기서 import하지 않는다.
const MAX_STATEMENT = 1000;
const MAX_SPAN = 12;
// 모델 결과가 원문을 너무 적게 담으면(응답이 잘렸거나 지시를 따르지 않음) 쓰지 않고 규칙 결과로 돌아간다.
export const MIN_COVERAGE = 0.4;

// 원문을 줄 번호와 함께 만든다. 상태:
// hidden — 연락처로 제외한 줄과 머리글 줄(이름일 수 있음). 내용을 보내지 않는다.
// blocked — 부정·미확인 표현, 희망 조건. 내용은 보내지만 항목으로 만들 수 없다(경험 없음·희망을 사실로 확정하지 않는다).
export function sourceLines(source: SourceText, warnings: ExtractionWarning[]): SourceLine[] {
  const located = warnings.filter(item => item.start !== null && item.end !== null) as (ExtractionWarning & { start: number; end: number })[];
  const hits = (line: { page: number | null; start: number; end: number }, test: (item: ExtractionWarning) => boolean) => located.some(item => test(item) && item.page === line.page && item.start < line.end && line.start < item.end);
  return source.pages.flatMap(page => splitLines(page.text).filter(line => line.text).map(line => ({ page: page.page, ...line }))).map((line, s) => ({
    s, ...line,
    state: hits(line, item => item.code === 'PERSONAL_INFO_EXCLUDED' || (item.code === 'UNCLASSIFIED_LINE' && item.message.includes(HEADER_NOTE))) ? 'hidden' as const
      : hits(line, item => item.code === 'NEGATED_OR_UNVERIFIED' || item.code === 'PREFERENCE_NOT_FACT') ? 'blocked' as const : 'open' as const,
  }));
}

const isCategory = (value: unknown): value is FactCategory => (FACT_CATEGORIES as readonly unknown[]).includes(value);

// 모델 응답으로 항목을 만든다. 형식이 다르거나, 가린·막힌 줄을 쓰거나, 이미 쓴 줄을 다시 쓰거나, 줄에 없는 글자를 쓴 항목은 버린다.
// 쓸 수 있는 결과가 아니면 null(호출한 쪽이 규칙 결과로 돌아간다).
export function composeFacts(source: SourceText, lines: SourceLine[], output: unknown, documentId: string): ComposeResult | null {
  const items = (output as ComposeOutput | null)?.items;
  if (!Array.isArray(items)) return null;
  const inRange = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < lines.length;
  const whole = new Set<number>();            // 줄 전체를 쓴 줄
  const cursor = new Map<number, [number, number][]>();   // 일부만 쓴 줄: 이미 쓴 구간들(UTF-16)
  const facts: ResumeFact[] = [];
  for (const item of items) {
    if (facts.length >= MAX_FACTS) break;
    if (!item || !inRange(item.from) || !inRange(item.to) || item.to < item.from || item.to - item.from >= MAX_SPAN || !isCategory(item.category)) continue;
    const span = lines.slice(item.from, item.to + 1);
    const first = span[0];
    if (span.some(line => line.state !== 'open' || line.page !== first.page || whole.has(line.s))) continue;
    const page = source.pages.find(candidate => candidate.page === first.page);
    if (!page) continue;
    let start = first.start, end = span.at(-1)!.end, statement = span.map(line => line.text).join(' ');
    if (typeof item.text === 'string' && item.text.trim() && item.text.trim() !== first.text) {
      // 한 줄의 일부(표 한 줄에 붙은 회사·직함·기간 등). 그 줄에 순서대로, 글자 그대로 있어야 한다.
      const part = item.text.trim();
      // 조각의 순서는 묻지 않는다. 원문이 '기간 회사 직함' 순서인데 모델은 회사 → 직함 → 기간 순으로 내므로,
      // 앞에서부터만 찾으면 기간 조각이 버려졌다(실호출 관찰 2026-11-21: 회사 12곳 중 기간 6개). 이미 쓴 구간과 겹치지 않는 첫 위치를 쓴다.
      const used = cursor.get(first.s) ?? [];
      let at = span.length === 1 ? first.text.indexOf(part) : -1;
      while (at !== -1 && used.some(([from, to]) => at < to && from < at + part.length)) at = first.text.indexOf(part, at + 1);
      if (at === -1) continue;
      cursor.set(first.s, [...used, [at, at + part.length]]);
      start = first.start + codePointLength(first.text.slice(0, at));
      end = start + codePointLength(part);
      statement = part;
    } else {
      if (span.some(line => cursor.has(line.s))) continue;
      for (const line of span) whole.add(line.s);
    }
    const quote = codePointSlice(page.text, start, end);
    if (statement.length > MAX_STATEMENT || !statementWithinEvidence(statement, [quote])) continue;
    facts.push({ id: `fact_${String(facts.length + 1).padStart(3, '0')}`, category: item.category, statement, evidence: [{ kind: 'document', document_id: documentId, page: first.page, start, end, quote }] });
  }
  const open = lines.filter(line => line.state === 'open');
  const unused = open.filter(line => !whole.has(line.s) && !cursor.has(line.s));
  if (facts.length === 0 || open.length - unused.length < open.length * MIN_COVERAGE) return null;
  return { facts, unused };
}
