import { GENERIC_TERMS, queryTerms } from './intent.ts';
import { evaluateConditions } from './job-attributes.ts';
import type { ConditionResult } from './job-attributes.ts';
import type { Condition, FactLike, JobRequirement, QueryPlan } from './types.ts';

// 저장된 공고·확정 경력·검색 조건(모두 불변 기록)에서 추천 이유와 확인할 조건을 계산한다.
// 적합도 점수를 합격 가능성으로 표현하지 않으며, 근거를 찾지 못한 요구는 '경험 없음'으로 단정하지 않는다.

export type MatchReason = { requirement_id: string; requirement: string; fact_ids: string[]; facts: string[] };
export type MatchCheck =
  | { kind: 'condition'; state: 'unmet' | 'unknown'; field: Condition['field']; importance: Condition['importance']; detail: string }
  | { kind: 'requirement'; state: 'no_evidence'; requirement_id: string; detail: string };
// matched_terms: 검색 계획의 단어 중 공고 원문에 나타난 것. 요구 사항과 연결된 이유가 없을 때 검색 근거로 보여준다.
export type MatchExplanation = { reasons: MatchReason[]; checks: MatchCheck[]; conditions: ConditionResult[]; matched_terms: string[] };

type JobLike = { title: string; content_text: string; requirements: JobRequirement[] };

const ASCII_TERM = /^[a-z0-9.+#-]+$/;

// ASCII 기술명은 단어 경계로, 한글 단어는 부분 문자열로 찾는다(예: 'go'가 'google'에 걸리지 않게).
export function containsTerm(text: string, term: string): boolean {
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  if (!ASCII_TERM.test(needle)) return haystack.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(haystack);
}

// 요구 문장에서 의미가 약한 단어를 뺀 핵심 단어. 한국어 조사는 끝에서 떼어낸다.
const WEAK_TERMS = new Set(['경험', '사용', '개발', '기반', '서비스', '능력', '이해', '보유', '관련', '업무', '등', '또는', '이상', '가능', '우대', '필수']);
const PARTICLE = /(으로|와|과|및|을|를|이|가|은|는|의|로|에서|에)$/;

export function requirementTerms(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[\s,·/|()]+/)
    .map(term => term.replace(PARTICLE, ''))
    .filter(term => term.length >= 2 && !WEAK_TERMS.has(term) && !GENERIC_TERMS.has(term)))];
}

// 담당 업무·성과 등 문장형 사실은 요구의 핵심 단어가 2개 이상이고 모두 문장에 있을 때만 연결한다.
function sentenceSupports(fact: FactLike, requirement: string): boolean {
  if (fact.category === 'skill' || fact.category === 'role' || fact.category === 'period' || fact.category === 'employer') return false;
  const terms = requirementTerms(requirement);
  return terms.length >= 2 && terms.every(term => containsTerm(fact.statement, term));
}

function factTerms(fact: FactLike): string[] {
  if (fact.category === 'skill') return [fact.statement.trim()].filter(term => term.length >= 1);
  if (fact.category === 'role') return queryTerms(fact.statement).filter(term => !GENERIC_TERMS.has(term));
  return [];
}

export function explainMatch(facts: FactLike[], conditions: Condition[], job: JobLike, queries: QueryPlan[] = []): MatchExplanation {
  const linkable = facts.filter(fact => fact.category === 'skill' || fact.category === 'role');
  const sentences = facts.filter(fact => !linkable.includes(fact));
  const reasons: MatchReason[] = [];
  const checks: MatchCheck[] = [];
  for (const requirement of job.requirements) {
    const linked = [
      ...linkable.filter(fact => factTerms(fact).some(term => containsTerm(requirement.text, term))),
      ...sentences.filter(fact => sentenceSupports(fact, requirement.text)),
    ];
    if (linked.length > 0) {
      reasons.push({ requirement_id: requirement.id, requirement: requirement.text, fact_ids: linked.map(fact => fact.id), facts: linked.map(fact => fact.statement) });
    } else if (requirement.importance === 'required') {
      checks.push({ kind: 'requirement', state: 'no_evidence', requirement_id: requirement.id, detail: `'${requirement.text}' — 확정 경력에서 근거를 찾지 못했습니다(경험 없음으로 단정하지 않음).` });
    }
  }
  const results = evaluateConditions(conditions, job.content_text, job.title);
  // 미충족을 정보 없음보다 먼저 보여준다.
  const conditionChecks: MatchCheck[] = results
    .filter(result => result.state !== 'met')
    .sort((a, b) => (a.state === 'unmet' ? 0 : 1) - (b.state === 'unmet' ? 0 : 1))
    .map(result => ({ kind: 'condition', state: result.state as 'unmet' | 'unknown', field: result.condition.field, importance: result.condition.importance, detail: result.detail }));
  const text = `${job.title}\n${job.content_text}`;
  const matched = [...new Set(queries.flatMap(item => queryTerms(item.query)))].filter(term => containsTerm(text, term));
  return { reasons, checks: [...conditionChecks, ...checks], conditions: results, matched_terms: matched };
}

// 필수 조건이 공고 원문에서 명확히 어긋나면 검색 결과에서 뺀다. 정보 없음은 남겨 확인하게 한다.
export function violatesRequiredCondition(conditions: Condition[], job: JobLike): boolean {
  return evaluateConditions(conditions, job.content_text, job.title).some(result => result.state === 'unmet' && result.condition.importance === 'required');
}
