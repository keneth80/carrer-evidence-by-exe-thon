import type { Condition } from './types.ts';

// 공고 원문(content_text)의 '항목: 값' 줄에서 근무 조건을 읽는다. 줄이 없으면 null(정보 없음)이며,
// 정보 없음은 조건 미충족과 다르게 표시한다(CLAUDE.md: 미기재·미확인은 조건 미충족과 구분).

export type SalaryRange = { min: number | null; max: number | null; currency: 'KRW' };
export type JobAttributes = {
  location: string | null;
  work_mode: 'remote' | 'hybrid' | 'onsite' | null;
  employment_type: 'full_time' | 'contract' | 'intern' | null;
  salary: SalaryRange | null;
  seniority: string | null;
};

export type ConditionState = 'met' | 'unmet' | 'unknown';
export type ConditionResult = { condition: Condition; state: ConditionState; detail: string };

function labeled(text: string, label: RegExp): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match = new RegExp(`^\\s*(?:${label.source})\\s*[:：]\\s*(.+)$`).exec(line);
    if (match) return match[1].trim();
  }
  return null;
}

function workMode(value: string | null): JobAttributes['work_mode'] {
  if (!value) return null;
  // '재택 불가'·'remote 불가'처럼 부정된 원격 표현을 원격으로 읽지 않는다.
  if (/(원격|재택|remote)\s*(근무\s*)?(불가|불가능|없음|안\s*됨|x(?![a-z]))/i.test(value)) return 'onsite';
  if (/하이브리드|혼합|hybrid/i.test(value)) return 'hybrid';
  if (/사무실|출근|상주|onsite|on-site/i.test(value)) return 'onsite';
  if (/원격|재택|remote/i.test(value)) return 'remote';
  return null;
}

function employment(value: string | null): JobAttributes['employment_type'] {
  if (!value) return null;
  if (/인턴|intern/i.test(value)) return 'intern';
  if (/계약|contract/i.test(value)) return 'contract';
  if (/정규|full[\s-]?time/i.test(value)) return 'full_time';
  return null;
}

// '6000만 원 이상', '4000만~5500만 원', '5000만 원 ~ 1억 원', '1억 2000만 원' 형식을 읽는다.
// 단위가 빠진 숫자가 섞이거나('3500~4500만 원') 범위인데 금액이 하나뿐이면 정보 없음(null)으로 둔다.
const AMOUNT = /(\d[\d,]*)\s*억(?:\s*(\d[\d,]*)\s*만)?|(\d[\d,]*)\s*만/g;
const num = (text: string | undefined) => Number((text ?? '0').replaceAll(',', ''));

function salary(value: string | null): SalaryRange | null {
  if (!value) return null;
  const matches = [...value.matchAll(AMOUNT)];
  if (matches.length === 0) return null;
  const amounts = matches.map(match => match[3] !== undefined ? num(match[3]) * 10_000 : num(match[1]) * 100_000_000 + num(match[2]) * 10_000);
  const usedNumbers = matches.reduce((count, match) => count + (match[3] !== undefined ? 1 : match[2] !== undefined ? 2 : 1), 0);
  const allNumbers = value.match(/\d[\d,]*/g)?.length ?? 0;
  if (usedNumbers !== allNumbers || amounts.length > 2) return null;
  const ranged = /[~\-–—]/.test(value);
  if (amounts.length === 2) return { min: Math.min(amounts[0], amounts[1]), max: Math.max(amounts[0], amounts[1]), currency: 'KRW' };
  if (ranged) return null;
  if (/이상|부터|최소/.test(value)) return { min: amounts[0], max: null, currency: 'KRW' };
  if (/이하|까지|최대/.test(value)) return { min: null, max: amounts[0], currency: 'KRW' };
  return { min: amounts[0], max: amounts[0], currency: 'KRW' };
}

export function parseJobAttributes(contentText: string): JobAttributes {
  return {
    location: labeled(contentText, /근무지|근무\s*지역|지역|location/),
    work_mode: workMode(labeled(contentText, /근무\s*방식|근무\s*형태|work\s*mode/)),
    employment_type: employment(labeled(contentText, /고용\s*형태|채용\s*형태|employment/)),
    salary: salary(labeled(contentText, /연봉|급여|salary/)),
    seniority: labeled(contentText, /경력\s*조건|경력\s*수준|경력|seniority/),
  };
}

