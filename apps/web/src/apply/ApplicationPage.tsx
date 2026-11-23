import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, describeError } from '../resume/api.ts';
import { navigate } from '../router.ts';
import { applyApi, CONCLUSION_LABELS, EVIDENCE_LABELS, STAGE_LABELS, STATE_LABELS, userAnswer } from './api.ts';
import type { Application, Attempt, History, Question, Stage } from './api.ts';
import { identityPrefill } from '../../../../packages/apply/src/identity.ts';
import { AttemptRecord } from './AttemptRecord.tsx';

// U06 지원서 작성·제출: 답변 저장 → Chrome 확장으로 폼 입력·확인 → 최종 확인·승인 → 접수 결과 → 채용 진행.
// 서버 상태를 기준으로 화면을 그린다. 승인은 확인한 지원 revision·payload hash·대상에 묶여 서버에서 다시 검증된다.

const SENT = ['running', 'submitted', 'submission_unknown'];
const ACTIVE = ['queued', 'running'];
const short = (hash: string) => `${hash.slice(0, 12)}…${hash.slice(-6)}`;

export function ApplicationPage({ applicationId }: { applicationId: string }) {
  const [data, setData] = useState<History | 'not_found' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const load = useCallback(async () => {
    try { setData(await applyApi.history(applicationId)); } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404) setData('not_found');
      else setError(describeError(failure));
    }
  }, [applicationId]);
  useEffect(() => { load(); }, [load, tick]);
  // 실행 대기·전송 중·결과 확인 중에는 서버 상태를 다시 읽는다.
  const polling = data && data !== 'not_found' && (ACTIVE.includes(data.application.submission_state) || data.attempts.some(item => item.state === 'dispatched'));
  useEffect(() => {
    if (!polling) return;
    const timer = setTimeout(() => setTick(value => value + 1), 2000);
    return () => clearTimeout(timer);
  }, [polling, tick]);

  if (data === null) return <p className="muted">불러오는 중…</p>;
  if (data === 'not_found') return <div className="error" role="alert">지원 건을 찾을 수 없습니다.</div>;
  const { application } = data;
  const job = data.jobs.find(item => item.id === application.current.job_snapshot_id) ?? data.jobs[0];
  const state = application.submission_state;
  const sent = SENT.includes(state);
  return <div className="apply-page">
    <a className="back" href="/applications" onClick={event => { event.preventDefault(); navigate('/applications'); }}>← 지원 이력</a>
    <section className="hero compact">
      <span className="eyebrow">U06 · 지원서 제출</span>
      <h1>{job.company_name} · {job.title}</h1>
      <p><span className={`state-pill submission-${state}`}>{STATE_LABELS[state]}</span> 채용 단계: {STAGE_LABELS[application.recruitment_stage]} · 지원 사이트: 자체 테스트 폼(개발용)</p>
      {data.source.kind === 'manual'
        ? <button className="outline small fit" onClick={() => navigate(`/campaigns/new/${application.id}`)}>이 지원을 기준으로 비슷한 공고 찾기</button>
        : <button className="ghost" onClick={() => navigate(`/campaigns/${data.source.campaign_id}`)}>유사 공고 자동 준비로 만든 지원서 · 대기함 보기</button>}
    </section>
    {job.data_origin === 'synthetic' && <div className="notice"><strong>합성 공고</strong><span>개발용 자체 테스트 폼으로만 제출합니다. 실제 기업에는 접수되지 않습니다.</span></div>}
    {data.external_matches.length > 0 && <div className="notice warn-notice"><strong>비슷한 외부 지원 기록</strong><span>{data.external_matches.map(item => `${item.applied_on} ${item.company_name} · ${item.title}(${item.channel})`).join(', ')}. 같은 공고인지 확인한 뒤 진행하세요.</span></div>}
    {error && <div className="error" role="alert">{error}</div>}
    {!sent && state !== 'submitted' && <>
      <AnswersStep data={data} onSaved={() => setTick(value => value + 1)} />
      <FormStep data={data} />
      <ApproveStep data={data} onDone={() => setTick(value => value + 1)} />
    </>}
    <ResultSection data={data} onChanged={() => setTick(value => value + 1)} />
    {state === 'submitted' && <StageSection data={data} onSaved={() => setTick(value => value + 1)} />}
    <HistorySection data={data} />
  </div>;
}

