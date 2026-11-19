import type { Candidate, FactBundle, EvaluationResult, Priority } from '../../domain/src/index.ts';

/** 개발 확인용 응답. 제품 /api/v1 응답과 구분한다. */
export type StarterPreview = {
  mode: 'mock';
  provenance: 'fixture';
  notice: string;
  remote_priority: Priority;
  items: { candidate: Candidate; facts: FactBundle; assessment: EvaluationResult }[];
};

