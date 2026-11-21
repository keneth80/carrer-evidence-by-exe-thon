import { groupBySection } from './blocks.ts';
import { SECTION_ORDER, TAILORED_SECTION } from './types.ts';
import type { FactLike, ResumeBlock } from './types.ts';

// 공고별 이력서를 회사별로 묶어 보여 주는 배치(사용자 테스트 2026-11-21, DECISIONS S1-26).
// "경력 따로 성과 따로 나온다" → 회사(·기간) 아래에 그 회사의 직무·업무·성과를 둔다. 기본 이력서 Word(resume-docx.ts)와 같은 묶음이다.
// 저장된 블록(계약 ResumeBlock)은 바꾸지 않는다. 블록의 근거 사실이 확정 경력에서 어느 회사 구간에 있는지로 묶으므로 기존 세션에도 그대로 적용된다.
// 핵심 요약·기술·학력·자격은 회사에 묶지 않는다. 근거 사실을 찾지 못한 블록은 원래 구역에 둔다.

export type CareerItemKind = 'role' | 'period' | 'work' | 'achievement' | 'other';
export type CareerItem = { block: ResumeBlock; kind: CareerItemKind };
// heading: 회사 블록(맞춤 수정에서 지워졌으면 null, 제목은 확정 경력의 회사 문장).
export type EmployerGroup = { heading: ResumeBlock | null; title: string; items: CareerItem[] };
export type LayoutSection = { section: string; blocks: ResumeBlock[]; employers: EmployerGroup[] };

const CAREER_SECTION = '경력';
// 첫 회사보다 앞에 있는 성과는 이력서 맨 위의 핵심 성과 요약이다(실제 이력서 관찰 2026-11-21). 요약 다음에 둔다.
export const KEY_RESULTS_SECTION = '주요 성과';
const ORDER: readonly string[] = [SECTION_ORDER[0], SECTION_ORDER[1], KEY_RESULTS_SECTION, ...SECTION_ORDER.slice(2)];
// 학력·자격이 나오면 회사 구간이 끝난다(그 뒤 문장을 마지막 회사에 붙이지 않는다).
const SPAN_BREAK = new Set(['education', 'certification']);
const STANDALONE = new Set<string>([TAILORED_SECTION, '기술', '학력', '자격']);
const KIND: Record<string, CareerItemKind> = { role: 'role', period: 'period', responsibility: 'work', achievement: 'achievement' };

const rank = (section: string) => {
  const at = ORDER.indexOf(section);
  return at === -1 ? ORDER.length : at;
};

type Placed = { block: ResumeBlock; order: number; employerAt: number | null; isHeading: boolean; kind: CareerItemKind };

export function resumeLayout(blocks: ResumeBlock[], facts: FactLike[]): LayoutSection[] {
  const position = new Map<string, number>();
  facts.forEach((fact, at) => { if (!position.has(fact.id)) position.set(fact.id, at); });
  const employers = facts.flatMap((fact, at) => fact.category === 'employer' && position.get(fact.id) === at ? [at] : []);
  const employerOf = (at: number) => {
    let found: number | null = null;
    for (const start of employers) if (start <= at) found = start;
    if (found === null) return null;
    for (let between = found + 1; between < at; between++) if (SPAN_BREAK.has(facts[between].category)) return null;
    return found;
  };

  const loose: ResumeBlock[] = [];
  const placed: Placed[] = [];
  blocks.forEach((block, order) => {
    const spots = block.fact_ids.map(id => position.get(id)).filter((at): at is number => at !== undefined);
    if (STANDALONE.has(block.section) || spots.length === 0) { loose.push(block); return; }
    const heading = spots.find(at => facts[at].category === 'employer');
    const anchor = heading ?? Math.min(...spots);
    const employerAt = heading ?? employerOf(anchor);
    if (employerAt === null) {
      loose.push(block.section === '성과' && (employers.length === 0 || anchor < employers[0]) ? { ...block, section: KEY_RESULTS_SECTION } : block);
      return;
    }
    placed.push({ block, order: anchor * 10_000 + order, employerAt, isHeading: heading !== undefined, kind: KIND[facts[anchor].category] ?? 'other' });
  });

  const groups: EmployerGroup[] = employers.flatMap(start => {
    const mine = placed.filter(item => item.employerAt === start).sort((a, b) => a.order - b.order);
    if (mine.length === 0) return [];
    const head = mine.find(item => item.isHeading)?.block ?? null;
    let items: CareerItem[] = mine.filter(item => !item.isHeading).map(item => ({ block: item.block, kind: item.kind }));
    let title = head?.text ?? facts[start].statement;
    // 회사 → 직함 → 기간 순서의 이력서는 기간이 회사와 떨어져 있다. 회사 제목에 붙여 한눈에 보이게 한다(Word와 같은 표기).
    const headHasPeriod = head?.fact_ids.some(id => facts[position.get(id) ?? -1]?.category === 'period') ?? false;
    const period = headHasPeriod ? undefined : items.find(item => item.kind === 'period');
    if (period) { title = `${title} · ${period.block.text}`; items = items.filter(item => item !== period); }
    return [{ heading: head, title, items }];
  });

  const sections: LayoutSection[] = groupBySection([...loose].sort((a, b) => rank(a.section) - rank(b.section)))
    .map(group => ({ section: group.section, blocks: group.blocks, employers: [] }));
  if (groups.length > 0) {
    const career = sections.find(section => section.section === CAREER_SECTION);
    if (career) career.employers = groups;
    else sections.push({ section: CAREER_SECTION, blocks: [], employers: groups });
  }
  return sections.sort((a, b) => rank(a.section) - rank(b.section));
}

// 회사 묶음까지 포함해 화면·PDF에 실제로 나오는 문장(글꼴 점검용).
export function layoutTexts(sections: LayoutSection[]): string[] {
  return sections.flatMap(section => [section.section, ...section.blocks.map(block => block.text),
    ...section.employers.flatMap(group => [group.title, ...group.items.map(item => item.block.text)])]);
}
