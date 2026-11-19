// contracts/v0.7/schemas/domain.schema.json의 Condition·QueryPlan·JobRequirement와 같은 모양이다.
// 이 패키지는 node 전용 모듈을 쓰지 않는다. 웹 화면도 같은 판정 함수를 사용한다.

export const CONDITION_FIELDS = ['role', 'seniority', 'location', 'work_mode', 'employment_type', 'annual_salary'] as const;
export type ConditionField = typeof CONDITION_FIELDS[number];

export type Condition = {
  field: ConditionField;
  operator: 'any_of' | 'gte';
  values: (string | number)[];
  importance: 'required' | 'preferred';
  currency: string | null;
};

export type QueryPlan = { query: string; fact_ids: string[] };

export type JobRequirement = { id: string; text: string; importance: 'required' | 'preferred' | 'unknown'; source_quote: string };

// provider가 돌려주는 공고. 저장 시 id·workspace·hash·관측 시각을 붙여 JobSnapshot이 된다.
export type JobDraft = {
  job_key: string;
  company_name: string;
  title: string;
  canonical_url: string;
  site_id: string;
  content_text: string;
  requirements: JobRequirement[];
  open_status: 'open' | 'closed' | 'unknown';
  data_origin: 'live' | 'synthetic';
};

// 검색 계획과 설명에 쓰는 확정 사실의 최소 모양(ResumeFact의 부분).
export type FactLike = { id: string; category: string; statement: string };

export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'contract', 'intern'] as const;
