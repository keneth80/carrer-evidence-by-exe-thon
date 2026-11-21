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
// 마지막 회사 뒤의 '이름 | 설명' 줄부터는 개인·사이드 프로젝트다(실제 이력서 2026-11-21: 마지막 회사 밑에 프로젝트 15줄이 붙었다).
export const PROJECT_SECTION = '프로젝트';
const ORDER: readonly string[] = SECTION_ORDER.flatMap(section => section === SECTION_ORDER[1] ? [section, KEY_RESULTS_SECTION] : section === CAREER_SECTION ? [section, PROJECT_SECTION] : [section]);
// 학력·자격이 나오면 회사 구간이 끝난다(그 뒤 문장을 마지막 회사에 붙이지 않는다).
const SPAN_BREAK = new Set(['education', 'certification']);
const STANDALONE = new Set<string>([TAILORED_SECTION, '기술', '학력', '자격']);
const KIND: Record<string, CareerItemKind> = { role: 'role', period: 'period', responsibility: 'work', achievement: 'achievement' };
const PROJECT_HEAD = /^\S.{0,40}\s\|\s+\S/;

// 소제목 줄(사용자 요청 2026-11-21): '협업과 프로젝트 운영'처럼 짧고 문장이 아닌 줄 바로 다음에 서술 문장이 오면 새 묶음의 제목이다.
// 주소·링크 안내 줄('○○.com', 'App Store에서 보기')은 다음 줄이 다른 제목이거나 구간 끝이라 제목이 되지 않는다.
const SENTENCE_END = /(?:다|요|[.!?。])$/;
const LINK_LIKE = /https?:|www\.|\.[a-z]{2,}(?:\/|$)/i;
function isSubheading(facts: FactLike[], at: number, end: number): boolean {
  const text = facts[at].statement.trim();
  const next = facts[at + 1];
  if (facts[at].category !== 'responsibility' && facts[at].category !== 'other') return false;
  if (text.length > 30 || text.includes('|') || SENTENCE_END.test(text) || LINK_LIKE.test(text)) return false;
  if (at + 1 >= end || !next || !['responsibility', 'achievement', 'other'].includes(next.category)) return false;
  const following = next.statement.trim();
  return SENTENCE_END.test(following) && !PROJECT_HEAD.test(following);
}

const rank = (section: string) => {
  const at = ORDER.indexOf(section);
  return at === -1 ? ORDER.length : at;
};

const employerIndexes = (facts: FactLike[]) => facts.flatMap((fact, at) => fact.category === 'employer' ? [at] : []);

// 회사(사실 위치) → 그 회사의 근무 기간(사실 위치). 실제 이력서(2026-11-21)는 최근 경력이 '회사 → 기간', 오래된 경력이 '기간 → 회사' 순서라
// 회사 구간의 첫 기간만 보면 오래된 경력 6곳의 기간이 한 칸씩 밀렸다. 가까운 것부터 정한다:
// ① 회사 바로 다음 기간 ② 회사 바로 앞 기간(앞 회사가 자기 기간을 이미 가졌을 때만) ③ 회사 구간에 남은 첫 기간(회사 → 직함 → 기간).
export function employerPeriods(facts: FactLike[]): Map<number, number> {
  const employers = employerIndexes(facts);
  const owned = new Map<number, number>();
  const claimed = new Set<number>();
  const give = (employer: number, period: number) => { owned.set(employer, period); claimed.add(period); };
  for (const at of employers) if (facts[at + 1]?.category === 'period') give(at, at + 1);
  employers.forEach((at, index) => {
    const previous = employers[index - 1];
    if (!owned.has(at) && at > 0 && facts[at - 1].category === 'period' && !claimed.has(at - 1) && (previous === undefined || owned.has(previous))) give(at, at - 1);
  });
  for (const at of employers) {
    if (owned.has(at)) continue;
    for (let next = at + 1; next < facts.length && facts[next].category !== 'employer' && !SPAN_BREAK.has(facts[next].category); next++) {
      if (facts[next].category === 'period' && !claimed.has(next)) { give(at, next); break; }
    }
  }
  return owned;
}

// 프로젝트 구간: 마지막 회사 뒤 첫 '이름 | 설명' 줄부터 학력·자격 전까지. heads는 프로젝트 제목 줄의 위치.
export function projectSpan(facts: FactLike[]): { start: number; end: number; heads: number[] } | null {
  const last = employerIndexes(facts).at(-1);
  if (last === undefined) return null;
  let end = last + 1;
  while (end < facts.length && !SPAN_BREAK.has(facts[end].category)) end++;
  const titled = (at: number) => (facts[at].category === 'responsibility' || facts[at].category === 'other') && PROJECT_HEAD.test(facts[at].statement);
  const first = Array.from({ length: end - last - 1 }, (_, offset) => last + 1 + offset).find(titled);
  if (first === undefined) return null;
  const heads: number[] = [];
  for (let at = first; at < end; at++) if (titled(at) || isSubheading(facts, at, end)) heads.push(at);
  return { start: first, end, heads };
}

