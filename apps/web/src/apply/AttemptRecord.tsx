import { CONCLUSION_LABELS, EVIDENCE_LABELS } from './api.ts';
import type { Attempt, History } from './api.ts';

// 한 제출 시도의 당시 자료: 승인(권한 근거) → 지원 내용 revision → 공고 snapshot → 파일 → 답변 → 접수 근거.

const ATTEMPT_LABELS: Record<Attempt['state'], string> = {
  prepared: '실행 대기', dispatched: '전송함 · 결과 확인 중', submitted: '접수 확인됨', submission_unknown: '접수 여부 불명', not_submitted: '미접수 확정', failed_before_dispatch: '전송 전 중단',
};
const time = (value: string | null) => (value ? new Date(value).toLocaleString('ko-KR') : '없음');

export function AttemptRecord({ data, attempt }: { data: History; attempt: Attempt }) {
  const record = data.authorizations.find(item => item.authorization.id === attempt.authorization_id);
  const authorization = record?.authorization;
  const revision = authorization ? data.revisions.find(item => item.revision === authorization.application_revision) : undefined;
  const job = revision ? data.jobs.find(item => item.id === revision.job_snapshot_id) : undefined;
  const artifact = revision ? data.artifacts.find(item => item.id === revision.artifact_id) : undefined;
  const evidence = data.evidence.filter(item => item.attempt_id === attempt.id);
  return <details className="attempt-record" open={attempt.id === data.attempts.at(-1)?.id}>
    <summary><strong>{ATTEMPT_LABELS[attempt.state]}</strong> · {time(attempt.dispatch_started_at ?? attempt.created_at)} · Chrome</summary>
    <dl className="artifact-meta">
      <div><dt>시도 ID</dt><dd className="source-url">{attempt.id}</dd></div>
      <div><dt>전송 시각</dt><dd>{time(attempt.dispatch_started_at)}</dd></div>
      {attempt.error_code && <div><dt>멈춘 이유</dt><dd>{attempt.error_code}</dd></div>}
      {authorization && <>
        <div><dt>승인</dt><dd>사용자 직접 확인 {time(authorization.user_reviewed_at)} · 만료 {time(authorization.expires_at)}{record?.revoked_at ? ` · 철회 ${time(record.revoked_at)}` : ''}</dd></div>
        <div><dt>대상</dt><dd className="source-url">{authorization.target.target_url} · {authorization.target.site_id} {authorization.target.adapter_version}</dd></div>
        <div><dt>폼 구조 hash</dt><dd className="source-url">{authorization.target.form_snapshot_hash}</dd></div>
        <div><dt>지원 내용 hash</dt><dd className="source-url">{authorization.payload_hash}</dd></div>
      </>}
      {job && <div><dt>공고(당시)</dt><dd>{job.company_name} · {job.title} · 관측 {time(job.observed_at)}</dd></div>}
      {artifact && <div><dt>제출 파일</dt><dd><a href={artifact.download_path} target="_blank" rel="noreferrer">{artifact.filename}</a> · {(artifact.byte_size / 1024).toFixed(1)}KB<br /><span className="source-url">SHA-256 {artifact.sha256}</span></dd></div>}
      {revision?.answers.map(answer => <div key={answer.question_id}><dt>{answer.question_text}</dt><dd className="answer-text">{answer.answer}</dd></div>)}
    </dl>
    {job && <details className="job-snapshot"><summary>당시 공고 원문 보기</summary><pre>{job.content_text}</pre></details>}
    {evidence.length > 0 && <ul className="evidence-list">{evidence.map(item => <li key={item.id}>
      <strong>{EVIDENCE_LABELS[item.kind]} · {CONCLUSION_LABELS[item.conclusion]}</strong>
      <span>{item.summary}</span>
      <span className="muted">{time(item.observed_at)} · 근거 hash {item.evidence_hash}</span>
    </li>)}</ul>}
  </details>;
}
