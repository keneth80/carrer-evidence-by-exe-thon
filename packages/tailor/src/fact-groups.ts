import { employerPeriods, projectSpan } from './layout.ts';
import type { FactLike } from './types.ts';
import { REVIEW_SECTIONS } from '../../resume/src/types.ts';
import type { FactReview, ReviewSection } from '../../resume/src/types.ts';

// 추출 확인 화면의 묶음(사용자 테스트 2026-11-21, DECISIONS S1-30).
// "회사명 따로, 직무 따로, 근무지역 따로 체크박스로 나와 보기 힘들다" → 회사·프로젝트·학력 등으로 묶어 보여 주고 묶음 단위로 고른다.
// 맞춤 이력서·Word와 같은 규칙(layout.ts)을 쓴다. 표시만 바꾸며 항목 내용·순서·저장 형식은 그대로다.

export type FactGroupKind = 'employer' | 'project' | 'section';
// indexes: 이 묶음에 든 항목의 위치(facts 배열 기준). 묶음 안에서는 회사·직무·기간·지역이 먼저 온다.
export type FactGroup = { key: string; kind: FactGroupKind; title: string; indexes: number[]; children?: FactGroup[] };

const SECTION_BY_CATEGORY: Partial<Record<string, ReviewSection>> = { skill: 'skills', education: 'education', certification: 'certifications' };
const SPAN_BREAK = new Set(['education', 'certification']);
const META_ORDER = ['employer', 'role', 'period', 'location'];
const AWARD = /(?:수상|표창|상훈|훈장|공로상|우수상|대상 수상|\bawards?\b)/i;
const PROJECT_HEADING = /^(?:프로젝트(?:명)?|project)\s*[:：]\s*\S|^.{1,40}\s프로젝트$/i;
const PERSONAL_PROJECT = /(?:개인|사이드|토이)\s*프로젝트|\b(?:personal|side) project\b/i;

const REVIEW_TITLE: Record<ReviewSection, string> = { intro: '소개', career: '근무 이력', awards: '상훈', education: '학력', skills: '기술', certifications: '자격', sensitive: '민감정보', other: '기타' };

function reviewSection(section: ReviewSection): Omit<FactGroup, 'indexes'> {
  return { key: `review:${section}`, kind: 'section', title: REVIEW_TITLE[section] };
}

export function factGroups(facts: FactLike[], sections: (ReviewSection | undefined)[] = [], review: (FactReview | undefined)[] = []): FactGroup[] {
  const employers = facts.flatMap((fact, at) => fact.category === 'employer' ? [at] : []);
  const periods = employerPeriods(facts);
  const periodOwner = new Map([...periods].map(([employer, period]) => [period, employer]));
  const projects = projectSpan(facts);
  const isWorkProject = (at: number) => {
    const { category, statement } = facts[at];
    return (category === 'responsibility' || category === 'other') && PROJECT_HEADING.test(statement.trim()) && !PERSONAL_PROJECT.test(statement);
  };

  const employerOf = (at: number): number | null => {
    const found = employers.filter(start => start <= at).at(-1);
    if (found === undefined) return null;
    for (let between = found + 1; between < at; between++) if (SPAN_BREAK.has(facts[between].category)) return null;
    return found;
  };
  const place = (at: number): Omit<FactGroup, 'indexes'> => {
    const { category, statement } = facts[at];
    const annotation = review[at];
    if (annotation?.group) return { key: `career:${annotation.group.id}`, kind: 'employer', title: annotation.group.title };
    const owner = periodOwner.get(at);
    const section = annotation?.section ?? sections[at];
    if (section && section !== 'career') return reviewSection(section);
    if (owner !== undefined) return employerGroup(owner);
    const categorySection = SECTION_BY_CATEGORY[category];
    if (categorySection) return reviewSection(categorySection);
    if (category === 'achievement' && AWARD.test(statement)) return reviewSection('awards');
    if (projects && category !== 'employer' && at >= projects.start && at < projects.end) {
      const head = projects.heads.filter(start => start <= at).at(-1)!;
      return { key: `project:${head}`, kind: 'project', title: facts[head].statement };
    }
    const employer = employerOf(at);
    if (employer !== null) return employerGroup(employer);
    if (section === 'career' || category === 'period' || category === 'responsibility' || category === 'achievement') return reviewSection('career');
    if (employers.length > 0 && at < employers[0]) return reviewSection('intro');
    return reviewSection('other');
  };
  const employerGroup = (at: number): Omit<FactGroup, 'indexes'> => {
    const period = periods.get(at);
    return { key: `employer:${at}`, kind: 'employer', title: period === undefined ? facts[at].statement : `${facts[at].statement} · ${facts[period].statement}` };
  };

  const groups = new Map<string, FactGroup>();
  facts.forEach((_, at) => {
    const placed = place(at);
    const group = groups.get(placed.key) ?? { ...placed, indexes: [] };
    groups.set(placed.key, { ...group, indexes: [...group.indexes, at] });
  });
  const metaRank = (at: number) => {
    const rank = META_ORDER.indexOf(facts[at].category);
    return rank === -1 ? META_ORDER.length : rank;
  };
  const ordered = [...groups.values()]
    .map(group => group.kind === 'employer' ? { ...group, indexes: [...group.indexes].sort((a, b) => metaRank(a) - metaRank(b) || a - b) } : group)
    .sort((a, b) => Math.min(...a.indexes) - Math.min(...b.indexes));
  const careers = ordered.filter(group => group.kind === 'employer').map(group => {
    const children = new Map<string, FactGroup>();
    let fallbackProject: { id: string; title: string } | undefined;
    for (const index of [...group.indexes].sort((a, b) => a - b)) {
      // 기존 추출 결과에는 소속 정보가 없으므로, 원문에 프로젝트 제목이 표시된 경우만 묶는다.
      if (!group.key.startsWith('career:') && isWorkProject(index)) {
        fallbackProject = { id: String(index), title: facts[index].statement };
      }
      const project = review[index]?.project ?? (META_ORDER.includes(facts[index].category) ? undefined : fallbackProject);
      if (!project) continue;
      const key = `${group.key}:project:${project.id}`;
      const child = children.get(key) ?? { key, kind: 'project', title: project.title, indexes: [] };
      child.indexes.push(index);
      children.set(key, child);
    }
    return { ...group, children: [...children.values()] };
  });
  const personalProjects = ordered.filter(group => group.kind === 'project');
  return REVIEW_SECTIONS.flatMap(section => {
    const heading = reviewSection(section);
    const children = section === 'career' ? careers : section === 'other' ? personalProjects : [];
    const indexes = [...(groups.get(heading.key)?.indexes ?? []), ...children.flatMap(group => group.indexes)];
    return indexes.length ? [{ ...heading, indexes, children }] : [];
  });
}
