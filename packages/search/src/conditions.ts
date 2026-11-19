import { containsPersonalInfo } from './privacy.ts';
import { CONDITION_FIELDS, EMPLOYMENT_TYPES, WORK_MODES } from './types.ts';
import type { Condition, ConditionField } from './types.ts';

// SearchIntentCreate.conditions 검증과 정규화. 희망 조건은 경력 사실과 별도의 입력이다(SERVICE_RULES).

export const CONDITION_LIMITS = { maxConditions: 12, maxValues: 10, maxValueLength: 60, maxSalary: 10_000_000_000 } as const;

export type ConditionCheck = { ok: true; conditions: Condition[] } | { ok: false; code: string; message: string; index?: number };

const KEYS = 'currency,field,importance,operator,values';
const ENUM_VALUES: Partial<Record<ConditionField, readonly string[]>> = { work_mode: WORK_MODES, employment_type: EMPLOYMENT_TYPES };

const fail = (code: string, message: string, index?: number): ConditionCheck => ({ ok: false, code, message, index });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkSalary(item: Record<string, unknown>, index: number): Condition | ConditionCheck {
  const values = item.values as unknown[];
  if (item.operator !== 'gte' || values.length !== 1 || !Number.isInteger(values[0]) || (values[0] as number) < 0 || (values[0] as number) > CONDITION_LIMITS.maxSalary) {
    return fail('CONDITION_INVALID', '연봉 조건은 gte 연산자와 0 이상의 정수 값 하나가 필요합니다.', index);
  }
  if (typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency)) return fail('CONDITION_INVALID', '연봉 조건에는 통화 코드(예: KRW)가 필요합니다.', index);
  return { field: 'annual_salary', operator: 'gte', values: [values[0] as number], importance: item.importance as Condition['importance'], currency: item.currency };
}

function checkTextValues(item: Record<string, unknown>, field: ConditionField, index: number): Condition | ConditionCheck {
  if (item.operator !== 'any_of' || item.currency !== null) return fail('CONDITION_INVALID', `${field} 조건은 any_of 연산자와 currency=null이 필요합니다.`, index);
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of item.values as unknown[]) {
    if (typeof raw !== 'string') return fail('CONDITION_INVALID', '조건 값은 문자열이어야 합니다.', index);
    const value = raw.trim().replace(/\s+/g, ' ');
    if (value.length < 1 || value.length > CONDITION_LIMITS.maxValueLength) return fail('CONDITION_INVALID', `조건 값은 1~${CONDITION_LIMITS.maxValueLength}자입니다.`, index);
    if (containsPersonalInfo(value)) return fail('CONDITION_CONTAINS_PERSONAL_INFO', '조건에 연락처 등 개인정보를 넣을 수 없습니다.', index);
    const allowed = ENUM_VALUES[field];
    if (allowed && !allowed.includes(value)) return fail('CONDITION_INVALID', `${field} 값은 ${allowed.join(', ')} 중 하나입니다.`, index);
    if (!seen.has(value.toLowerCase())) { seen.add(value.toLowerCase()); values.push(value); }
  }
  return { field, operator: 'any_of', values, importance: item.importance as Condition['importance'], currency: null };
}

export function validateConditions(value: unknown): ConditionCheck {
  if (!Array.isArray(value)) return fail('CONDITION_INVALID', 'conditions는 배열이어야 합니다.');
  if (value.length > CONDITION_LIMITS.maxConditions) return fail('CONDITION_INVALID', `조건은 최대 ${CONDITION_LIMITS.maxConditions}개입니다.`);
  const out: Condition[] = [];
  const fields = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    if (!isRecord(item) || Object.keys(item).sort().join() !== KEYS) return fail('CONDITION_INVALID', `조건 항목에는 ${KEYS}가 필요합니다.`, index);
    const field = item.field as ConditionField;
    if (!CONDITION_FIELDS.includes(field)) return fail('CONDITION_INVALID', '알 수 없는 조건 종류입니다.', index);
    if (item.importance !== 'required' && item.importance !== 'preferred') return fail('CONDITION_INVALID', 'importance는 required 또는 preferred입니다.', index);
    if (!Array.isArray(item.values) || item.values.length < 1 || item.values.length > CONDITION_LIMITS.maxValues) return fail('CONDITION_INVALID', `조건 값은 1~${CONDITION_LIMITS.maxValues}개입니다.`, index);
    // 같은 종류 조건이 둘이면 어느 쪽을 적용할지 모호하므로 하나로 합쳐 보내게 한다.
    if (fields.has(field)) return fail('CONDITION_DUPLICATE_FIELD', '같은 종류의 조건이 두 번 있습니다.', index);
    fields.add(field);
    const checked = field === 'annual_salary' ? checkSalary(item, index) : checkTextValues(item, field, index);
    if ('ok' in checked) return checked;
    out.push(checked);
  }
  return { ok: true, conditions: out };
}
