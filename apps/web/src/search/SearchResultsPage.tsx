import { useCallback, useEffect, useRef, useState } from 'react';
import { valueLabel } from '../../../../packages/search/src/job-attributes.ts';
import { explainMatch } from '../../../../packages/search/src/match.ts';
import type { Condition } from '../../../../packages/search/src/types.ts';
import { api, ApiError, describeError } from '../resume/api.ts';
import type { DocumentSummary, FactRevision, JobSnapshot, SearchIntent, SearchRun, Task } from '../resume/api.ts';
import { navigate } from '../router.ts';
import { JobCard, JobDetail } from './JobCard.tsx';
import { rememberSession } from '../tailor/data.ts';

// U03 결과: 저장된 검색 작업·공고를 다시 읽는다. 처리 중이면 주기적으로 상태를 확인하고,
// 새로고침·API/worker 재시작 뒤에도 같은 URL에서 같은 결과를 보여준다.

type Loaded = { search: SearchRun; task: Task; intent: SearchIntent; revision: FactRevision; summary: DocumentSummary | null; jobs: JobSnapshot[] };

// 대기 중 polling에서는 작업 상태만 다시 읽는다. 문서 목록(최신 경력 버전 확인)·공고는 처음과 작업이 끝났을 때만 읽는다.
async function load(searchId: string, previous: Loaded | null): Promise<Loaded> {
  const search = await api.search(searchId);
  const task = await api.task(search.task_id);
  const finished = !['queued', 'running'].includes(search.state);
  if (previous && previous.search.id === search.id && !finished) return { ...previous, search, task };
  const intent = previous?.intent ?? await api.intent(search.intent_id);
  const [revision, documents, jobs] = await Promise.all([
    previous?.revision ?? api.factRevision(intent.fact_revision_id),
    api.documents(),
    Promise.all(search.job_snapshot_ids.map(id => api.job(id))),
  ]);
  const summary = documents.items.find(item => item.document.id === revision.document_id) ?? null;
  return { search, task, intent, revision, summary, jobs };
}

// 처음 30초는 1.2초마다, 그 뒤에는 5초마다 확인한다(worker가 꺼져 있을 때 요청을 줄인다).
const POLL_FAST_MS = 1200;
const POLL_SLOW_MS = 5000;
const FAST_POLLS = 25;

const FIELD_LABEL: Record<Condition['field'], string> = { role: '희망 직무', seniority: '경력 수준', location: '근무 지역', work_mode: '근무 방식', employment_type: '고용 형태', annual_salary: '최소 연봉' };
const conditionText = (condition: Condition) => `${FIELD_LABEL[condition.field]} ${condition.values.map(valueLabel).join('·')}${condition.field === 'annual_salary' ? ' 이상' : ''} (${condition.importance === 'required' ? '필수' : '선호'})`;

const FAILURE_TEXT: Record<string, string> = {
  SEARCH_ATTEMPTS_EXCEEDED: '작업이 여러 번 중단되어 검색을 마치지 못했습니다. 다시 검색해 주세요.',
  PROVIDER_TRANSMISSION_UNKNOWN: '검색 요청의 전송 여부를 확인할 수 없어 자동으로 다시 보내지 않았습니다.',
  SEARCH_INTENT_MISMATCH: '검색 계획이 작업 생성 당시와 달라 실행하지 않았습니다.',
  LINER_CALL_LIMIT: '설정한 Liner 호출 수 한도에 도달해 검색 요청을 보내지 않았습니다.',
  LINER_BUDGET_LIMIT: '설정한 Liner 검색 예산에 도달해 검색 요청을 보내지 않았습니다.',
  LINER_UNAUTHORIZED: 'Liner API 키가 거절되었습니다. 서버의 키 설정을 확인하세요. 자동으로 다시 보내지 않았습니다.',
  LINER_INSUFFICIENT_CREDITS: 'Liner 크레딧이 부족해 검색하지 못했습니다.',
  LINER_RATE_LIMITED: 'Liner 요청 한도에 걸렸습니다. 잠시 뒤 다시 검색하세요.',
  LINER_INVALID_REQUEST: 'Liner가 검색 요청 형식을 거절했습니다.',
  LINER_TRANSMISSION_UNKNOWN: '검색 요청의 처리 여부를 확인할 수 없어 자동으로 다시 보내지 않았습니다.',
  LINER_NO_SAFE_QUERY: '개인정보가 없는 검색어가 없어 검색 요청을 보내지 않았습니다.',
};

