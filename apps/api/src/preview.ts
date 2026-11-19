import { createMockLinerAdapter } from '../../../packages/liner/src/index.ts';
import { evaluateConditions, evaluateRemoteAvailability } from '../../../packages/domain/src/index.ts';
import type { Priority } from '../../../packages/domain/src/index.ts';
import type { StarterPreview } from '../../../packages/shared/src/preview.ts';

export async function buildPreview(priority: Priority): Promise<StarterPreview> {
  const adapter = createMockLinerAdapter();
  const candidates = await adapter.search({ searchId: 'search_preview', query: 'React', maxResults: 10 });
  const items = await Promise.all(candidates.map(async candidate => {
    const facts = await adapter.analyze({ candidate, taskId: `task_preview_${candidate.slot}` });
    const remote = facts.claims.find(claim => claim.field === 'remote_policy');
    return { candidate, facts, assessment: evaluateConditions([evaluateRemoteAvailability(remote, priority)]) };
  }));
  return {
    mode: 'mock', provenance: 'fixture', remote_priority: priority,
    notice: '이 화면은 합성 공고 3개의 조건 평가 예제입니다. 실제 검색·지원·접수는 수행하지 않습니다.',
    items,
  };
}

