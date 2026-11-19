import { containsPersonalInfo } from './privacy.ts';
import type { FactLike, QueryPlan } from './types.ts';

// 확정 경력의 역할·기술 사실에서 검색 질의를 만든다. 모델 없이 사실 문장을 그대로 사용하고,
// 모든 질의는 근거 사실 ID를 함께 가진다. 연락처·주소 등 개인정보가 섞인 사실은 질의에서 뺀다.

export const MAX_QUERIES = 10;
const MAX_TERM_LENGTH = 40;
const SKILLS_PER_QUERY = 3;

// 검색 범위를 넓히기만 하는 일반 단어. 매칭 점수에서도 제외한다.
export const GENERIC_TERMS = new Set(['개발자', '엔지니어', '채용', '담당', '업무', '경력', 'developer', 'engineer', 'and', 'the']);

export type QueryBuild = { ok: true; queries: QueryPlan[]; excluded_fact_ids: string[] } | { ok: false; code: 'NO_SEARCHABLE_FACTS'; message: string };

function usable(fact: FactLike): boolean {
  const text = fact.statement.trim();
  return text.length > 0 && text.length <= MAX_TERM_LENGTH && !containsPersonalInfo(text);
}

function dedupe(facts: FactLike[]): FactLike[] {
  const seen = new Set<string>();
  return facts.filter(fact => {
    const key = fact.statement.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function plan(terms: FactLike[]): QueryPlan {
  return { query: terms.map(fact => fact.statement.trim().replace(/\s+/g, ' ')).join(' '), fact_ids: [...new Set(terms.map(fact => fact.id))] };
}

export function buildQueryPlans(facts: FactLike[]): QueryBuild {
  const candidates = facts.filter(fact => fact.category === 'role' || fact.category === 'skill');
  const excluded = candidates.filter(fact => !usable(fact)).map(fact => fact.id);
  const roles = dedupe(candidates.filter(fact => fact.category === 'role' && usable(fact)));
  const skills = dedupe(candidates.filter(fact => fact.category === 'skill' && usable(fact)));
  if (roles.length === 0 && skills.length === 0) {
    return { ok: false, code: 'NO_SEARCHABLE_FACTS', message: '확정 경력에 직무(role)나 기술(skill) 항목이 없어 검색 계획을 만들 수 없습니다. 경력 확인 화면에서 직무나 기술 줄을 추가하세요.' };
  }
  const queries: QueryPlan[] = [];
  const groups: FactLike[][] = [];
  for (let start = 0; start < skills.length; start += SKILLS_PER_QUERY) groups.push(skills.slice(start, start + SKILLS_PER_QUERY));
  const primaryRole = roles[0];
  if (groups.length === 0) groups.push([]);
  for (const group of groups) queries.push(plan(primaryRole ? [primaryRole, ...group] : group));
  // 두 번째 이후 직무는 핵심 기술과 묶어 별도 질의로 만든다.
  for (const role of roles.slice(1)) queries.push(plan([role, ...skills.slice(0, SKILLS_PER_QUERY)]));
  return { ok: true, queries: queries.filter(item => item.query.length > 0).slice(0, MAX_QUERIES), excluded_fact_ids: excluded };
}

// 질의 문자열을 매칭용 단어로 나눈다. provider와 화면 설명이 같은 규칙을 쓴다.
export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[\s,·/|()]+/).map(term => term.trim()).filter(term => term.length >= 2 && !GENERIC_TERMS.has(term)))];
}
