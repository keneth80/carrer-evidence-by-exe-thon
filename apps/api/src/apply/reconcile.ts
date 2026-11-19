import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson, sha256 } from '../../../../packages/apply/src/payload.ts';
import { CONSENT_ANSWER, SELF_FORM_QUESTIONS, SELF_FORM_SITE_ID, selfFormPostingFromUrl } from '../../../../packages/apply/src/self-form.ts';
import { newId } from '../http.ts';
import { lookupSubmission, sealSubmission } from '../demo-site/site.ts';
import { getAppRevision, getAttempt, getAuthorization, revisionAnswers } from './repository.ts';
import type { AttemptRow, AttemptState } from './repository.ts';

// 접수 결과 판정. 사이트별 reconcile이 있는 경우(현재 자체 테스트 폼만)에만 사이트 저장소로 접수 여부를 확정한다.
// 외부 채용사이트는 우리 DB와 한 transaction이 아니므로 이 보장을 쓰지 않는다: 근거가 없으면 submission_unknown을 유지한다.
// 모든 함수는 호출자가 연 BEGIN IMMEDIATE transaction 안에서 실행한다.

type Conclusion = 'submitted' | 'not_submitted' | 'unknown';
export type EvidenceInput = { kind: 'confirmation_page' | 'receipt_id' | 'user_report' | 'no_delivery_proof'; conclusion: Conclusion; summary: string; content: unknown; source_url: string | null };

