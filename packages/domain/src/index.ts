/** v0.4 계약의 실행 가능한 일부. 외부 입력은 HTTP 경계에서 JSON Schema로 검증한다. */
export type Decision = 'review' | 'needs_information' | 'hold';
export type Priority = 'required' | 'preferred';

type EvaluationBase = {
  readonly condition: string;
  readonly priority: Priority;
  readonly reason: string;
  readonly claim_ids: readonly string[];
  readonly experience_ids: readonly string[];
};

export type ConditionEvaluation = EvaluationBase & (
  | { readonly state: 'satisfied'; readonly reason_code: 'REQUIREMENT_MET' }
  | { readonly state: 'gap'; readonly reason_code: 'REQUIREMENT_GAP' }
  | { readonly state: 'unknown'; readonly reason_code: 'SOURCE_MISSING' | 'PROFILE_MISSING' }
  | { readonly state: 'conflict'; readonly reason_code: 'SOURCES_CONFLICT' }
);

export type EvidenceQuote = {
  readonly source_id: string;
  readonly quote: string;
  readonly link_check: 'matched_to_chunk';
};

export type Claim = {
  readonly id: string;
  readonly field: 'remote_policy' | 'required_experience' | 'technology' | 'hiring_status' | 'company_product';
  readonly evidence: readonly EvidenceQuote[];
} & (
  | { readonly state: 'known'; readonly value: string | number | boolean; readonly reason: null }
  | { readonly state: 'unknown'; readonly value: null; readonly reason: 'not_found_in_retrieved_material' | 'invalid_extraction' }
  | { readonly state: 'conflicting'; readonly value: null; readonly reason: 'sources_conflict' }
);

export type Source = {
  readonly id: string;
  readonly url: string;
  readonly title: string | null;
  readonly kind: 'official_job_page' | 'company_page' | 'search_snippet' | 'other_public' | 'fixture';
  readonly published_date: string | null;
  readonly retrieved_at: string;
  readonly retrieval_method: 'liner_search' | 'liner_agent' | 'fixture';
  readonly excerpt: string | null;
};

export type Candidate = {
  readonly id: string;
  readonly search_id: string;
  readonly slot: number;
  readonly job_key: string;
  readonly company_key: string;
  readonly company_name: string;
  readonly title: string;
  readonly source_url: string;
  readonly snippet: string | null;
  readonly hiring_status: 'unknown' | 'open' | 'closed';
  readonly collected_at: string;
  readonly provenance: 'live' | 'fixture';
};

export type FactBundle = {
  readonly id: string;
  readonly candidate_id: string;
  readonly task_id: string;
  readonly sources: readonly Source[];
  readonly claims: readonly Claim[];
  readonly quality: 'structured' | 'partial' | 'unstructured';
  readonly provenance: 'live' | 'fixture';
  readonly observed_at: string;
  readonly normalizer_version: string;
};

export type EvaluationResult = {
  readonly decision: Decision;
  readonly summary: string;
  readonly evaluations: readonly ConditionEvaluation[];
  readonly rule_version: 'match.v1';
};

/** 점수나 합격 확률을 만들지 않고 필수 조건의 차이·미확인 여부만 집계한다. */
export function evaluateConditions(evaluations: readonly ConditionEvaluation[]): EvaluationResult {
  const required = evaluations.filter((item) => item.priority === 'required');
  const decision: Decision = required.some((item) => item.state === 'gap')
    ? 'hold'
    : required.some((item) => item.state === 'unknown' || item.state === 'conflict')
      ? 'needs_information'
      : 'review';
  const summary: Record<Decision, string> = {
    hold: '명시된 필수 조건과 차이가 있습니다. 해당 근거와 조건을 확인하세요.',
    needs_information: '필수 조건에 미확인 또는 충돌하는 정보가 있습니다. 원문이나 담당자 확인이 필요합니다.',
    review: '평가된 필수 조건에서 차이를 찾지 못했습니다. 근거와 선호 조건을 검토하세요.',
  };
  return {
    decision,
    summary: summary[decision],
    rule_version: 'match.v1',
    evaluations: evaluations.map((item) => ({
      ...item,
      claim_ids: [...item.claim_ids],
      experience_ids: [...item.experience_ids],
    })),
  };
}

/** boolean으로 정규화된 원격 가능 여부만 비교한다. 임의 문장을 추측하지 않는다. */
export function evaluateRemoteAvailability(claim: Claim | undefined, priority: Priority): ConditionEvaluation {
  const base = {
    condition: '원격 근무',
    priority,
    claim_ids: claim ? [claim.id] : [],
    experience_ids: [],
  };
  if (claim?.field === 'remote_policy' && claim.state === 'conflicting') {
    return { ...base, state: 'conflict', reason_code: 'SOURCES_CONFLICT', reason: '원격 근무에 관한 자료가 서로 다릅니다.' };
  }
  if (claim?.field === 'remote_policy' && claim.state === 'known' && typeof claim.value === 'boolean') {
    return claim.value
      ? { ...base, state: 'satisfied', reason_code: 'REQUIREMENT_MET', reason: '수집한 자료에 원격 근무 가능 조건이 명시되어 있습니다.' }
      : { ...base, state: 'gap', reason_code: 'REQUIREMENT_GAP', reason: '수집한 자료에 사무실 출근 조건이 명시되어 있습니다.' };
  }
  return {
    ...base,
    state: 'unknown',
    reason_code: 'SOURCE_MISSING',
    reason: '원격 근무 가능 여부를 비교할 수 있는 정규화된 근거가 없습니다.',
  };
}

export function normalizeAnswerText(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export type AnswerValidation = {
  readonly ok: boolean;
  readonly value: string;
  readonly code_points: number;
  readonly error: 'ANSWER_BLANK' | 'ANSWER_TOO_LONG' | null;
};

/** 길이는 UTF-16 code units가 아닌 Unicode code points로 센다. trim은 판정에만 쓴다. */
export function validateAnswerText(value: string): AnswerValidation {
  const normalized = normalizeAnswerText(value);
  const length = Array.from(normalized).length;
  const error = normalized.trim().length === 0 ? 'ANSWER_BLANK' : length > 500 ? 'ANSWER_TOO_LONG' : null;
  return { ok: error === null, value: normalized, code_points: length, error };
}
