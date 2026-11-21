import { employerPeriods, KEY_RESULTS_SECTION, projectSpan } from './layout.ts';
import type { FactLike } from './types.ts';

// 추출 확인 화면의 묶음(사용자 테스트 2026-11-21, DECISIONS S1-30).
// "회사명 따로, 직무 따로, 근무지역 따로 체크박스로 나와 보기 힘들다" → 회사·프로젝트·학력 등으로 묶어 보여 주고 묶음 단위로 고른다.
// 맞춤 이력서·Word와 같은 규칙(layout.ts)을 쓴다. 표시만 바꾸며 항목 내용·순서·저장 형식은 그대로다.

export type FactGroupKind = 'basic' | 'results' | 'employer' | 'project' | 'section' | 'etc';
// indexes: 이 묶음에 든 항목의 위치(facts 배열 기준). 묶음 안에서는 회사·직무·기간·지역이 먼저 온다.
export type FactGroup = { key: string; kind: FactGroupKind; title: string; indexes: number[] };

const SECTION_TITLE: Record<string, string> = { skill: '기술', education: '학력', certification: '자격' };
const SPAN_BREAK = new Set(['education', 'certification']);
const META_ORDER = ['employer', 'role', 'period', 'location'];

// sections: 항목마다 원문에서 바로 앞에 있던 구역 제목(없으면 null). 회사·프로젝트·기술·학력에 속하지 않는 항목을 한 묶음에 몰지 않고 제목별로 나눈다(S1-33).
export function factGroups(facts: FactLike[], sections: (string | null)[] = []): FactGroup[] {
  const employers = facts.flatMap((fact, at) => fact.category === 'employer' ? [at] : []);
  const periods = employerPeriods(facts);
  const periodOwner = new Map([...periods].map(([employer, period]) => [period, employer]));
  const projects = projectSpan(facts);

  const employerOf = (at: number): number | null => {
    const found = employers.filter(start => start <= at).at(-1);
    if (found === undefined) return null;
    for (let between = found + 1; between < at; between++) if (SPAN_BREAK.has(facts[between].category)) return null;
    return found;
  };
  const place = (at: number): Omit<FactGroup, 'indexes'> => {
    const category = facts[at].category;
    const owner = periodOwner.get(at);
    if (owner !== undefined) return employerGroup(owner);
    if (SECTION_TITLE[category]) return { key: `section:${category}`, kind: 'section', title: SECTION_TITLE[category] };
    // 마지막 회사·프로젝트 뒤에 오는 '일하는 방식' 같은 글이 그 회사 묶음에 딸려 들어가지 않게 한다:
    // 분류가 기타이고 원문에서 다른 구역 제목 아래에 있던 항목은 회사·프로젝트 묶음에서 떼어 제목별 묶음으로 보낸다.
    const detached = (anchor: number) => category === 'other' && !!sections[at] && sections[at] !== sections[anchor];
    if (projects && category !== 'employer' && at >= projects.start && at < projects.end) {
      const head = projects.heads.filter(start => start <= at).at(-1)!;
      if (!detached(head)) return { key: `project:${head}`, kind: 'project', title: facts[head].statement };
    }
    const employer = employerOf(at);
    if (employer !== null && !detached(employer)) return employerGroup(employer);
    if (sections[at]) return { key: `titled:${sections[at]}`, kind: 'section', title: sections[at]! };
    if (employers.length > 0 && at < employers[0]) {
      return category === 'achievement' ? { key: 'results', kind: 'results', title: KEY_RESULTS_SECTION } : { key: 'basic', kind: 'basic', title: '기본 정보·소개' };
    }
    return { key: 'etc', kind: 'etc', title: '기타' };
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
  return [...groups.values()]
    .map(group => group.kind === 'employer' ? { ...group, indexes: [...group.indexes].sort((a, b) => metaRank(a) - metaRank(b) || a - b) } : group)
    .sort((a, b) => Math.min(...a.indexes) - Math.min(...b.indexes));
}