type Placed = { block: ResumeBlock; order: number; anchor: number; group: number; isHeading: boolean; kind: CareerItemKind };

export function resumeLayout(blocks: ResumeBlock[], facts: FactLike[]): LayoutSection[] {
  const position = new Map<string, number>();
  facts.forEach((fact, at) => { if (!position.has(fact.id)) position.set(fact.id, at); });
  const employers = employerIndexes(facts).filter(at => position.get(facts[at].id) === at);
  const periods = employerPeriods(facts);
  const periodOwner = new Map([...periods].map(([employer, period]) => [period, employer]));
  const projects = projectSpan(facts);
  const employerOf = (at: number) => {
    if (periodOwner.has(at)) return periodOwner.get(at)!;
    let found: number | null = null;
    for (const start of employers) if (start <= at) found = start;
    if (found === null) return null;
    for (let between = found + 1; between < at; between++) if (SPAN_BREAK.has(facts[between].category)) return null;
    return found;
  };
  const projectOf = (at: number) => projects && at >= projects.start && at < projects.end ? projects.heads.filter(head => head <= at).at(-1)! : null;

  const loose: ResumeBlock[] = [];
  const career: Placed[] = [];
  const project: Placed[] = [];
  blocks.forEach((block, order) => {
    const spots = block.fact_ids.map(id => position.get(id)).filter((at): at is number => at !== undefined);
    if (STANDALONE.has(block.section) || spots.length === 0) { loose.push(block); return; }
    const heading = spots.find(at => facts[at].category === 'employer');
    const anchor = heading ?? Math.min(...spots);
    const kind = KIND[facts[anchor].category] ?? 'other';
    const projectAt = heading === undefined ? projectOf(anchor) : null;
    if (projectAt !== null) { project.push({ block, order: anchor * 10_000 + order, anchor, group: projectAt, isHeading: anchor === projectAt, kind }); return; }
    const employerAt = heading ?? employerOf(anchor);
    if (employerAt === null) {
      loose.push(block.section === '성과' && (employers.length === 0 || anchor < employers[0]) ? { ...block, section: KEY_RESULTS_SECTION } : block);
      return;
    }
    career.push({ block, order: anchor * 10_000 + order, anchor, group: employerAt, isHeading: heading !== undefined, kind });
  });

  const groupsOf = (placed: Placed[], starts: number[], withPeriod: boolean): EmployerGroup[] => starts.flatMap(start => {
    const mine = placed.filter(item => item.group === start).sort((a, b) => a.order - b.order);
    if (mine.length === 0) return [];
    const head = mine.find(item => item.isHeading)?.block ?? null;
    let rest = mine.filter(item => !item.isHeading);
    let title = head?.text ?? facts[start].statement;
    // 회사와 떨어져 있는 기간은 회사 제목에 붙여 한눈에 보이게 한다(Word와 같은 표기).
    const headHasPeriod = head?.fact_ids.some(id => facts[position.get(id) ?? -1]?.category === 'period') ?? false;
    const period = withPeriod && !headHasPeriod ? rest.find(item => item.anchor === periods.get(start)) : undefined;
    if (period) { title = `${title} · ${period.block.text}`; rest = rest.filter(item => item !== period); }
    return [{ heading: head, title, items: rest.map(item => ({ block: item.block, kind: item.kind })) }];
  });

  const sections: LayoutSection[] = groupBySection([...loose].sort((a, b) => rank(a.section) - rank(b.section)))
    .map(group => ({ section: group.section, blocks: group.blocks, employers: [] }));
  const attach = (name: string, groups: EmployerGroup[]) => {
    if (groups.length === 0) return;
    const found = sections.find(section => section.section === name);
    if (found) found.employers = groups;
    else sections.push({ section: name, blocks: [], employers: groups });
  };
  attach(CAREER_SECTION, groupsOf(career, employers, true));
  attach(PROJECT_SECTION, groupsOf(project, projects?.heads ?? [], false));
  return sections.sort((a, b) => rank(a.section) - rank(b.section));
}

// 회사 묶음까지 포함해 화면·PDF에 실제로 나오는 문장(글꼴 점검용).
export function layoutTexts(sections: LayoutSection[]): string[] {
  return sections.flatMap(section => [section.section, ...section.blocks.map(block => block.text),
    ...section.employers.flatMap(group => [group.title, ...group.items.map(item => item.block.text)])]);
}
