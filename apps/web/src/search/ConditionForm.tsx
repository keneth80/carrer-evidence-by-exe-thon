import { CONDITION_LIMITS } from '../../../../packages/search/src/conditions.ts';
import type { Condition } from '../../../../packages/search/src/types.ts';

// 희망 조건 입력. 경력 사실과 별도로 SearchIntent.conditions가 된다. 비워 두면 조건 없이 검색한다.

type Importance = Condition['importance'];
export type ConditionDraft = {
  roles: string; rolesImportance: Importance;
  locations: string; locationsImportance: Importance;
  workModes: string[]; workModesImportance: Importance;
  employment: string[]; employmentImportance: Importance;
  salaryManwon: string; salaryImportance: Importance;
};

export const emptyDraft: ConditionDraft = {
  roles: '', rolesImportance: 'preferred', locations: '', locationsImportance: 'preferred',
  workModes: [], workModesImportance: 'preferred', employment: [], employmentImportance: 'preferred',
  salaryManwon: '', salaryImportance: 'preferred',
};

const WORK_MODE_OPTIONS = [['remote', '원격'], ['hybrid', '하이브리드'], ['onsite', '사무실 출근']] as const;
const EMPLOYMENT_OPTIONS = [['full_time', '정규직'], ['contract', '계약직'], ['intern', '인턴']] as const;

const splitList = (text: string) => text.split(/[,，]/).map(item => item.trim()).filter(Boolean);
const anyOf = (field: Condition['field'], values: string[], importance: Importance): Condition[] =>
  values.length ? [{ field, operator: 'any_of', values, importance, currency: null }] : [];

export type DraftResult = { ok: true; conditions: Condition[] } | { ok: false; message: string };

export function toConditions(draft: ConditionDraft): DraftResult {
  const salary = draft.salaryManwon.trim();
  const maxManwon = CONDITION_LIMITS.maxSalary / 10_000;
  if (salary && (!/^\d{1,7}$/.test(salary) || Number(salary) > maxManwon)) return { ok: false, message: `최소 연봉은 0~${maxManwon.toLocaleString('ko-KR')} 사이의 만 원 단위 숫자로 입력하세요.` };
  return {
    ok: true,
    conditions: [
      ...anyOf('role', splitList(draft.roles), draft.rolesImportance),
      ...anyOf('location', splitList(draft.locations), draft.locationsImportance),
      ...anyOf('work_mode', draft.workModes, draft.workModesImportance),
      ...anyOf('employment_type', draft.employment, draft.employmentImportance),
      ...(salary ? [{ field: 'annual_salary' as const, operator: 'gte' as const, values: [Number(salary) * 10_000], importance: draft.salaryImportance, currency: 'KRW' }] : []),
    ],
  };
}

function ImportanceSelect({ value, onChange, label }: { value: Importance; onChange: (next: Importance) => void; label: string }) {
  return <select aria-label={`${label} 중요도`} value={value} onChange={event => onChange(event.target.value as Importance)}>
    <option value="preferred">선호</option><option value="required">필수</option>
  </select>;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
}

export function ConditionForm({ draft, onChange, disabled }: { draft: ConditionDraft; onChange: (next: ConditionDraft) => void; disabled: boolean }) {
  const set = <K extends keyof ConditionDraft>(key: K, value: ConditionDraft[K]) => onChange({ ...draft, [key]: value });
  return <fieldset className="condition-form" disabled={disabled}>
    <legend>희망 조건 <span className="muted">(선택 · 경력 사실과 따로 저장)</span></legend>
    <div className="condition-row">
      <label htmlFor="cond-roles">희망 직무</label>
      <input id="cond-roles" placeholder="예: 프론트엔드, 웹 개발" value={draft.roles} onChange={event => set('roles', event.target.value)} maxLength={200} />
      <ImportanceSelect label="희망 직무" value={draft.rolesImportance} onChange={value => set('rolesImportance', value)} />
    </div>
    <div className="condition-row">
      <label htmlFor="cond-locations">근무 지역</label>
      <input id="cond-locations" placeholder="예: 서울, 판교" value={draft.locations} onChange={event => set('locations', event.target.value)} maxLength={200} />
      <ImportanceSelect label="근무 지역" value={draft.locationsImportance} onChange={value => set('locationsImportance', value)} />
    </div>
    <div className="condition-row">
      <span className="condition-label">근무 방식</span>
      <div className="choice-group">{WORK_MODE_OPTIONS.map(([value, label]) => <label key={value} className="check">
        <input type="checkbox" checked={draft.workModes.includes(value)} onChange={() => set('workModes', toggle(draft.workModes, value))} />{label}
      </label>)}</div>
      <ImportanceSelect label="근무 방식" value={draft.workModesImportance} onChange={value => set('workModesImportance', value)} />
    </div>
    <div className="condition-row">
      <span className="condition-label">고용 형태</span>
      <div className="choice-group">{EMPLOYMENT_OPTIONS.map(([value, label]) => <label key={value} className="check">
        <input type="checkbox" checked={draft.employment.includes(value)} onChange={() => set('employment', toggle(draft.employment, value))} />{label}
      </label>)}</div>
      <ImportanceSelect label="고용 형태" value={draft.employmentImportance} onChange={value => set('employmentImportance', value)} />
    </div>
    <div className="condition-row">
      <label htmlFor="cond-salary">최소 연봉(만 원)</label>
      <input id="cond-salary" inputMode="numeric" placeholder="예: 6000" value={draft.salaryManwon} onChange={event => set('salaryManwon', event.target.value)} maxLength={7} />
      <ImportanceSelect label="최소 연봉" value={draft.salaryImportance} onChange={value => set('salaryImportance', value)} />
    </div>
    <p className="muted">필수 조건은 공고 원문에서 명확히 어긋나면 결과에서 뺍니다. 공고에 정보가 없으면 빼지 않고 ‘확인할 조건’으로 보여줍니다.</p>
  </fieldset>;
}
