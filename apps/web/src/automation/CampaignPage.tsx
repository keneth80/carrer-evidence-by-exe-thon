import { useCallback, useEffect, useState } from 'react';
import { ApiError, describeError } from '../resume/api.ts';
import { navigate } from '../router.ts';
import { STATE_LABELS } from '../apply/api.ts';
import type { SubmissionState } from '../apply/api.ts';
import { automationApi, CAMPAIGN_LABELS, MODE_LABELS, QUEUE_LABELS, STRATEGY_LABELS } from './api.ts';
import type { Queue, QueueItem, QueueState } from './api.ts';

// U09 유사 공고 대기함: 고정 기준·정책, 후보별 유사 이유·조건·중복·준비 상태·필요한 확인·파일 버전·보류 이유.
// 준비된 건은 개별 지원서 화면에서 사용자가 답변·폼 확인·승인을 직접 진행해야 제출된다.

const GROUPS: QueueState[] = ['prepared', 'needs_review', 'eligible', 'discovered', 'queued', 'skipped'];
const CONDITION_STATE: Record<string, string> = { met: '충족', unmet: '미충족', unknown: '확인 필요' };
const FIELD_LABEL: Record<string, string> = { role: '직무', seniority: '경력', location: '근무지', work_mode: '근무 방식', employment_type: '고용 형태', annual_salary: '연봉' };

const VALUE_LABEL: Record<string, string> = { remote: '원격', hybrid: '하이브리드', onsite: '사무실 출근', full_time: '정규직', contract: '계약직', intern: '인턴' };
// 연봉은 만 원 단위로, 근무 방식·고용 형태는 한국어로 보여준다.
function conditionValue(field: string, values: (string | number)[]): string {
  if (field === 'annual_salary') return `${(Number(values[0]) / 10_000).toLocaleString('ko-KR')}만 원 이상`;
  return values.map(value => VALUE_LABEL[String(value)] ?? String(value)).join('/');
}

export function CampaignPage({ campaignId }: { campaignId: string }) {
  const [queue, setQueue] = useState<Queue | 'not_found' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const load = useCallback(() => {
    automationApi.queue(campaignId).then(setQueue).catch(failure => {
      if (failure instanceof ApiError && failure.status === 404) setQueue('not_found');
      else setError(describeError(failure));
    });
  }, [campaignId]);
  useEffect(load, [load, tick]);
  const working = queue && queue !== 'not_found' && queue.tasks.some(task => task.state === 'queued' || task.state === 'running');
  useEffect(() => {
    if (!working) return;
    const timer = setTimeout(() => setTick(value => value + 1), 1500);
    return () => clearTimeout(timer);
  }, [working, tick]);

  if (queue === null) return <p className="muted">불러오는 중…</p>;
  if (queue === 'not_found') return <div className="error" role="alert">캠페인을 찾을 수 없습니다.</div>;
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await action(); setTick(value => value + 1); } catch (failure) { setError(describeError(failure)); } finally { setBusy(false); }
  };
  const { campaign, policy, seed } = queue;
  const lastTask = queue.tasks[0];
  const closed = campaign.state === 'canceled' || campaign.state === 'completed';
  return <div className="apply-page campaign-page">
    <a className="back" href="/applications" onClick={event => { event.preventDefault(); navigate('/applications'); }}>← 지원 이력</a>
    <section className="hero compact">
      <span className="eyebrow">U09 · 유사 공고 대기함</span>
      <h1>{seed.job.company_name} · {seed.job.title} 기준</h1>
      <p><span className="state-pill">{CAMPAIGN_LABELS[campaign.state]}</span> {MODE_LABELS[policy.mode]} · {STRATEGY_LABELS[policy.document_strategy]} · 정책 {Date.parse(policy.expires_at) <= Date.now() ? '만료' : queue.policy_control.state === 'active' ? '활성' : queue.policy_control.state === 'paused' ? '일시중지' : queue.policy_control.state === 'revoked' ? '철회' : queue.policy_control.state}</p>
    </section>
    <div className="notice"><strong>제출 없음</strong><span>이 화면의 어떤 동작도 지원서를 제출하지 않습니다. 준비된 건은 지원서 화면에서 답변 확인·폼 확인·승인을 직접 해야 제출됩니다.</span></div>
    <section className="panel" aria-labelledby="seed-title">
      <h2 id="seed-title">고정된 기준</h2>
      <dl className="artifact-meta">
        <div><dt>기준 지원 건</dt><dd><a href={`/applications/${seed.application_id}`} onClick={event => { event.preventDefault(); navigate(`/applications/${seed.application_id}`); }}>{seed.job.company_name} · {seed.job.title}</a> · 지원 내용 {seed.application_revision}번째 · {STATE_LABELS[seed.submission_state as SubmissionState] ?? seed.submission_state}</dd></div>
        <div><dt>기준 PDF</dt><dd><a href={seed.artifact.download_path} target="_blank" rel="noreferrer">{seed.artifact.filename}</a></dd></div>
        <div><dt>조건</dt><dd>{policy.conditions.length ? policy.conditions.map(item => `${FIELD_LABEL[item.field] ?? item.field} ${conditionValue(item.field, item.values)}(${item.importance === 'required' ? '필수' : '선호'})`).join(', ') : '없음'}</dd></div>
        <div><dt>한도</dt><dd>하루 {policy.daily_limit}건 · 전체 {policy.total_limit}건 · {new Date(policy.expires_at).toLocaleDateString('ko-KR')}까지</dd></div>
      </dl>
      <div className="action-row">
        <button className="outline small" disabled={busy || closed || !!working} onClick={() => act(() => automationApi.run(campaignId, crypto.randomUUID()))}>{working ? '찾는 중…' : '다시 찾기'}</button>
        {campaign.state === 'active' && <button className="ghost" disabled={busy} onClick={() => act(() => automationApi.pause(campaignId, crypto.randomUUID()))}>일시중지</button>}
        {!closed && <button className="ghost" disabled={busy} onClick={() => act(() => automationApi.cancel(campaignId, crypto.randomUUID()))}>캠페인 종료</button>}
      </div>
      {lastTask && <p className="muted" role="status">최근 탐색: {lastTask.state === 'succeeded' ? '완료' : lastTask.state === 'failed' ? `실패(${lastTask.error_code})` : lastTask.state === 'canceled' ? '중지됨' : '진행 중'} · {new Date(lastTask.updated_at).toLocaleString('ko-KR')}</p>}
    </section>
    {error && <div className="error" role="alert">{error}</div>}
    {queue.items.length === 0 ? <section className="panel"><p className="muted">{working ? '비슷한 공고를 찾고 있습니다.' : '아직 찾은 공고가 없습니다.'}</p></section>
      : GROUPS.filter(group => queue.items.some(item => item.state === group)).map(group => <section key={group} className="panel" aria-labelledby={`group-${group}`}>
        <h2 id={`group-${group}`}>{QUEUE_LABELS[group]} <span className="count">{queue.items.filter(item => item.state === group).length}</span></h2>
        {group === 'skipped' ? <details><summary className="muted">건너뛴 공고와 이유 보기</summary>{queue.items.filter(item => item.state === group).map(item => <QueueCard key={item.job.id} item={item} />)}</details>
          : queue.items.filter(item => item.state === group).map(item => <QueueCard key={item.job.id} item={item} />)}
      </section>)}
  </div>;
}

