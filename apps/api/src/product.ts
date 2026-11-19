import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.ts';
import type { ProductRequest, Reply } from './http.ts';
import { authenticate, checkWrite, isReply, localDevLogin, localDevLogout, productSessionBody } from './auth.ts';
import type { Principal } from './auth.ts';
import { createPastedText, readOriginal, uploadPdf } from './resume/intake.ts';
import { confirmFacts, getExtractionDraft, getProductTask, getResumeDocument, getResumeFactRevision, getSourceText, listResumeDocuments } from './resume/review.ts';
import type { ObjectStore } from './resume/storage.ts';
import { createResumeAiReview, getResumeAiReview } from './resume/ai-review.ts';
import { createSupplementSession, getSupplementSession, postSupplementMessage } from './resume/supplement.ts';
import { createTailoringSession, getTailoringSession, listSessionTasks, listTailoringMessages, postTailoringMessage, requestJdCheck, restoreResumeRevision, retryTailoringMessage } from './tailor/sessions.ts';
import { acceptEditProposal, listEditProposals, rejectEditProposal } from './tailor/proposals.ts';
import { createArtifact, finalizeResumeRevision, getArtifactContent, getArtifactMeta, getResumeRevision, listRevisionArtifacts, listSessionRevisions } from './tailor/revisions.ts';
import { cancelProductTask, createResumeSearch, createSearchIntent, getJob, getResumeSearch, getSearchIntent } from './search/handlers.ts';
import { createJobApplication, getApplicationHistory, getJobApplication, listJobApplications, recordRecruitmentStage, updateJobApplication } from './apply/applications.ts';
import { createManualAuthorization, createSubmissionAttempt, getSubmissionAttempt, getSubmissionEvidence, observeSubmissionAttempt } from './apply/submission.ts';
import { createExecutorPairing, listExecutorDevices, revokeExecutorDevice } from './apply/devices.ts';
import { createExternalApplication, listExternalApplications } from './apply/external.ts';
import { activatePolicy, createPolicyRevision, getPolicyControlHandler, getPolicyRevisionHandler, listPolicies, pausePolicy, revokePolicy } from './automation/policies.ts';
import { cancelCampaign, createCampaign, getCampaignHandler, getCampaignQueue, listCampaigns, pauseCampaign, runCampaign } from './automation/campaigns.ts';

// /api/v1 제품 경로 중 S01(세션·원본 등록·추출 확인·확정 경력), S02(검색 계획·검색 작업·공고 조회),
// S04(편집 세션·대화·변경 제안·이력서 revision·확정·PDF), S05(지원 건·수동 제출 권한·시도·접수 근거·외부 지원 기록·실행기 연결), S06(자동화 정책 recommend·prepare·유사 공고 캠페인·대기함)을 처리한다.
// 여기서 처리하지 않는 경로는 null을 돌려 기존 501 미구현 응답으로 넘긴다.

export type ProductDeps = { db: DatabaseSync; config: Config; store: ObjectStore; schedule: (taskId: string) => void };

type Handler = (deps: ProductDeps, request: ProductRequest, principal: Principal, id: string, second: string) => Reply | Promise<Reply>;
type Route = { method: string; pattern: RegExp; write: boolean; handle: Handler };