const norm = (value: string) => value.toLowerCase().replace(/\s+/g, '');

const LABELS: Record<string, string> = {
  remote: '원격', hybrid: '하이브리드', onsite: '사무실 출근', full_time: '정규직', contract: '계약직', intern: '인턴',
};
export const valueLabel = (value: string | number) => typeof value === 'number' ? `${Math.round(value / 10_000).toLocaleString('ko-KR')}만 원` : LABELS[value] ?? value;

function anyOf(condition: Condition, actual: string | null, missing: string, name: string): ConditionResult {
  if (actual === null) return { condition, state: 'unknown', detail: missing };
  const wanted = condition.values.map(String);
  const hit = wanted.some(value => norm(actual).includes(norm(value)) || norm(value).includes(norm(actual)));
  return hit
    ? { condition, state: 'met', detail: `${name} ${valueLabel(actual)}` }
    : { condition, state: 'unmet', detail: `${name} ${valueLabel(actual)} — 희망 ${wanted.map(valueLabel).join('·')}과 다름` };
}

function salaryResult(condition: Condition, range: SalaryRange | null): ConditionResult {
  const wanted = Number(condition.values[0]);
  if (!range) return { condition, state: 'unknown', detail: '공고에 연봉 정보 없음' };
  if (condition.currency !== range.currency) return { condition, state: 'unknown', detail: '공고 연봉의 통화가 달라 비교하지 않음' };
  const shown = range.min !== null && range.max !== null && range.min !== range.max ? `${valueLabel(range.min)}~${valueLabel(range.max)}`
    : range.min !== null ? `${valueLabel(range.min)}${range.max === null ? ' 이상' : ''}` : `${valueLabel(range.max ?? 0)} 이하`;
  if (range.max !== null && range.max < wanted) return { condition, state: 'unmet', detail: `연봉 ${shown} — 희망 ${valueLabel(wanted)} 이상보다 낮음` };
  if (range.min !== null && range.min >= wanted) return { condition, state: 'met', detail: `연봉 ${shown}` };
  return { condition, state: 'unknown', detail: `연봉 ${shown} — 희망 금액 충족 여부는 협의 필요` };
}

export function evaluateCondition(condition: Condition, attributes: JobAttributes, title: string): ConditionResult {
  switch (condition.field) {
    case 'location':
      // 원격 근무 공고는 근무지 조건과 무관하게 지원 가능한 것으로 본다.
      if (attributes.work_mode === 'remote') return { condition, state: 'met', detail: '원격 근무 공고' };
      return anyOf(condition, attributes.location, '공고에 근무지 정보 없음', '근무지');
    case 'work_mode':
      return anyOf(condition, attributes.work_mode, '공고에 근무 방식 정보 없음', '근무 방식');
    case 'employment_type':
      return anyOf(condition, attributes.employment_type, '공고에 고용 형태 정보 없음', '고용 형태');
    case 'annual_salary':
      return salaryResult(condition, attributes.salary);
    case 'role': {
      // 직무명이 달라도 같은 일을 할 수 있으므로 미충족으로 단정하지 않는다.
      const hit = condition.values.some(value => norm(title).includes(norm(String(value))));
      return hit ? { condition, state: 'met', detail: `직무명 '${title}'` } : { condition, state: 'unknown', detail: `직무명 '${title}'에서 희망 직무 확인 안 됨` };
    }
    case 'seniority': {
      if (attributes.seniority === null) return { condition, state: 'unknown', detail: '공고에 경력 조건 정보 없음' };
      const hit = condition.values.some(value => norm(attributes.seniority ?? '').includes(norm(String(value))));
      return hit ? { condition, state: 'met', detail: `경력 조건 ${attributes.seniority}` } : { condition, state: 'unknown', detail: `경력 조건 '${attributes.seniority}' — 직접 확인 필요` };
    }
  }
}

export function evaluateConditions(conditions: Condition[], contentText: string, title: string): ConditionResult[] {
  const attributes = parseJobAttributes(contentText);
  return conditions.map(condition => evaluateCondition(condition, attributes, title));
}