function Basis({ intent, revision, summary }: { intent: SearchIntent; revision: FactRevision; summary: DocumentSummary | null }) {
  const statements = new Map(revision.facts.map(fact => [fact.id, fact.statement]));
  const outdated = summary && summary.current_fact_revision_id !== revision.id;
  return <section className="panel basis" aria-labelledby="basis-title">
    <h2 id="basis-title">검색 기준</h2>
    <p>{summary?.document.filename ?? '이력서'} · 확정 경력 {revision.revision}번째 버전 · {intent.conditions.length ? intent.conditions.map(conditionText).join(' / ') : '희망 조건 없음'}</p>
    {outdated && <div className="notice"><strong>이전 경력 버전 기준</strong><span>이 검색 이후 경력이 새로 저장되었습니다. 이 결과는 그대로 보존되며, 최신 경력으로 다시 검색할 수 있습니다.</span></div>}
    <details>
      <summary>검색 기준 보기</summary>
      <ul className="query-list">{intent.queries.map((query, index) => <li key={index}><code>{query.query}</code><span className="muted"> ← 근거: {query.fact_ids.map(id => statements.get(id) ?? id).join(', ')}</span></li>)}</ul>
      <p className="muted">검색어는 확정 경력의 직무·기술 항목에서만 만들었고, 희망 조건은 공고 원문의 근무 조건과 비교합니다.</p>
    </details>
  </section>;
}

