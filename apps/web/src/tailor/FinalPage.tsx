import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, describeError } from '../resume/api.ts';
import type { RenderedArtifact } from '../resume/api.ts';
import { navigate } from '../router.ts';
import { loadTailor, renderInProgress, replyState, statementConfirmed } from './data.ts';
import type { TailorData } from './data.ts';
import { ResumePreview } from './ResumePreview.tsx';
import { ApplyEntry } from '../apply/ApplyEntry.tsx';

// U05 최종 제출본 확인: 현재 버전을 직접 확인해 확정하고, 실제 PDF를 만들어 미리보기·내려받기한다.
// HTML 미리보기는 확정 전 확인용이며, PDF 검토는 실제 생성한 파일로 한다.

type Loaded = TailorData & { artifacts: RenderedArtifact[] };
type PdfInfo = { pages: string | null; sha: string | null };

const FINALIZE_ERRORS: Record<string, (details: Record<string, unknown> | undefined) => string> = {
  RESUME_MENTIONS_OTHER_COMPANY: details => `다른 공고의 회사 이름(${(details?.companies as string[] | undefined)?.join(', ') ?? ''})이 문서에 남아 있습니다. 편집 화면에서 고친 뒤 확정하세요.`,
  RESUME_UNSUPPORTED_CLAIM: () => '근거 사실 범위를 넘는 문장이 있어 확정할 수 없습니다. 편집 화면에서 확인하세요.',
  CONTENT_HASH_MISMATCH: () => '확인한 뒤 내용이 바뀌었습니다. 다시 확인해 주세요.',
  RESUME_REVISION_CONFLICT: () => '더 최신 버전이 있습니다. 다시 불러온 내용을 확인해 주세요.',
  FACTS_CHANGED: () => '이 문서를 만든 뒤 경력 정보가 바뀌었습니다(지우거나 고친 사실이 문서에 남아 있음). 최신 경력으로 다시 검색해 새로 편집하세요.',
  RESUME_GLYPH_MISSING: details => `PDF 글꼴에 없는 글자(${(details?.characters as string[] | undefined)?.join(' ') ?? ''})가 있어 확정할 수 없습니다. 편집 화면에서 해당 글자를 바꿔 주세요.`,
};