const ID = '([a-zA-Z0-9_-]{1,128})';
const routes: Route[] = [
  { method: 'GET', pattern: /^\/api\/v1\/product-session$/, write: false, handle: (deps, _request, principal) => ({ status: 200, body: productSessionBody(principal, deps.config.mode === 'live') }) },
  { method: 'DELETE', pattern: /^\/api\/v1\/local-dev\/session$/, write: false, handle: (deps, request, principal) => localDevLogout(deps.db, deps.config, request, principal) },
  { method: 'GET', pattern: /^\/api\/v1\/resume-documents$/, write: false, handle: (deps, _request, principal) => listResumeDocuments(deps, principal) },
  { method: 'POST', pattern: /^\/api\/v1\/resume-documents$/, write: true, handle: (deps, request, principal) => uploadPdf(deps, request, principal) },
  { method: 'POST', pattern: /^\/api\/v1\/resume-documents\/text$/, write: true, handle: (deps, request, principal) => createPastedText(deps, request, principal) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/resume-documents/${ID}$`), write: false, handle: (deps, request, principal, id) => getResumeDocument(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/resume-documents/${ID}/original$`), write: false, handle: (deps, request, principal, id) => readOriginal(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/resume-documents/${ID}/source-text$`), write: false, handle: (deps, request, principal, id) => getSourceText(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/resume-documents/${ID}/extraction$`), write: false, handle: (deps, request, principal, id) => getExtractionDraft(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/resume-documents/${ID}/fact-revisions$`), write: true, handle: (deps, request, principal, id) => confirmFacts(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/resume-fact-revisions/${ID}$`), write: false, handle: (deps, request, principal, id) => getResumeFactRevision(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/resume-fact-revisions/${ID}/ai-reviews$`), write: true, handle: (deps, request, principal, id) => createResumeAiReview(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/resume-ai-reviews/${ID}$`), write: false, handle: (deps, request, principal, id) => getResumeAiReview(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/resume-fact-revisions/${ID}/supplement-sessions$`), write: true, handle: (deps, request, principal, id) => createSupplementSession(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/resume-supplement-sessions/${ID}$`), write: false, handle: (deps, request, principal, id) => getSupplementSession(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/resume-supplement-sessions/${ID}/messages$`), write: true, handle: (deps, request, principal, id) => postSupplementMessage(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/product-tasks/${ID}$`), write: false, handle: (deps, request, principal, id) => getProductTask(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/product-tasks/${ID}/cancel$`), write: true, handle: (deps, request, principal, id) => cancelProductTask(deps, request, principal, id) },
  { method: 'POST', pattern: /^\/api\/v1\/search-intents$/, write: true, handle: (deps, request, principal) => createSearchIntent(deps, request, principal) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/search-intents/${ID}$`), write: false, handle: (deps, request, principal, id) => getSearchIntent(deps, request, principal, id) },
  { method: 'POST', pattern: /^\/api\/v1\/resume-searches$/, write: true, handle: (deps, request, principal) => createResumeSearch(deps, request, principal) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/resume-searches/${ID}$`), write: false, handle: (deps, request, principal, id) => getResumeSearch(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/job-snapshots/${ID}$`), write: false, handle: (deps, request, principal, id) => getJob(deps, request, principal, id) },
  { method: 'POST', pattern: /^\/api\/v1\/tailoring-sessions$/, write: true, handle: (deps, request, principal) => createTailoringSession(deps, request, principal) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/tailoring-sessions/${ID}$`), write: false, handle: (deps, request, principal, id) => getTailoringSession(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/tailoring-sessions/${ID}/messages$`), write: false, handle: (deps, request, principal, id) => listTailoringMessages(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/tailoring-sessions/${ID}/messages$`), write: true, handle: (deps, request, principal, id) => postTailoringMessage(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/tailoring-sessions/${ID}/messages/${ID}/retry$`), write: true, handle: (deps, request, principal, id, second) => retryTailoringMessage(deps, request, principal, id, second) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/tailoring-sessions/${ID}/jd-checks$`), write: true, handle: (deps, request, principal, id) => requestJdCheck(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/tailoring-sessions/${ID}/proposals$`), write: false, handle: (deps, request, principal, id) => listEditProposals(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/tailoring-sessions/${ID}/tasks$`), write: false, handle: (deps, request, principal, id) => listSessionTasks(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/tailoring-sessions/${ID}/revisions$`), write: false, handle: (deps, request, principal, id) => listSessionRevisions(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/tailoring-sessions/${ID}/restore$`), write: true, handle: (deps, request, principal, id) => restoreResumeRevision(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/edit-proposals/${ID}/accept$`), write: true, handle: (deps, request, principal, id) => acceptEditProposal(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/edit-proposals/${ID}/reject$`), write: true, handle: (deps, request, principal, id) => rejectEditProposal(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/resume-revisions/${ID}$`), write: false, handle: (deps, request, principal, id) => getResumeRevision(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/resume-revisions/${ID}/finalize$`), write: true, handle: (deps, request, principal, id) => finalizeResumeRevision(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/resume-revisions/${ID}/artifacts$`), write: false, handle: (deps, request, principal, id) => listRevisionArtifacts(deps, request, principal, id) },
  { method: 'POST', pattern: /^\/api\/v1\/artifacts$/, write: true, handle: (deps, request, principal) => createArtifact(deps, request, principal) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/artifacts/${ID}$`), write: false, handle: (deps, request, principal, id) => getArtifactMeta(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/artifacts/${ID}/content$`), write: false, handle: (deps, request, principal, id) => getArtifactContent(deps, request, principal, id) },
  { method: 'POST', pattern: /^\/api\/v1\/job-applications$/, write: true, handle: (deps, request, principal) => createJobApplication(deps, request, principal) },
  { method: 'GET', pattern: /^\/api\/v1\/job-applications$/, write: false, handle: (deps, request, principal) => listJobApplications(deps, request, principal) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/job-applications/${ID}$`), write: false, handle: (deps, request, principal, id) => getJobApplication(deps, request, principal, id) },
  { method: 'PATCH', pattern: new RegExp(`^/api/v1/job-applications/${ID}$`), write: true, handle: (deps, request, principal, id) => updateJobApplication(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/job-applications/${ID}/history$`), write: false, handle: (deps, request, principal, id) => getApplicationHistory(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/job-applications/${ID}/manual-authorizations$`), write: true, handle: (deps, request, principal, id) => createManualAuthorization(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/job-applications/${ID}/attempts$`), write: true, handle: (deps, request, principal, id) => createSubmissionAttempt(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/job-applications/${ID}/recruitment-events$`), write: true, handle: (deps, request, principal, id) => recordRecruitmentStage(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/submission-attempts/${ID}$`), write: false, handle: (deps, request, principal, id) => getSubmissionAttempt(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/submission-attempts/${ID}/observe$`), write: true, handle: (deps, request, principal, id) => observeSubmissionAttempt(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/submission-evidence/${ID}$`), write: false, handle: (deps, request, principal, id) => getSubmissionEvidence(deps, request, principal, id) },
  { method: 'POST', pattern: /^\/api\/v1\/executor-pairings$/, write: true, handle: (deps, request, principal) => createExecutorPairing(deps, request, principal) },
  { method: 'GET', pattern: /^\/api\/v1\/executor-devices$/, write: false, handle: (deps, request, principal) => listExecutorDevices(deps, request, principal) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/executor-devices/${ID}/revoke$`), write: true, handle: (deps, request, principal, id) => revokeExecutorDevice(deps, request, principal, id) },
  { method: 'POST', pattern: /^\/api\/v1\/external-applications$/, write: true, handle: (deps, request, principal) => createExternalApplication(deps, request, principal) },
  { method: 'GET', pattern: /^\/api\/v1\/external-applications$/, write: false, handle: (deps, request, principal) => listExternalApplications(deps, request, principal) },
  { method: 'POST', pattern: /^\/api\/v1\/auto-apply-policies$/, write: true, handle: (deps, request, principal) => createPolicyRevision(deps, request, principal) },
  { method: 'GET', pattern: /^\/api\/v1\/auto-apply-policies$/, write: false, handle: (deps, request, principal) => listPolicies(deps, request, principal) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/auto-apply-policies/${ID}$`), write: false, handle: (deps, request, principal, id) => getPolicyControlHandler(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/auto-apply-policies/${ID}/revisions/${ID}$`), write: false, handle: (deps, request, principal, id, second) => getPolicyRevisionHandler(deps, request, principal, id, second) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/auto-apply-policies/${ID}/activate$`), write: true, handle: (deps, request, principal, id) => activatePolicy(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/auto-apply-policies/${ID}/pause$`), write: true, handle: (deps, request, principal, id) => pausePolicy(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/auto-apply-policies/${ID}/revoke$`), write: true, handle: (deps, request, principal, id) => revokePolicy(deps, request, principal, id) },
  { method: 'POST', pattern: /^\/api\/v1\/similar-job-campaigns$/, write: true, handle: (deps, request, principal) => createCampaign(deps, request, principal) },
  { method: 'GET', pattern: /^\/api\/v1\/similar-job-campaigns$/, write: false, handle: (deps, request, principal) => listCampaigns(deps, request, principal) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/similar-job-campaigns/${ID}$`), write: false, handle: (deps, request, principal, id) => getCampaignHandler(deps, request, principal, id) },
  { method: 'GET', pattern: new RegExp(`^/api/v1/similar-job-campaigns/${ID}/queue$`), write: false, handle: (deps, request, principal, id) => getCampaignQueue(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/similar-job-campaigns/${ID}/run$`), write: true, handle: (deps, request, principal, id) => runCampaign(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/similar-job-campaigns/${ID}/pause$`), write: true, handle: (deps, request, principal, id) => pauseCampaign(deps, request, principal, id) },
  { method: 'POST', pattern: new RegExp(`^/api/v1/similar-job-campaigns/${ID}/cancel$`), write: true, handle: (deps, request, principal, id) => cancelCampaign(deps, request, principal, id) },
];

export async function routeProductRequest(deps: ProductDeps, request: ProductRequest): Promise<Reply | null> {
  const path = request.url.pathname;
  if (request.method === 'POST' && path === '/api/v1/local-dev/session') return localDevLogin(deps.db, deps.config, request);
  for (const route of routes) {
    if (route.method !== request.method) continue;
    const match = route.pattern.exec(path);
    if (!match) continue;
    const principal = authenticate(deps.db, request);
    if (isReply(principal)) return principal;
    if (route.write) {
      const denied = checkWrite(deps.config, request, principal);
      if (denied) return denied;
    }
    return await route.handle(deps, request, principal, match[1] ?? '', match[2] ?? '');
  }
  return null;
}
