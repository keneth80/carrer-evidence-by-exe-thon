import { useCallback, useEffect, useRef, useState } from 'react';
import { buildQueryPlans } from '../../../../packages/search/src/intent.ts';
import { api, ApiError, describeError } from '../resume/api.ts';
import type { DocumentSummary, FactRevision, SearchIntent } from '../resume/api.ts';
import { navigate } from '../router.ts';
import { ConditionForm, emptyDraft, toConditions } from './ConditionForm.tsx';
import type { ConditionDraft } from './ConditionForm.tsx';
import { rememberSearch } from './recent.ts';
import { ReviewPanel } from './ReviewPanel.tsx';

// U03 진입: 확정 경력 현재 버전 + 희망 조건 → 검색 계획 생성 → 영속 검색 작업 생성 → 결과 화면.

type Loaded = { summary: DocumentSummary; revision: FactRevision | null };

async function load(documentId: string): Promise<Loaded | 'not_found'> {
  const summary = (await api.documents()).items.find(item => item.document.id === documentId);
  if (!summary) return 'not_found';
  const revision = summary.current_fact_revision_id ? await api.factRevision(summary.current_fact_revision_id) : null;
  return { summary, revision };
}

export function SearchSetupPage({ documentId }: { documentId: string }) {
  const [data, setData] = useState<Loaded | 'not_found' | null>(null);
  const [draft, setDraft] = useState<ConditionDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 재시도해도 같은 요청으로 처리되도록 key를 유지하고, 만든 검색 계획은 다시 만들지 않는다.
  const [keys, setKeys] = useState(() => ({ intent: crypto.randomUUID(), search: crypto.randomUUID() }));
  const [intent, setIntent] = useState<SearchIntent | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const ticket = ++latest.current;
    load(documentId).then(value => { if (ticket === latest.current) { setData(value); setError(null); } }).catch(failure => {
      if (ticket !== latest.current) return;
      if (failure instanceof ApiError && failure.status === 401) { window.location.assign('/start'); return; }
      setError(describeError(failure));
    });
  }, [documentId]);
  useEffect(() => { refresh(); }, [refresh]);

  if (error && !data) return <div role="alert" className="error">{error}</div>;
  if (!data) return <p role="status" className="status-line">확정 경력을 불러오는 중…</p>;
  if (data === 'not_found') return <div role="alert" className="error">이 문서를 찾을 수 없습니다. <a href="/start">이력서 등록으로</a></div>;
  const { summary, revision } = data;
  const reviewPath = `/resumes/${documentId}/review`;
  if (!revision) {
    return <div role="alert" className="error">아직 확정한 경력이 없습니다. 추출 내용을 확인하고 저장해야 공고를 찾을 수 있어요. <a href={reviewPath}>내용 확인하기</a></div>;
  }

  const preview = buildQueryPlans(revision.facts);
  const used = new Set(preview.ok ? preview.queries.flatMap(item => item.fact_ids) : []);
  const searchable = revision.facts.filter(fact => used.has(fact.id));

  const start = async () => {
    const converted = toConditions(draft);
    if (!converted.ok) { setError(converted.message); return; }
    setBusy(true); setError(null);
    try {
      const sameIntent = intent && JSON.stringify(intent.conditions) === JSON.stringify(converted.conditions) && intent.fact_revision_id === revision.id;
      const planned = sameIntent ? intent : await api.createIntent({ fact_revision_id: revision.id, conditions: converted.conditions }, keys.intent);
      setIntent(planned);
      const accepted = await api.createSearch({ intent_id: planned.id, max_candidates: 10 }, keys.search);
      rememberSearch(documentId, accepted.resource_id);
      navigate(`/searches/${accepted.resource_id}`);
    } catch (failure) {
      if (failure instanceof ApiError && failure.problem.code === 'FACT_REVISION_NOT_CURRENT') {
        setError('다른 화면에서 경력을 새 버전으로 저장했습니다. 최신 확정 경력을 불러왔으니 다시 시작하세요.');
        setIntent(null); refresh();
      } else {
        setError(describeError(failure));
      }
      // 서버가 거절한 요청(4xx)만 새 key로 바꾼다. 네트워크 오류는 서버가 이미 저장했을 수 있어 같은 key로 재시도한다.
      if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500) setKeys({ intent: crypto.randomUUID(), search: crypto.randomUUID() });
    } finally { setBusy(false); }
  };

  return <>
    <a className="back" href={reviewPath} onClick={event => { event.preventDefault(); navigate(reviewPath); }}>← 확정 경력으로</a>
    <section className="hero compact">
      <span className="eyebrow">U03 · 공고 찾기</span>
      <h1>확인한 경력으로 공고 찾기</h1>
      <p>{summary.document.filename} · 확정 경력 {revision.revision}번째 버전({new Date(revision.confirmed_at).toLocaleString('ko-KR')} 저장)</p>
    </section>
    {summary.document.data_origin === 'synthetic' && <div className="notice"><strong>합성 예시</strong><span>가상 이력서입니다. 검색이 mock 합성 공고인지 Liner 웹 검색인지는 결과 화면에 표시합니다.</span></div>}
    <ReviewPanel facts={revision.facts} revisionId={revision.id} />
    <div className="search-setup">
      <section className="panel" aria-labelledby="basis-title">
        <h2 id="basis-title">검색에 쓰는 확정 경력</h2>
        {preview.ok ? <>
          <ul className="chip-list">{searchable.map(fact => <li key={fact.id} className={`chip ${fact.category}`}>{fact.statement}</li>)}</ul>
          <p className="muted">확정 경력 중 직무·기술 항목만 검색어로 씁니다. 연락처·이름 등 개인정보는 넣지 않습니다. 담당 업무 문장은 추천 이유를 설명할 때 비교합니다.</p>
        </> : <div role="alert" className="error">{preview.message} <a href={reviewPath}>경력 다시 확인</a></div>}
      </section>
      <section className="panel" aria-labelledby="cond-title">
        <h2 id="cond-title" className="sr-only">희망 조건</h2>
        <ConditionForm draft={draft} onChange={next => { setDraft(next); setIntent(null); setKeys({ intent: crypto.randomUUID(), search: crypto.randomUUID() }); }} disabled={busy} />
      </section>
    </div>
    {error && <div role="alert" className="error">{error}</div>}
    <div className="action-bar">
      <button className="primary" disabled={busy || !preview.ok} onClick={start}>{busy ? '검색 작업을 만드는 중…' : '이 기준으로 공고 찾기'}</button>
    </div>
  </>;
}