export function FinalPage({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<Loaded | 'not_found' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 확인 체크는 확인한 내용의 hash에 묶는다. 다른 화면에서 문서가 바뀌면 다시 확인해야 한다.
  const [reviewedHash, setReviewedHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renderTask, setRenderTask] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfInfo>({ pages: null, sha: null });
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const base = await loadTailor(sessionId);
      const artifacts = (await api.artifacts(base.revision.id)).items;
      if (ticket !== latest.current) return;
      setData({ ...base, artifacts });
      // 새로고침 전에 요청한 렌더가 아직 진행 중이면 이어서 확인한다.
      const running = renderInProgress(base, base.revision.id);
      if (running) setRenderTask(current => current ?? running);
    } catch (failure) {
      if (ticket !== latest.current) return;
      if (failure instanceof ApiError && failure.status === 401) { window.location.assign('/start'); return; }
      if (failure instanceof ApiError && failure.status === 404) { setData('not_found'); return; }
      setError(describeError(failure));
    }
  }, [sessionId]);
  useEffect(() => { refresh(); }, [refresh]);

  // 렌더 작업 완료를 확인한다.
  useEffect(() => {
    if (!renderTask) return;
    const timer = window.setTimeout(async () => {
      const task = await api.task(renderTask).catch(() => null);
      if (task?.state === 'succeeded') { setRenderTask(null); await refresh(); }
      else if (task?.state === 'failed') { setRenderTask(null); setError(`PDF를 만들지 못했어요(${task.error_code ?? '원인 미상'}). 확정한 내용은 그대로입니다. 다시 시도해 주세요.`); }
      else setTick(count => count + 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [renderTask, tick, refresh]);

  const artifact = data && data !== 'not_found' ? data.artifacts[0] : undefined;
  // 실제 파일의 쪽수·hash는 서버가 제공한 파일 응답 헤더에서 읽는다.
  useEffect(() => {
    if (!artifact) return;
    let alive = true;
    fetch(artifact.download_path, { method: 'HEAD', credentials: 'same-origin' }).then(response => {
      if (alive) setPdf({ pages: response.headers.get('x-pdf-page-count'), sha: response.headers.get('x-content-sha256') });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [artifact?.id]);

  if (error && !data) return <div role="alert" className="error">{error}</div>;
  if (!data) return <p role="status" className="status-line">최종 제출본을 불러오는 중…</p>;
  if (data === 'not_found') return <div role="alert" className="error">이 편집 세션을 찾을 수 없습니다. <a href="/start">내 이력서로</a></div>;
  const { session, job, revision, proposals, facts, head } = data;
  const editPath = `/tailoring/${session.id}`;
  const pendingFacts = proposals.filter(item => item.state === 'proposed').flatMap(item => item.changes).filter(change => change.needs_fact_confirmation && !statementConfirmed(head, change.after));
  const openProposals = proposals.filter(item => item.state === 'proposed').length;
  const reply = replyState(data);
  const waiting = reply.kind === 'pending';
  const reviewed = reviewedHash === revision.content_hash;

  const finalize = async () => {
    setBusy(true); setError(null);
    try { await api.finalize(revision.id, { expected_content_hash: revision.content_hash, reviewed: true }, crypto.randomUUID()); await refresh(); }
    catch (failure) {
      const problem = failure instanceof ApiError ? failure.problem : null;
      setError(problem && FINALIZE_ERRORS[problem.code] ? FINALIZE_ERRORS[problem.code](problem.details) : describeError(failure));
      await refresh();
    } finally { setBusy(false); }
  };
  const render = async () => {
    setBusy(true); setError(null);
    try { setRenderTask((await api.render(revision.id, crypto.randomUUID())).task.id); } catch (failure) { setError(describeError(failure)); } finally { setBusy(false); }
  };

  return <div className="final-page">
    <a className="back" href={editPath} onClick={event => { event.preventDefault(); navigate(editPath); }}>← 편집으로 돌아가기</a>
    <section className="hero compact">
      <span className="eyebrow">U05 · 최종 제출본 확인</span>
      <h1>{job.company_name} · {job.title}</h1>
      <p>지원 사이트 {job.site_id} · 이력서 {revision.revision}번째 버전 · {revision.state === 'final' ? `확정 ${new Date(revision.finalized_at ?? '').toLocaleString('ko-KR')}` : '아직 확정 전'}</p>
    </section>
    {job.data_origin === 'synthetic' && <div className="notice"><strong>합성 공고</strong><span>개발용 mock 공고입니다. 지원은 개발용 자체 테스트 폼으로만 제출되며 실제 기업에 접수되지 않습니다.</span></div>}
    <section className="panel checks" aria-labelledby="checks-title">
      <h2 id="checks-title">확인할 항목</h2>
      <ul>
        <li className={pendingFacts.length ? 'warn' : 'ok'}>{pendingFacts.length ? `경력 정보로 확인하지 않은 대화 진술 ${pendingFacts.length}건이 있습니다(문서에는 반영되지 않음).` : '확인하지 않은 새 사실이 문서에 없습니다.'}</li>
        <li className={openProposals ? 'warn' : 'ok'}>{openProposals ? `적용하지 않은 변경 제안 ${openProposals}건이 있습니다. 적용하지 않으면 지금 문서 그대로 확정됩니다.` : '처리하지 않은 변경 제안이 없습니다.'}</li>
        {waiting && <li className="warn">마지막 메시지의 답변을 만드는 중입니다. 끝난 뒤 확정할 수 있어요.</li>}
        {reply.kind === 'failed' && <li className="warn">마지막 메시지의 답변 생성이 실패했습니다(문서는 그대로). 편집 화면에서 다시 시도하거나 지금 문서로 확정할 수 있어요.</li>}
        <li className="ok">회사 이름 점검: 확정할 때 다른 공고의 회사 이름이 남아 있으면 서버가 확정을 막습니다.</li>
        <li className="info">지원서 문항 답변·Chrome 확장 연결·최종 승인은 PDF를 만든 뒤 지원 준비 화면에서 진행합니다.</li>
      </ul>
      {(pendingFacts.length > 0 || openProposals > 0) && <button className="outline small" onClick={() => navigate(editPath)}>편집 화면에서 확인하기</button>}
    </section>
    {error && <div role="alert" className="error">{error}</div>}
    {revision.state === 'draft' ? <section className="panel" aria-labelledby="draft-title">
      <h2 id="draft-title">확정 전 내용 확인</h2>
      <p className="muted">아래 내용 그대로 PDF를 만듭니다. 확정한 버전은 바꿀 수 없고, 이후 수정은 새 버전으로 저장됩니다.</p>
      <ResumePreview blocks={revision.blocks} facts={[...facts, ...(head?.facts ?? [])]} />
      <label className="check confirm-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewedHash(event.target.checked ? revision.content_hash : null)} />위 내용을 직접 확인했습니다.</label>
      <div className="action-row"><button className="primary" disabled={!reviewed || busy || waiting} onClick={finalize}>{busy ? '확정 중…' : '이 버전으로 확정'}</button></div>
    </section> : <section className="panel" aria-labelledby="pdf-title">
      <h2 id="pdf-title">제출 파일(PDF)</h2>
      {!artifact && <>
        <p className="muted">확정한 버전을 실제 PDF 파일로 만듭니다. 파일 hash와 렌더 버전이 함께 저장됩니다.</p>
        <div className="action-row"><button className="primary" disabled={busy || !!renderTask} onClick={render}>{renderTask ? 'PDF 만드는 중…' : 'PDF 만들기'}</button></div>
      </>}
      {artifact && <>
        <dl className="artifact-meta">
          <div><dt>파일명</dt><dd>{artifact.filename}</dd></div>
          <div><dt>쪽수</dt><dd>{pdf.pages ? `${pdf.pages}쪽` : '확인 중'}</dd></div>
          <div><dt>크기</dt><dd>{(artifact.byte_size / 1024).toFixed(1)}KB</dd></div>
          <div><dt>생성</dt><dd>{new Date(artifact.created_at).toLocaleString('ko-KR')}</dd></div>
          <div><dt>SHA-256</dt><dd className="source-url">{artifact.sha256}{pdf.sha && pdf.sha !== artifact.sha256 ? ' (파일 응답과 불일치)' : ''}</dd></div>
        </dl>
        <div className="action-row">
          <a className="outline small" href={`${artifact.download_path}?download=1`}>PDF 내려받기</a>
          <a className="outline small" href={artifact.download_path} target="_blank" rel="noreferrer">새 창에서 열기</a>
        </div>
        <iframe className="pdf-frame" title="제출 PDF 미리보기" src={artifact.download_path} />
      </>}
      <p className="muted">이후 내용을 고치면 새 버전이 만들어지고, 이 파일은 그대로 보관됩니다. <button className="ghost" onClick={() => navigate(editPath)}>계속 수정하기</button></p>
    </section>}
    {revision.state === 'final' && artifact && <ApplyEntry job={job} revision={revision} artifact={artifact} />}
  </div>;
}
