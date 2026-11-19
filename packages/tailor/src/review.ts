import { findSlop } from './slop.ts';
import { patternsFor } from './patterns.ts';
import type { RolePatterns } from './patterns.ts';
import type { FactLike } from './types.ts';

// 1차 점검(규칙): 확정 경력을 검색 전에 훑어 보완하면 좋은 점을 알려 준다(DECISIONS S1-13).
// - 사실을 고치거나 새 사실을 만들지 않는다. 확정 문장은 원문 범위 안이어야 하므로(S1-10) 안내와 질문만 한다.
// - 결과가 없어도 실패가 아니다. '없음'과 '확인되지 않음'을 구분해 문장으로 보여준다.
// - 이 패키지는 node 전용 모듈을 쓰지 않는다(웹 화면에서 바로 계산한다).

export type ReviewSeverity = 'warn' | 'info';
export type ReviewKind = 'missing_role' | 'missing_period' | 'no_result' | 'broad_statement' | 'slop' | 'long_statement' | 'duplicate' | 'few_skills';
export type ReviewFinding = { kind: ReviewKind; severity: ReviewSeverity; fact_ids: string[]; title: string; detail: string; question: string | null };
export type ResumeReview = { patterns: RolePatterns; findings: ReviewFinding[]; checked: number };

const BROAD = /(업무|개발|운영|프로젝트)\s*전반|다양한\s*(업무|프로젝트)|여러\s*(업무|프로젝트)|각종\s*업무|기타\s*업무/;
const LONG_STATEMENT = 150;
const squash = (text: string) => text.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

export function reviewFacts(facts: FactLike[]): ResumeReview {
  const of = (category: string) => facts.filter(fact => fact.category === category);
  const roles = of('role');
  const patterns = patternsFor(roles.map(fact => fact.statement));
  const findings: ReviewFinding[] = [];

  if (roles.length === 0) {
    findings.push({ kind: 'missing_role', severity: 'warn', fact_ids: [], title: '직무가 확인되지 않았어요', detail: '직무(예: 프론트엔드 개발자)가 없으면 검색어를 만들기 어렵습니다.', question: '어떤 직무로 일했나요? 원본 이력서에 직무를 적고 다시 올리거나, 추출 확인 화면에서 직무 항목을 정정해 주세요.' });
  }
  const employers = of('employer');
  const periods = of('period');
  if (employers.length > periods.length) {
    findings.push({ kind: 'missing_period', severity: 'warn', fact_ids: employers.map(fact => fact.id), title: '근무 기간이 빠진 회사가 있어요', detail: `회사 ${employers.length}곳 중 기간이 확인된 항목은 ${periods.length}개입니다.`, question: '각 회사의 근무 기간(시작~종료 연월)을 원본에 적어 주세요.' });
  }
  if (of('achievement').length === 0) {
    findings.push({ kind: 'no_result', severity: 'info', fact_ids: [], title: '결과를 보여주는 문장이 없어요', detail: '한 일만으로도 충분하지만, 기록으로 확인할 수 있는 결과가 있으면 HR 전문가 보완 대화(확정 경력 화면)나 공고 맞춤 대화에서 알려 주세요. 확인 후에만 반영합니다.', question: '측정 기록이 있는 결과(예: 처리 시간, 오류 건수 변화)가 있나요?' });
  }
  for (const fact of facts.filter(item => item.category === 'responsibility' || item.category === 'achievement' || item.category === 'other')) {
    if (BROAD.test(fact.statement)) {
      findings.push({ kind: 'broad_statement', severity: 'info', fact_ids: [fact.id], title: '범위가 넓은 표현이에요', detail: `“${fact.statement}” — 어떤 기능·대상을 맡았는지 드러나면 공고와 연결하기 쉽습니다.`, question: '이 일에서 직접 맡은 기능이나 대상은 무엇이었나요?' });
    }
    if (Array.from(fact.statement).length > LONG_STATEMENT) {
      findings.push({ kind: 'long_statement', severity: 'info', fact_ids: [fact.id], title: '한 문장에 여러 일이 들어 있어요', detail: `${Array.from(fact.statement).length}자 문장입니다. 한 문장에 한 가지 일로 나누면 읽기 쉽습니다.`, question: null });
    }
  }
  for (const fact of facts) {
    const slop = findSlop(fact.statement);
    if (slop.length) {
      findings.push({ kind: 'slop', severity: 'info', fact_ids: [fact.id], title: '평가어·상투 표현이 있어요', detail: `“${slop.map(item => item.phrase).join('”, “')}” — ${slop[0].hint} 맞춤 이력서에서는 사실 문장 위주로 다듬습니다.`, question: null });
    }
  }
  // 같은 내용은 몇 번 나오든 안내 하나로 묶는다(세 번이면 같은 안내가 두 번 보이지 않게).
  const groups = new Map<string, { statement: string; ids: string[] }>();
  for (const fact of facts) {
    const key = `${fact.category}:${squash(fact.statement)}`;
    const group = groups.get(key);
    groups.set(key, group ? { ...group, ids: [...group.ids, fact.id] } : { statement: fact.statement, ids: [fact.id] });
  }
  for (const { statement, ids } of groups.values()) {
    if (ids.length > 1) findings.push({ kind: 'duplicate', severity: 'info', fact_ids: ids, title: '같은 내용이 여러 번 있어요', detail: `“${statement.trim()}” — ${ids.length}번`, question: null });
  }
  const skills = of('skill');
  if (skills.length < 3) {
    findings.push({ kind: 'few_skills', severity: 'info', fact_ids: skills.map(fact => fact.id), title: '확인된 기술이 적어요', detail: `기술 항목이 ${skills.length}개입니다. 실제로 쓴 기술이 더 있다면 원본에 적어 주세요. 검색은 확인된 기술만 씁니다.`, question: null });
  }
  const order: ReviewSeverity[] = ['warn', 'info'];
  return { patterns, findings: findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)), checked: facts.length };
}
