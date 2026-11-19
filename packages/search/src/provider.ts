import { queryTerms } from './intent.ts';
import { containsTerm, violatesRequiredCondition } from './match.ts';
import { MOCK_JOBS } from './mock-catalog.ts';
import type { Condition, JobDraft, QueryPlan } from './types.ts';

// 검색 provider 경계. worker는 이 interface만 사용한다. Liner live 구현은 packages/liner/src/web-search.ts.

// signal: worker가 lease를 잃으면 abort한다. live provider는 이 신호로 네트워크 요청을 중단해야 한다.
// call: 유료 호출 원장(ce7_provider_calls)에 남길 작업·lease generation. live provider는 이 값 없이 호출하지 않는다.
export type ProviderCallContext = { workspaceId: string; taskId: string; leaseGeneration: number };
export type ProviderInput = { queries: QueryPlan[]; conditions: Condition[]; maxCandidates: number; signal?: AbortSignal; call?: ProviderCallContext };
export type ProviderResult = { outcome: 'complete' | 'partial' | 'empty'; jobs: JobDraft[]; failed_queries: number };
export type SearchProvider = { readonly mode: 'mock' | 'live'; search(input: ProviderInput): Promise<ProviderResult> };

// transmission: 실패한 검색 요청이 외부로 나갔는지. worker가 작업의 provider_transmission으로 그대로 기록한다.
// 전송 전 거절은 not_dispatched, 처리되지 않았다고 확인된 응답은 completed, 결과를 모르면 unknown(자동 재시도 금지).
export type FailedTransmission = 'not_dispatched' | 'completed' | 'unknown';

export class SearchProviderError extends Error {
  readonly code: string;
  readonly transmission: FailedTransmission;
  constructor(code: string, message: string, transmission: FailedTransmission = 'completed') {
    super(message);
    this.name = 'SearchProviderError';
    this.code = code;
    this.transmission = transmission;
  }
}

function score(job: JobDraft, terms: string[]): number {
  const text = `${job.title}\n${job.content_text}`;
  return terms.filter(term => containsTerm(text, term)).length;
}

// 질의 단어가 공고 원문에 나타난 수로 순서를 정한다. 단어가 하나도 없으면 결과가 아니다.
export function createMockSearchProvider(catalog: readonly JobDraft[] = MOCK_JOBS): SearchProvider {
  return {
    mode: 'mock',
    async search(input) {
      if (!Number.isInteger(input.maxCandidates) || input.maxCandidates < 1 || input.maxCandidates > 10 || input.queries.length === 0) {
        throw new SearchProviderError('INVALID_SEARCH_INPUT', '질의 1개 이상과 1~10 범위의 후보 수가 필요합니다.');
      }
      const terms = [...new Set(input.queries.flatMap(item => queryTerms(item.query)))];
      const ranked = catalog
        .map(job => ({ job, score: score(job, terms) }))
        .filter(item => item.score > 0 && !violatesRequiredCondition(input.conditions, item.job))
        .sort((a, b) => b.score - a.score || a.job.job_key.localeCompare(b.job.job_key))
        .slice(0, input.maxCandidates)
        .map(item => item.job);
      return { outcome: ranked.length === 0 ? 'empty' : 'complete', jobs: ranked, failed_queries: 0 };
    },
  };
}