function AnswersStep({ data, onSaved }: { data: History; onSaved: () => void }) {
  const current = data.application.current;
  const initial = useMemo(() => Object.fromEntries(data.form.questions.map(question => [question.question_id, current.answers.find(item => item.question_id === question.question_id)?.answer ?? ''])), [data.form.questions, current]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 비어 있는 이름·이메일은 이전 지원서의 내 답변으로 채워 둔다. 저장 전까지는 초안이다.
  const [previous, setPrevious] = useState<Application[]>([]);
  useEffect(() => {
    let live = true;
    // 이전 지원서를 읽지 못하면 채우지 않고 빈칸으로 둔다(직접 입력하면 된다).
    applyApi.list().then(({ items }) => { if (live) setPrevious(items); }, () => undefined);
    return () => { live = false; };
  }, []);
  const prefill = useMemo(() => identityPrefill(data.application.id, current.answers, previous), [data.application.id, current.answers, previous]);
  useEffect(() => setValues({ ...initial, ...prefill }), [initial, prefill]);
  const artifact = data.artifacts.find(item => item.id === current.artifact_id);
  const changed = data.form.questions.some(question => (values[question.question_id] ?? '') !== initial[question.question_id]);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const answers = data.form.questions.filter(question => values[question.question_id] !== '').map(question => userAnswer(question, values[question.question_id]));
      await applyApi.update(data.application.id, { expected_revision: current.revision, job_snapshot_id: current.job_snapshot_id, resume_revision_id: current.resume_revision_id, artifact_id: current.artifact_id, answers }, crypto.randomUUID());
      onSaved();
    } catch (failure) { setError(describeError(failure)); } finally { setSaving(false); }
  };
  const field = (question: Question) => {
    const value = values[question.question_id] ?? '';
    const set = (next: string) => setValues(currentValues => ({ ...currentValues, [question.question_id]: next }));
    if (question.kind === 'checkbox') return <label key={question.question_id} className="check"><input type="checkbox" checked={value === '동의'} onChange={event => set(event.target.checked ? '동의' : '')} />{question.label}{question.required ? ' (필수)' : ''}</label>;
    return <label key={question.question_id} className="stack-field"><span>{question.label}{question.required ? ' (필수)' : ''}</span>
      {question.kind === 'textarea' ? <textarea value={value} maxLength={question.max_length} rows={4} onChange={event => set(event.target.value)} />
        : <input type={question.kind} value={value} maxLength={question.max_length} onChange={event => set(event.target.value)} />}
    </label>;
  };
  return <section className="panel" aria-labelledby="step1">
    <h2 id="step1">1. 제출할 내용</h2>
    {artifact && <p className="muted">이력서 파일: <a href={artifact.download_path} target="_blank" rel="noreferrer">{artifact.filename}</a> · SHA-256 {short(artifact.sha256)} (확정한 PDF 그대로 첨부합니다)</p>}
    {Object.keys(prefill).length > 0 && <p className="muted" role="status">이름·이메일은 이전 지원서에 쓴 답변을 가져왔습니다. 확인한 뒤 저장하세요.</p>}
    <div className="answer-fields">{data.form.questions.map(field)}</div>
    {data.answer_issues.length > 0 && !changed && <ul className="issue-list">{data.answer_issues.map(issue => <li key={issue.code + issue.message}>{issue.message}</li>)}</ul>}
    <div className="action-row"><button className="primary" disabled={!changed || saving} onClick={save}>{saving ? '저장 중…' : '답변 저장'}</button>{changed && <span className="muted">저장하면 새 지원 내용 버전이 만들어지고, 이전 폼 확인·승인은 다시 해야 합니다.</span>}</div>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function FormStep({ data }: { data: History }) {
  const current = data.application.current;
  const observation = data.observations.find(item => item.application_revision === current.revision);
  const ready = data.answer_issues.length === 0;
  return <section className="panel" aria-labelledby="step2">
    <h2 id="step2">2. Chrome 확장으로 폼 입력·확인</h2>
    {!ready ? <p className="muted">답변을 모두 저장하면 진행할 수 있습니다.</p> : <>
      <ol className="steps">
        <li>Chrome 확장 패널을 엽니다(처음이면 <a href="/applications" onClick={event => { event.preventDefault(); navigate('/applications'); }}>지원 이력</a>에서 연결 코드를 만들어 연결).</li>
        <li>패널의 <strong>지원 폼 열기</strong>로 <a href={data.form.target_url ?? '#'} target="_blank" rel="noreferrer">지원 폼</a>을 엽니다.</li>
        <li>패널의 <strong>폼 확인·입력</strong>을 누르면 답변을 넣고 PDF를 첨부한 뒤 다시 읽어 서버와 대조합니다. 제출은 하지 않습니다.</li>
      </ol>
      {!observation && <p className="muted" role="status">아직 이 내용으로 폼을 확인하지 않았습니다.</p>}
      {observation?.state === 'verified' && <div className="verify-box ok" role="status">
        <strong>폼 입력을 확인했습니다</strong>
        <span>{new Date(observation.created_at).toLocaleString('ko-KR')} · 답변 {data.form.questions.length}개 일치 · 첨부 파일 {observation.readback?.file?.name} SHA-256 {short(observation.readback?.file?.sha256 ?? '')} 일치</span>
      </div>}
      {observation && observation.state !== 'verified' && <div className="verify-box warn" role="status">
        <strong>{observation.state === 'mismatch' ? '그대로 진행할 수 없습니다' : '입력 전 폼 구조만 확인했습니다'}</strong>
        <ul>{observation.issues.map(issue => <li key={issue.code + issue.message}>{issue.message}</li>)}</ul>
      </div>}
    </>}
  </section>;
}

