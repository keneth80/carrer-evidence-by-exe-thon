import { useState } from 'react';
import { ApiError, describeError } from '../resume/api.ts';
import type { JobSnapshot, RenderedArtifact, ResumeRevision } from '../resume/api.ts';
import { navigate } from '../router.ts';
import { applyApi } from './api.ts';

// 최종 제출본 화면 → 지원 준비. 확정 PDF로 공고별 지원 건을 만든다(답변은 다음 화면에서 작성).
// 같은 공고의 지원 건이 있으면 새로 만들지 않고 그 지원 건으로 안내한다.

export function ApplyEntry({ job, revision, artifact }: { job: JobSnapshot; revision: ResumeRevision; artifact: RenderedArtifact }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await applyApi.create({ job_snapshot_id: job.id, resume_revision_id: revision.id, artifact_id: artifact.id, answers: [] }, `apply-${artifact.id}`);
      navigate(`/applications/${created.id}`);
    } catch (failure) {
      const existingId = failure instanceof ApiError ? failure.problem.details?.application_id : undefined;
      if (typeof existingId === 'string') setExisting(existingId);
      setError(describeError(failure));
    } finally { setBusy(false); }
  };
  return <section className="panel" aria-labelledby="apply-entry-title">
    <h2 id="apply-entry-title">이 PDF로 지원 준비</h2>
    <p className="muted">확정한 PDF 파일(SHA-256 {artifact.sha256.slice(0, 12)}…)을 그대로 첨부합니다. 다음 화면에서 지원서 문항에 답하고, Chrome 확장으로 폼 입력을 확인한 뒤 최종 승인합니다.</p>
    <div className="action-row"><button className="primary" disabled={busy} onClick={start}>{busy ? '준비 중…' : '지원 준비 시작'}</button></div>
    {error && <p className="error" role="alert">{error}{existing && <> <button className="ghost" onClick={() => navigate(`/applications/${existing}`)}>기존 지원 건 열기</button></>}</p>}
  </section>;
}
