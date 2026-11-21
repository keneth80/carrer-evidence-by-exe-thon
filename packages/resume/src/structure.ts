import { FACT_CATEGORIES } from './types.ts';
import type { FactCategory, ResumeFact } from './types.ts';

// 추출 후보의 분류·묶음 보정(사용자 요청 2026-11-21, DECISIONS S1-30).
// 규칙 추출은 줄 단위라 회사·직무·기간·근무지를 틀리게 나누거나 다른 회사 밑에 두는 이력서가 있다.
// 모델은 줄 번호, 분류, 속한 회사 줄 번호만 돌려준다. 문장·근거·개수는 여기서 절대 바뀌지 않는다(AI 문장을 새 사실로 만들지 않는다).
// 묶음은 따로 저장하지 않는다. 속한 회사 밑으로 줄을 옮겨 순서로 표현하므로 화면·Word·PDF의 묶음 규칙(fact-groups.ts, layout.ts)이 그대로 따른다.

export type StructureCall = { workspaceId: string; taskId: string; leaseGeneration: number };
export type StructureLine = { n: number; category: FactCategory; statement: string };
// under: 이 줄이 속한 회사 줄의 번호. 지금 위치 그대로면 null.
export type StructureOutput = { items: { n: number; category: string; under: number | null }[] };
export type StructureProvider = { classify(input: { lines: StructureLine[]; call: StructureCall; signal?: AbortSignal }): Promise<StructureOutput> };

export const structureLines = (facts: ResumeFact[]): StructureLine[] => facts.map((fact, n) => ({ n, category: fact.category, statement: fact.statement }));

const META = new Set<string>(['role', 'period', 'location']);
const SPAN_END = new Set<string>(['employer', 'education', 'certification']);

// 없는 줄 번호, 허용되지 않은 분류, 형식이 다른 응답은 버린다. 같은 줄이 두 번 오면 첫 값만 쓴다.
// changed: 분류가 바뀐 줄 수, moved: 다른 회사 밑으로 옮긴 줄 수.
export function applyStructure(facts: ResumeFact[], output: unknown): { facts: ResumeFact[]; changed: number; moved: number } {
  const items = (output as StructureOutput | null)?.items;
  if (!Array.isArray(items)) return { facts, changed: 0, moved: 0 };
  const inRange = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < facts.length;
  const seen = new Set<number>();
  const category = new Map<number, FactCategory>();
  const wanted = new Map<number, number>();
  for (const item of items) {
    if (!item || !inRange(item.n) || seen.has(item.n) || !(FACT_CATEGORIES as readonly string[]).includes(item.category)) continue;
    seen.add(item.n);
    if (facts[item.n].category !== item.category) category.set(item.n, item.category as FactCategory);
    if (inRange(item.under) && item.under !== item.n) wanted.set(item.n, item.under);
  }
  const fixed = category.size === 0 ? facts : facts.map((fact, n) => category.has(n) ? { ...fact, category: category.get(n)! } : fact);
  // 회사 줄이 아닌 곳으로는 옮기지 않는다. 회사 줄 자체도 옮기지 않는다.
  const moves = new Map([...wanted].filter(([n, under]) => fixed[under].category === 'employer' && fixed[n].category !== 'employer'));
  if (moves.size === 0) return { facts: fixed, changed: category.size, moved: 0 };

  const movedTo = (employer: number, meta: boolean) => [...moves].filter(([n, under]) => under === employer && META.has(fixed[n].category) === meta).map(([n]) => n).sort((a, b) => a - b);
  const order: number[] = [];
  let open: number | null = null;
  // 회사 구간이 끝날 때(다음 회사·학력·자격·문서 끝) 옮겨 온 업무·성과 줄을 붙인다. 직무·기간·지역은 회사 줄 바로 다음에 둔다.
  const close = () => { if (open !== null) order.push(...movedTo(open, false)); open = null; };
  fixed.forEach((fact, n) => {
    if (moves.has(n)) return;
    if (SPAN_END.has(fact.category)) close();
    order.push(n);
    if (fact.category === 'employer') { open = n; order.push(...movedTo(n, true)); }
  });
  close();
  const stayed = order.every((n, at) => n === at);
  return { facts: stayed ? fixed : order.map(n => fixed[n]), changed: category.size, moved: stayed ? 0 : moves.size };
}