function QueueCard({ item }: { item: QueueItem }) {
  const { evaluation } = item;
  return <article className="queue-card">
    <header>
      <strong>{item.job.company_name} · {item.job.title}</strong>
      <span className={`state-pill queue-${item.state}`}>{QUEUE_LABELS[item.state]}</span>
      <span className="score">유사도 {Math.round(evaluation.score * 100)}%</span>
    </header>
    <ul className="reason-list">{evaluation.reasons.map(reason => <li key={reason.kind} className={reason.matched ? 'hit' : 'miss'}>{reason.text}</li>)}</ul>
    {evaluation.conditions.length > 0 && <p className="muted">조건: {evaluation.conditions.map(cond => `${FIELD_LABEL[cond.field] ?? cond.field} ${CONDITION_STATE[cond.state] ?? cond.state}(${cond.detail})`).join(' · ')}</p>}
    {evaluation.needs.length > 0 && <div className="verify-box warn"><strong>{item.state === 'prepared' ? '제출 전 직접 할 일' : '확인이 필요한 이유'}</strong><ul>{evaluation.needs.map(need => <li key={need}>{need}</li>)}</ul></div>}
    {evaluation.notes.length > 0 && <ul className="note-list">{evaluation.notes.map(note => <li key={note}>{note}</li>)}</ul>}
    {evaluation.document && <p className="muted">서류: {STRATEGY_LABELS[evaluation.document.strategy]} · <a href={`/api/v1/artifacts/${evaluation.document.artifact_id}/content`} target="_blank" rel="noreferrer">{evaluation.document.filename}</a> · SHA-256 {evaluation.document.artifact_sha256.slice(0, 12)}…</p>}
    {item.application_id && <div className="action-row"><button className="primary small" onClick={() => navigate(`/applications/${item.application_id}`)}>지원서 열기{item.application_state ? ` · ${STATE_LABELS[item.application_state as SubmissionState] ?? item.application_state}` : ''}</button></div>}
  </article>;
}