function ApproveStep({ data, onDone }: { data: History; onDone: () => void }) {
  const current = data.application.current;
  const observation = data.observations.find(item => item.application_revision === current.revision);
  const [checkedHash, setCheckedHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = data.application.submission_state;
  const verified = observation?.state === 'verified' && observation.payload_hash === current.payload_hash;
  const artifact = data.artifacts.find(item => item.id === current.artifact_id);
  const job = data.jobs.find(item => item.id === current.job_snapshot_id);
  // 확인 체크는 확인한 payload hash와 폼 구조 hash에 묶는다. 내용이 바뀌면 다시 확인해야 한다.
  const reviewKey = observation ? `${current.payload_hash}:${observation.target.form_snapshot_hash}` : null;
  const approve = async () => {
    if (!observation) return;
    setBusy(true);
    setError(null);
    try {
      const authorization = await applyApi.authorize(data.application.id, { expected_application_revision: current.revision, expected_payload_hash: current.payload_hash, target: observation.target, reviewed: true }, crypto.randomUUID());
      await applyApi.attempt(data.application.id, authorization.id, crypto.randomUUID());
      onDone();
    } catch (failure) { setError(describeError(failure)); } finally { setBusy(false); }
  };
  if (state === 'queued') return <section className="panel" aria-labelledby="step3"><h2 id="step3">3. 최종 확인과 제출 승인</h2>
    <div className="verify-box ok" role="status"><strong>제출을 승인했습니다</strong><span>Chrome 확장 패널이 열려 있으면 같은 폼에 다시 입력·확인한 뒤 한 번 제출합니다. 승인은 15분 뒤 만료됩니다.</span></div></section>;
  return <section className="panel" aria-labelledby="step3">
    <h2 id="step3">3. 최종 확인과 제출 승인</h2>
    {!verified ? <p className="muted">2단계에서 폼 입력을 확인하면 승인할 수 있습니다.</p> : <>
      <dl className="artifact-meta">
        <div><dt>회사·공고</dt><dd>{job?.company_name} · {job?.title}</dd></div>
        <div><dt>제출 파일</dt><dd>{artifact?.filename} · SHA-256 {short(current.artifact_sha256)}</dd></div>
        {current.answers.map(answer => <div key={answer.question_id}><dt>{answer.question_text}</dt><dd className="answer-text">{answer.answer}</dd></div>)}
        <div><dt>지원 주소</dt><dd className="source-url">{observation!.target.target_url}</dd></div>
        <div><dt>실행기·사이트</dt><dd>Chrome · {observation!.target.site_id} ({observation!.target.adapter_version}) · 폼 구조 {short(observation!.target.form_snapshot_hash)}</dd></div>
      </dl>
      <label className="check confirm-check"><input type="checkbox" checked={checkedHash === reviewKey} onChange={event => setCheckedHash(event.target.checked ? reviewKey : null)} />위 회사·공고·파일·답변으로 이 폼에 제출하는 것을 확인했습니다.</label>
      <div className="action-row"><button className="primary" disabled={checkedHash !== reviewKey || busy} onClick={approve}>{busy ? '승인 중…' : '승인하고 제출'}</button></div>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function ResultSection({ data, onChanged }: { data: History; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest: Attempt | undefined = data.attempts.at(-1);
  if (!latest) return null;
  const evidence = data.evidence.filter(item => item.attempt_id === latest.id);
  const stale = latest.state === 'dispatched' && latest.dispatch_started_at && Date.now() - Date.parse(latest.dispatch_started_at) > 60_000;
  const observe = async () => {
    setBusy(true);
    setError(null);
    try { await applyApi.observe(latest.id, crypto.randomUUID()); onChanged(); } catch (failure) { setError(describeError(failure)); } finally { setBusy(false); }
  };
  const message: Record<Attempt['state'], string> = {
    prepared: '확장이 제출을 실행하기를 기다리고 있습니다.',
    dispatched: '제출을 보냈고 접수 결과를 확인하고 있습니다. 다시 제출하지 마세요.',
    submitted: '사이트의 접수 기록으로 접수를 확인했습니다.',
    submission_unknown: '제출을 보냈지만 접수 여부를 확인하지 못했습니다. 다시 제출하지 말고 접수 결과 확인을 요청하세요.',
    not_submitted: '접수되지 않은 것으로 확정했습니다. 다시 지원하려면 확장에서 폼을 다시 확인한 뒤 새로 승인하세요.',
    failed_before_dispatch: '제출하기 전에 멈췄습니다(아무것도 보내지 않음). 원인을 확인한 뒤 다시 진행하세요.',
  };
  return <section className="panel" aria-labelledby="result-title">
    <h2 id="result-title">접수 결과</h2>
    <p className={latest.state === 'submitted' ? 'ok-text' : latest.state === 'submission_unknown' ? 'warn-text' : 'muted'} role="status">{message[latest.state]}{latest.error_code ? ` (${latest.error_code})` : ''}</p>
    {evidence.length > 0 && <ul className="evidence-list">{evidence.map(item => <li key={item.id}>
      <strong>{EVIDENCE_LABELS[item.kind]} · {CONCLUSION_LABELS[item.conclusion]}</strong>
      <span>{item.summary}</span>
      <span className="muted">{new Date(item.observed_at).toLocaleString('ko-KR')} · 근거 hash {short(item.evidence_hash)}</span>
    </li>)}</ul>}
    {(latest.state === 'submission_unknown' || stale) && <div className="action-row"><button className="outline small" disabled={busy} onClick={observe}>{busy ? '요청 중…' : '접수 결과 확인(재제출 아님)'}</button></div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function StageSection({ data, onSaved }: { data: History; onSaved: () => void }) {
  const [stage, setStage] = useState<Stage>(data.application.recruitment_stage === 'unknown' ? 'review' : data.application.recruitment_stage);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try { await applyApi.recordStage(data.application.id, { expected_application_revision: data.application.current.revision, stage, note }, crypto.randomUUID()); setNote(''); onSaved(); } catch (failure) { setError(describeError(failure)); }
  };
  return <section className="panel" aria-labelledby="stage-title">
    <h2 id="stage-title">채용 진행</h2>
    <p className="muted">접수 상태와 별개로, 회사에서 받은 안내를 직접 기록합니다. 답이 없다는 이유로 불합격으로 바꾸지 않습니다.</p>
    {data.recruitment_events.length > 0 && <ul className="evidence-list">{data.recruitment_events.map(item => <li key={item.id}><strong>{STAGE_LABELS[item.stage]}</strong><span>{item.note || '메모 없음'}</span><span className="muted">{new Date(item.observed_at).toLocaleString('ko-KR')} · 사용자 기록</span></li>)}</ul>}
    <div className="inline-grid">
      <label>단계<select value={stage} onChange={event => setStage(event.target.value as Stage)}>{(['review', 'interview', 'offer', 'rejected', 'withdrawn'] as Stage[]).map(item => <option key={item} value={item}>{STAGE_LABELS[item]}</option>)}</select></label>
      <label className="wide">메모<input value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="예: 1차 면접 안내 메일" /></label>
      <div className="action-row wide"><button className="outline small" onClick={save}>진행 단계 기록</button></div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function HistorySection({ data }: { data: History }) {
  const attempts = [...data.attempts].reverse();
  return <section className="panel" aria-labelledby="history-title">
    <h2 id="history-title">제출 당시 자료</h2>
    <p className="muted">각 시도는 승인한 지원 내용 버전·파일·답변·대상에 고정되어 있습니다. 이후 이력서를 고쳐도 아래 자료는 바뀌지 않습니다.</p>
    {attempts.length === 0 ? <p className="muted">아직 제출 시도가 없습니다.</p> : attempts.map(attempt => <AttemptRecord key={attempt.id} data={data} attempt={attempt} />)}
  </section>;
}