export function SearchResultsPage({ searchId }: { searchId: string }) {
  const [data, setData] = useState<Loaded | 'not_found' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [cancelKey] = useState(() => crypto.randomUUID());
  const [polls, setPolls] = useState(0);
  const latest = useRef(0);
  const current = useRef<Loaded | null>(null);

  const refresh = useCallback(() => {
    // 늦게 도착한 이전 응답이 최신 상태를 덮지 않게 마지막 요청만 반영한다.
    const ticket = ++latest.current;
    load(searchId, current.current).then(value => {
      if (ticket !== latest.current) return;
      current.current = value;
      setData(value); setError(null); setFailures(0); setPolls(count => count + 1);
    }).catch(failure => {
      if (ticket !== latest.current) return;
      if (failure instanceof ApiError && failure.status === 401) { window.location.assign('/start'); return; }
      if (failure instanceof ApiError && failure.status === 404) { setData('not_found'); return; }
      setError(describeError(failure)); setFailures(count => count + 1);
    });
  }, [searchId]);
  useEffect(() => { refresh(); }, [refresh]);

  const active = data && data !== 'not_found' && (data.search.state === 'queued' || data.search.state === 'running');
  useEffect(() => {
    if (!(active || (data === null && failures > 0)) || failures > 5) return;
    const delay = failures > 0 ? POLL_FAST_MS * 2 ** failures : polls > FAST_POLLS ? POLL_SLOW_MS : POLL_FAST_MS;
    const timer = window.setTimeout(refresh, delay);
    return () => window.clearTimeout(timer);
  }, [active, data, failures, polls, refresh]);
  const retry = () => { setFailures(0); setPolls(0); refresh(); };

  if (error && !data) return <div role="alert" className="error">{error} {failures > 5 && <button className="outline small" onClick={retry}>다시 시도</button>}</div>;
  if (!data) return <p role="status" className="status-line">검색 결과를 불러오는 중…</p>;
  if (data === 'not_found') return <div role="alert" className="error">이 검색을 찾을 수 없습니다. 다른 사용자로 연결했거나 없는 검색입니다. <a href="/start">내 이력서로</a></div>;

  const { search, task, intent, revision, summary, jobs } = data;
  const setupPath = `/resumes/${revision.document_id}/search`;
  const explanations = new Map(jobs.map(job => [job.id, explainMatch(revision.facts, intent.conditions, job, intent.queries)]));
  const selectedJob = jobs.find(job => job.id === selected);
  // 이 공고 + 이 검색에 쓴 확정 경력으로 편집 세션을 만든다. 경력이 새로 저장됐다면 서버가 409로 막는다.
  const startTailoring = async (jobId: string) => {
    setTailoring(true); setError(null);
    try {
      const session = await api.createSession({ job_snapshot_id: jobId, fact_revision_id: intent.fact_revision_id }, crypto.randomUUID());
      rememberSession(jobId, session.id);
      navigate(`/tailoring/${session.id}`);
    } catch (failure) {
      setError(failure instanceof ApiError && failure.problem.code === 'FACT_REVISION_NOT_CURRENT' ? '이 검색 이후 경력이 새로 저장되었습니다. 최신 경력으로 다시 검색한 뒤 수정을 시작하세요.' : describeError(failure));
    } finally { setTailoring(false); }
  };
  const cancel = async () => {
    setCanceling(true);
    try { await api.cancelTask(task.id, cancelKey); refresh(); } catch (failure) { setError(describeError(failure)); } finally { setCanceling(false); }
  };

  return <>
    <a className="back" href={setupPath} onClick={event => { event.preventDefault(); navigate(setupPath); }}>← 검색 조건으로</a>
    <section className="hero compact">
      <span className="eyebrow">U03 · 공고 추천</span>
      <h1>확정 경력으로 찾은 공고 <span className="count">{jobs.length}</span></h1>
      <p>검색 {new Date(search.created_at).toLocaleString('ko-KR')} · {search.provider_mode === 'mock' ? 'mock 검색(합성 공고)' : 'Liner 웹 검색 결과'}</p>
    </section>
    {search.provider_mode === 'mock' && <div className="notice"><strong>mock 검색</strong><span>개발용 합성 공고 목록에서 찾은 결과입니다. 실제 채용 공고가 아닙니다. 실제 검색은 서버를 LINER_MODE=live로 실행할 때 Liner로 합니다.</span></div>}
    {search.provider_mode === 'live' && <div className="notice"><strong>Liner 웹 검색 결과</strong><span>Liner 웹 검색으로 찾은 실제 웹 페이지입니다. 검색 요약만 확인했으므로 공고 내용·근무 조건·모집 여부는 원문 링크에서 확인해야 합니다(조건은 '확인 필요').</span></div>}
    <Basis intent={intent} revision={revision} summary={summary} />
    <div role="status" aria-live="polite" className="status-line">
      {search.state === 'queued' && '검색 작업을 기다리는 중… 새로고침하거나 서버를 다시 시작해도 작업이 이어집니다. (worker가 실행 중이어야 합니다)'}
      {search.state === 'running' && (task.cancel_requested ? '중지를 요청했습니다. 진행 중인 처리가 끝나면 결과를 저장하지 않고 멈춥니다.' : '공고를 찾는 중… 오래 걸리면 worker 실행 상태를 확인하세요.')}
      {active && polls > FAST_POLLS && ' (30초 넘게 진행 중이라 5초마다 확인합니다)'}
      {search.state === 'succeeded' && search.outcome === 'partial' && '일부 검색어 처리에 실패했습니다. 확인된 결과부터 보여줍니다.'}
    </div>
    {active && !task.cancel_requested && <button className="outline small" disabled={canceling} onClick={cancel}>{canceling ? '중지 요청 중…' : '검색 중지'}</button>}
    {search.state === 'failed' && <div role="alert" className="error">{FAILURE_TEXT[task.error_code ?? ''] ?? `검색에 실패했습니다(${task.error_code ?? '원인 미상'}).`} <a href={setupPath}>다시 검색</a></div>}
    {search.state === 'canceled' && <div role="status" className="panel">검색을 중지했습니다. 저장된 결과가 없습니다. <a href={setupPath}>다시 검색</a></div>}
    {search.state === 'succeeded' && search.outcome === 'empty' && <div role="status" className="panel empty-state">
      <strong>조건에 맞는 공고를 찾지 못했습니다.</strong>
      <p className="muted">검색 기준은 그대로 보존됩니다. 필수 조건을 선호로 바꾸거나, 경력 확인 화면에서 직무·기술 항목을 추가한 뒤 다시 검색해 보세요.</p>
      <a href={setupPath}>조건 바꿔 다시 검색</a>
    </div>}
    {error && <div role="alert" className="error">{error} {failures > 5 && <button className="outline small" onClick={retry}>다시 시도</button>}</div>}
    {jobs.length > 0 && <section className="job-grid results" aria-label="추천 공고 목록">
      {jobs.map(job => <JobCard key={job.id} job={job} explanation={explanations.get(job.id)!} selected={selected === job.id} onSelect={() => setSelected(current => current === job.id ? null : job.id)} />)}
    </section>}
    {selectedJob && <JobDetail job={selectedJob} explanation={explanations.get(selectedJob.id)!} facts={revision.facts} tailoring={tailoring} onTailor={() => startTailoring(selectedJob.id)} />}
  </>;
}
