import { createHash } from 'node:crypto';
import type { Candidate, Claim, FactBundle } from '../../domain/src/index.ts';

export type SearchRequest = {
  readonly searchId: string;
  readonly query: string;
  readonly maxResults?: number;
};

export type ResearchRequest = {
  readonly candidate: Candidate;
  readonly taskId: string;
};

export interface LinerAdapter {
  readonly mode: 'mock' | 'live';
  search(request: SearchRequest): Promise<readonly Candidate[]>;
  analyze(request: ResearchRequest): Promise<FactBundle>;
  researchCompany(request: ResearchRequest): Promise<FactBundle>;
}

export class LinerAdapterError extends Error {
  readonly code: 'LIVE_ADAPTER_NOT_IMPLEMENTED' | 'INVALID_MOCK_REQUEST' | 'UNKNOWN_MOCK_CANDIDATE';

  constructor(code: LinerAdapterError['code'], message: string) {
    super(message);
    this.name = 'LinerAdapterError';
    this.code = code;
  }
}

type Fixture = {
  readonly company: string;
  readonly key: string;
  readonly title: string;
  readonly excerpt: string;
  readonly remote: boolean | null;
  readonly product: string;
};

const FIXTURES: readonly Fixture[] = [
  { company: '루미노랩', key: 'lumino.example', title: '프론트엔드 개발 리드', excerpt: '합성 공고: 주 4일 원격 근무, React 5년 이상.', remote: true, product: '합성 기업: 팀 협업용 웹 서비스를 개발합니다.' },
  { company: '브릿지워크', key: 'bridgework.example', title: '시니어 풀스택 개발자', excerpt: '합성 공고: TypeScript와 API 개발 경험. 근무 방식 안내 없음.', remote: null, product: '합성 기업: 업무 일정 관리 서비스를 개발합니다.' },
  { company: '오빗스튜디오', key: 'orbit.example', title: '웹 애플리케이션 개발자', excerpt: '합성 공고: 주 5일 사무실 출근, 원격 근무 불가.', remote: false, product: '합성 기업: 콘텐츠 편집용 웹 서비스를 개발합니다.' },
];

const urlFor = (fixture: Fixture): string => `https://careers.${fixture.key}/jobs/frontend`;
const keyFor = (fixture: Fixture): string => createHash('sha256').update(urlFor(fixture), 'utf8').digest('hex');

function fixtureFor(candidate: Candidate): Fixture {
  const fixture = FIXTURES.find((entry) => entry.key === candidate.company_key && urlFor(entry) === candidate.source_url && keyFor(entry) === candidate.job_key);
  if (!fixture || candidate.provenance !== 'fixture') {
    throw new LinerAdapterError('UNKNOWN_MOCK_CANDIDATE', 'Mock 어댑터는 이 스타터킷의 합성 공고만 처리합니다.');
  }
  return fixture;
}

/** query는 입력 경로 확인에만 사용한다. 실제 검색·분석·네트워크 호출은 수행하지 않는다. */
export function createMockLinerAdapter(options: { readonly observedAt?: string } = {}): LinerAdapter {
  const observedAt = options.observedAt ?? '2026-11-15T00:00:00Z';
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new LinerAdapterError('INVALID_MOCK_REQUEST', 'Mock 관측 시각이 유효하지 않습니다.');
  }
  return {
    mode: 'mock',
    async search(request) {
      const max = request.maxResults ?? 10;
      if (!request.searchId || !request.query.trim() || !Number.isInteger(max) || max < 1 || max > 10) {
        throw new LinerAdapterError('INVALID_MOCK_REQUEST', 'searchId·query와 1~10 범위의 maxResults가 필요합니다.');
      }
      return FIXTURES.slice(0, max).map((fixture, index) => ({
        id: `${request.searchId}_candidate_${index + 1}`,
        search_id: request.searchId,
        slot: index + 1,
        job_key: keyFor(fixture),
        company_key: fixture.key,
        company_name: fixture.company,
        title: fixture.title,
        source_url: urlFor(fixture),
        snippet: fixture.excerpt,
        hiring_status: 'unknown',
        collected_at: observedAt,
        provenance: 'fixture',
      }));
    },
    async analyze({ candidate, taskId }) {
      const fixture = fixtureFor(candidate);
      const sourceId = `${taskId}_source`;
      const claim: Claim = fixture.remote === null
        ? { id: `${taskId}_claim_remote`, field: 'remote_policy', state: 'unknown', value: null, reason: 'not_found_in_retrieved_material', evidence: [] }
        : { id: `${taskId}_claim_remote`, field: 'remote_policy', state: 'known', value: fixture.remote, reason: null, evidence: [{ source_id: sourceId, quote: fixture.excerpt, link_check: 'matched_to_chunk' }] };
      return {
        id: `${taskId}_facts`, candidate_id: candidate.id, task_id: taskId,
        sources: [{ id: sourceId, url: candidate.source_url, title: `${fixture.company} 합성 채용공고`, kind: 'fixture', published_date: null, retrieved_at: observedAt, retrieval_method: 'fixture', excerpt: fixture.excerpt }],
        claims: [claim], quality: fixture.remote === null ? 'partial' : 'structured', provenance: 'fixture', observed_at: observedAt, normalizer_version: 'mock-fixture.v1',
      };
    },
    async researchCompany({ candidate, taskId }) {
      const fixture = fixtureFor(candidate);
      const sourceId = `${taskId}_company_source`;
      return {
        id: `${taskId}_company_facts`, candidate_id: candidate.id, task_id: taskId,
        sources: [{ id: sourceId, url: `https://${fixture.key}/about`, title: `${fixture.company} 합성 기업 자료`, kind: 'fixture', published_date: null, retrieved_at: observedAt, retrieval_method: 'fixture', excerpt: fixture.product }],
        claims: [{ id: `${taskId}_claim_product`, field: 'company_product', state: 'known', value: fixture.product, reason: null, evidence: [{ source_id: sourceId, quote: fixture.product, link_check: 'matched_to_chunk' }] }],
        quality: 'structured', provenance: 'fixture', observed_at: observedAt, normalizer_version: 'mock-fixture.v1',
      };
    },
  };
}

/** 유료 요청을 보내지 않는 명시적 구현 경계. 실제 Liner 연동 단계에서 교체한다. */
export function createLiveLinerAdapter(): LinerAdapter {
  async function unavailable(): Promise<never> {
    throw new LinerAdapterError('LIVE_ADAPTER_NOT_IMPLEMENTED', 'Live Liner 어댑터는 아직 구현되지 않았습니다. mock 모드를 사용하세요.');
  }
  return { mode: 'live', search: unavailable, analyze: unavailable, researchCompany: unavailable };
}
