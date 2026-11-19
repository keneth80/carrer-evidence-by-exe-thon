import type { DatabaseSync } from 'node:sqlite';
import { listDemoPostings } from '../../../../packages/apply/src/self-form.ts';
import type { ProductRequest, Reply } from '../http.ts';
import { getPosting, submitApplication } from './site.ts';

// 자체 테스트 폼 사이트 경로 /api/demo-site/*. 제품 세션과 무관한 '사이트' API다(로그인 없음, 합성 공고만).

const SLUG = '([a-z0-9][a-z0-9-]{0,63})';

export async function routeDemoSiteRequest(deps: { db: DatabaseSync }, request: ProductRequest): Promise<Reply | null> {
  const path = request.url.pathname;
  if (request.method === 'GET' && path === '/api/demo-site/postings') {
    return { status: 200, body: { items: listDemoPostings().map(item => ({ posting_id: item.posting_id, company_name: item.company_name, title: item.title })) } };
  }
  const posting = new RegExp(`^/api/demo-site/postings/${SLUG}$`).exec(path);
  if (request.method === 'GET' && posting) return getPosting(request, posting[1]);
  const submit = new RegExp(`^/api/demo-site/postings/${SLUG}/submissions$`).exec(path);
  if (request.method === 'POST' && submit) return submitApplication(deps.db, request, submit[1]);
  return { status: 404, body: { code: 'NOT_FOUND', request_id: request.requestId } };
}