export function insertEvidence(db: DatabaseSync, attempt: AttemptRow, evidence: EvidenceInput, nowMs: number): string {
  const id = newId('evidence');
  db.prepare('INSERT INTO ce7_submission_evidence (id, workspace_id, attempt_id, kind, conclusion, summary, evidence_hash, observed_at_ms, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, attempt.workspace_id, attempt.id, evidence.kind, evidence.conclusion, evidence.summary, sha256(canonicalJson(evidence.content)), nowMs, evidence.source_url);
  return id;
}

// 전송 이후 상태만 바꾼다(dispatched·submission_unknown). 이미 확정된 시도는 그대로 둔다.
export function setAttemptState(db: DatabaseSync, attempt: AttemptRow, state: AttemptState, errorCode: string | null, nowMs: number): boolean {
  const result = db.prepare("UPDATE ce7_attempts SET state = ?, error_code = ?, updated_at_ms = ? WHERE workspace_id = ? AND id = ? AND state IN ('dispatched','submission_unknown')")
    .run(state, errorCode, nowMs, attempt.workspace_id, attempt.id);
  return Number(result.changes) === 1;
}

export const hasReconciler = (siteId: string) => siteId === SELF_FORM_SITE_ID;

// 자체 폼 저장소에서 이 시도의 접수 키(attempt ID)를 찾는다. seal=true면 기록이 없을 때 키를 닫아 이후 접수를 막고 미접수로 확정한다.
export function reconcileSelfForm(db: DatabaseSync, ws: string, attemptId: string, options: { seal: boolean; nowMs: number }): { state: AttemptState; evidenceId: string | null } {
  const attempt = getAttempt(db, ws, attemptId);
  if (!attempt) throw new Error('ATTEMPT_MISSING');
  if (attempt.state !== 'dispatched' && attempt.state !== 'submission_unknown') return { state: attempt.state, evidenceId: null };
  const authorization = getAuthorization(db, ws, attempt.authorization_id)!;
  const postingId = selfFormPostingFromUrl(authorization.target_url);
  if (authorization.site_id !== SELF_FORM_SITE_ID || !postingId) throw new Error('RECONCILE_NOT_SUPPORTED');
  const revision = getAppRevision(db, ws, authorization.application_id, authorization.application_revision)!;
  let site = lookupSubmission(db, attempt.id);
  if (!site) {
    // 이 시도의 접수 키는 없지만, 승인 뒤 같은 공고에 같은 파일로 들어온 다른 접수가 있으면(사용자가 페이지의 제출 버튼을 직접 누른 경우 등)
    // 미접수로 확정하지 않는다. 봉인하지 않고 접수 불명으로 두어 사용자가 확인하게 한다.
    const other = db.prepare("SELECT receipt_number, submission_key FROM demo_site_submissions WHERE state = 'accepted' AND posting_id = ? AND file_sha256 = ? AND created_at_ms >= ? AND submission_key <> ? ORDER BY created_at_ms DESC LIMIT 1")
      .get(postingId, authorization.artifact_sha256, authorization.created_at_ms, attempt.id) as { receipt_number: string; submission_key: string } | undefined;
    if (other) {
      if (attempt.state === 'submission_unknown' && attempt.error_code === 'POSSIBLE_OTHER_SUBMISSION') return { state: attempt.state, evidenceId: null };
      const evidenceId = insertEvidence(db, attempt, { kind: 'receipt_id', conclusion: 'unknown', summary: `이 시도의 접수 기록은 없지만, 승인 뒤 같은 공고에 같은 PDF로 들어온 다른 접수(접수번호 ${other.receipt_number})가 있습니다. 페이지에서 직접 제출했을 수 있으니 다시 제출하기 전에 확인하세요.`, content: { attempt_id: attempt.id, other_receipt: other.receipt_number, other_key: other.submission_key }, source_url: authorization.target_url }, options.nowMs);
      setAttemptState(db, attempt, 'submission_unknown', 'POSSIBLE_OTHER_SUBMISSION', options.nowMs);
      return { state: 'submission_unknown', evidenceId };
    }
  }
  if (!site && options.seal) site = sealSubmission(db, attempt.id, postingId, options.nowMs);

  if (!site) {
    if (attempt.state === 'submission_unknown') return { state: attempt.state, evidenceId: null };
    const evidenceId = insertEvidence(db, attempt, { kind: 'no_delivery_proof', conclusion: 'unknown', summary: '제출 뒤 접수 결과를 확인하지 못했습니다. 다시 제출하지 말고 접수 결과 확인을 요청하세요.', content: { attempt_id: attempt.id, site: 'none' }, source_url: authorization.target_url }, options.nowMs);
    setAttemptState(db, attempt, 'submission_unknown', 'RECEIPT_NOT_OBSERVED', options.nowMs);
    return { state: 'submission_unknown', evidenceId };
  }
  if (site.state === 'sealed') {
    const evidenceId = insertEvidence(db, attempt, { kind: 'no_delivery_proof', conclusion: 'not_submitted', summary: '자체 테스트 폼에 이 시도의 접수 기록이 없어 미접수로 확정했습니다. 이 접수 요청은 이후에도 받지 않도록 닫았습니다.', content: { attempt_id: attempt.id, site_state: 'sealed', posting_id: site.posting_id }, source_url: authorization.target_url }, options.nowMs);
    setAttemptState(db, attempt, 'not_submitted', null, options.nowMs);
    return { state: 'not_submitted', evidenceId };
  }
  // 접수 기록이 있으면 접수된 내용이 승인한 파일·답변과 같은지 확인한다.
  const answers = revisionAnswers(revision);
  const fields = JSON.parse(site.fields_json ?? '{}') as Record<string, string>;
  const fieldsMatch = SELF_FORM_QUESTIONS.every(question => {
    const answer = answers.find(item => item.question_id === question.question_id)?.answer ?? '';
    return question.kind === 'checkbox' ? (fields[question.question_id] === 'on') === (answer === CONSENT_ANSWER) : fields[question.question_id] === answer;
  });
  const matches = site.posting_id === postingId && site.file_sha256 === authorization.artifact_sha256 && fieldsMatch;
  const content = { receipt_number: site.receipt_number, posting_id: site.posting_id, submission_key: site.submission_key, file_sha256: site.file_sha256, file_size: site.file_size, fields_sha256: sha256(canonicalJson(fields)) };
  if (!matches) {
    if (attempt.state === 'submission_unknown' && attempt.error_code === 'RECEIPT_CONTENT_MISMATCH') return { state: attempt.state, evidenceId: null };
    const evidenceId = insertEvidence(db, attempt, { kind: 'receipt_id', conclusion: 'unknown', summary: `접수번호 ${site.receipt_number}가 있지만 접수된 내용이 승인한 파일·답변과 다릅니다. 직접 확인이 필요합니다.`, content, source_url: authorization.target_url }, options.nowMs);
    setAttemptState(db, attempt, 'submission_unknown', 'RECEIPT_CONTENT_MISMATCH', options.nowMs);
    return { state: 'submission_unknown', evidenceId };
  }
  const evidenceId = insertEvidence(db, attempt, { kind: 'receipt_id', conclusion: 'submitted', summary: `자체 테스트 폼 접수번호 ${site.receipt_number}를 사이트 저장소에서 확인했습니다. 첨부 파일 hash와 답변이 승인한 내용과 같습니다.`, content, source_url: authorization.target_url }, options.nowMs);
  setAttemptState(db, attempt, 'submitted', null, options.nowMs);
  return { state: 'submitted', evidenceId };
}

// 실행기가 확인한 완료 화면 기록. 자체 폼은 이후 사이트 저장소 대조(reconcileSelfForm)로 상태를 확정한다.
export function recordConfirmationPage(db: DatabaseSync, attempt: AttemptRow, observed: { receipt_number: string; posting_id: string; submission_key: string; page_url: string }, nowMs: number): string {
  const matchesAttempt = observed.submission_key === attempt.id;
  return insertEvidence(db, attempt, {
    kind: 'confirmation_page', conclusion: matchesAttempt ? 'submitted' : 'unknown',
    summary: matchesAttempt ? `확장이 접수 완료 화면에서 접수번호 ${observed.receipt_number}를 확인했습니다.` : '완료 화면의 접수 키가 이 시도와 다릅니다.',
    content: observed, source_url: observed.page_url,
  }, nowMs);
}
