import { useEffect, useState } from 'react';
import { api, describeError } from '../resume/api.ts';
import type { ResumeRevision } from '../resume/api.ts';
import { navigate } from '../router.ts';
import { applyApi, STATE_LABELS } from '../apply/api.ts';
import type { History } from '../apply/api.ts';
import { ConditionForm, emptyDraft, toConditions } from '../search/ConditionForm.tsx';
import type { ConditionDraft } from '../search/ConditionForm.tsx';
import { automationApi, MODE_LABELS, STRATEGY_LABELS } from './api.ts';
import type { DocumentStrategy, PolicyMode, PolicyRevision } from './api.ts';

// U08 유사 공고 찾기 설정: 기준(지원 건·공고·이력서·PDF)을 보여주고 고정한 뒤, 모드·문서 전략·조건·한도를 정해 정책을 만든다.
// 정책 작성과 활성화를 나눈다: 저장된 내용(content hash)을 확인하고 동의해야 시작한다. 제출은 하지 않는다.

const EDITS = [['reorder', '항목 순서 조정'], ['summary', '핵심 요약 추가'], ['rewrite_with_facts', '확정 사실 범위의 문장 다듬기']] as const;

export function CampaignSetupPage({ applicationId }: { applicationId: string }) {
  const [history, setHistory] = useState<History | null>(null);
  const [resume, setResume] = useState<ResumeRevision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PolicyMode>('prepare');
  const [strategy, setStrategy] = useState<DocumentStrategy>('tailor_within_facts');
  const [edits, setEdits] = useState<string[]>(['reorder', 'summary']);
  const [draft, setDraft] = useState<ConditionDraft>(emptyDraft);
  const [excluded, setExcluded] = useState('');
  const [daily, setDaily] = useState(3);
  const [total, setTotal] = useState(5);
  const [days, setDays] = useState(7);
  const [policy, setPolicy] = useState<PolicyRevision | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    applyApi.history(applicationId).then(async value => {
      setHistory(value);
      setResume(await api.revision(value.application.current.resume_revision_id));
    }).catch(failure => setError(describeError(failure)));
  }, [applicationId]);

  if (error && !history) return <div className="error" role="alert">{error}</div>;
  if (!history || !resume) return <p className="muted">불러오는 중…</p>;
  const current = history.application.current;
  const job = history.jobs.find(item => item.id === current.job_snapshot_id)!;
  const artifact = history.artifacts.find(item => item.id === current.artifact_id);
  const binding = history.authorizations.at(-1)?.authorization.target.account_binding_id ?? history.observations[0]?.target.account_binding_id ?? null;
  const submitted = history.application.submission_state === 'submitted';

  const save = async () => {
    setError(null);
    const converted = toConditions(draft);
    if (!converted.ok) { setError(converted.message); return; }
    if (!binding) return;
    setBusy(true);
    try {
      const now = Date.now();
      setPolicy(await automationApi.createPolicy({
        policy_id: null, expected_parent_revision_id: null, mode, document_strategy: strategy, fact_revision_id: resume.fact_revision_id, seed_resume_revision_id: resume.id,
        fixed_artifact_id: strategy === 'fixed_document' ? current.artifact_id : null, conditions: converted.conditions, allowed_sites: ['self-form'], account_binding_ids: [binding],
        excluded_companies: excluded.split(/[,，]/).map(item => item.trim()).filter(Boolean), allowed_edits: strategy === 'fixed_document' ? [] : edits,
        daily_limit: daily, total_limit: total, budget_limit_micro_usd: 0, quota_timezone: 'Asia/Seoul', valid_from: new Date(now - 60_000).toISOString(), expires_at: new Date(now + days * 86_400_000).toISOString(),
      }, crypto.randomUUID()));
      setConsent(false);
    } catch (failure) { setError(describeError(failure)); } finally { setBusy(false); }
  };

  const start = async () => {
    if (!policy) return;
    setBusy(true);
    setError(null);
    try {
      const control = await automationApi.control(policy.policy_id);
      await automationApi.activate(policy.policy_id, { revision_id: policy.id, expected_generation: control.generation, accepted_content_hash: policy.content_hash, consent: true }, crypto.randomUUID());
      const campaign = await automationApi.createCampaign({ policy_revision_id: policy.id, seed_application_id: applicationId }, crypto.randomUUID());
      await automationApi.run(campaign.id, crypto.randomUUID());
      navigate(`/campaigns/${campaign.id}`);
    } catch (failure) { setError(describeError(failure)); } finally { setBusy(false); }
  };

  return <div className="apply-page">
    <a className="back" href={`/applications/${applicationId}`} onClick={event => { event.preventDefault(); navigate(`/applications/${applicationId}`); }}>← 지원서로</a>
    <section className="hero compact">
      <span className="eyebrow">U08 · 비슷한 공고 찾기</span>
      <h1>이 지원을 기준으로 비슷한 공고 찾기</h1>
      <p>기준은 시작할 때 고정됩니다. 자동으로 준비한 지원 건이 다음 탐색의 기준이 되지 않습니다. 이 단계에서는 어떤 공고에도 제출하지 않습니다.</p>
    </section>
    <section className="panel" aria-labelledby="seed-title">
      <h2 id="seed-title">고정할 기준</h2>
      {!submitted && <div className="notice warn-notice"><strong>아직 제출되지 않은 지원 건</strong><span>현재 상태: {STATE_LABELS[history.application.submission_state]}. 기준으로 쓸 수 있지만 지원 이력에 완료로 기록되지 않습니다.</span></div>}
      <dl className="artifact-meta">
        <div><dt>기준 공고</dt><dd>{job.company_name} · {job.title}</dd></div>
        <div><dt>이력서</dt><dd>{resume.revision}번째 버전 · {resume.state === 'final' ? '확정' : '확정 전'} · 블록 {resume.blocks.length}개</dd></div>
        <div><dt>확정 경력 버전</dt><dd className="source-url">{resume.fact_revision_id}</dd></div>
        {artifact && <div><dt>확정 PDF</dt><dd><a href={artifact.download_path} target="_blank" rel="noreferrer">{artifact.filename}</a></dd></div>}
        <div><dt>실행기</dt><dd>{binding ? 'Chrome 확장 연결됨(자체 테스트 폼)' : '없음'}</dd></div>
      </dl>
      {!binding && <p className="error" role="alert">이 지원 건을 Chrome 확장으로 한 번 폼 확인해야 정책을 만들 수 있습니다(사용할 실행기·사이트 계정 지정).</p>}
    </section>
    {!policy ? <section className="panel" aria-labelledby="policy-title">
      <h2 id="policy-title">찾는 방식</h2>
      <fieldset className="choice-group"><legend>모드</legend>
        {(['recommend', 'prepare'] as PolicyMode[]).map(item => <label key={item} className="check"><input type="radio" name="mode" checked={mode === item} onChange={() => setMode(item)} />{MODE_LABELS[item]}</label>)}
      </fieldset>
      <fieldset className="choice-group"><legend>서류</legend>
        {(['tailor_within_facts', 'fixed_document'] as DocumentStrategy[]).map(item => <label key={item} className="check"><input type="radio" name="strategy" checked={strategy === item} onChange={() => setStrategy(item)} />{STRATEGY_LABELS[item]}</label>)}
      </fieldset>
      {strategy === 'tailor_within_facts' && <fieldset className="choice-group"><legend>허용할 수정</legend>
        {EDITS.map(([value, label]) => <label key={value} className="check"><input type="checkbox" checked={edits.includes(value)} onChange={event => setEdits(list => event.target.checked ? [...list, value] : list.filter(item => item !== value))} />{label}</label>)}
        <p className="muted">새 성과·수치·자격은 추가하지 않습니다. 근거 검사를 통과한 변경만 적용합니다.</p>
      </fieldset>}
      {strategy === 'fixed_document' && <p className="muted">확정 PDF를 그대로 첨부합니다. 기준 공고 회사명·직무명이나 그 공고에만 맞춘 요약 문구가 있으면 서류를 만들지 않고 검토로 보냅니다.</p>}
      <h3 className="sub-title">희망 조건</h3>
      <ConditionForm draft={draft} onChange={setDraft} disabled={busy} />
      <div className="inline-grid">
        <label className="wide">제외할 회사(쉼표로 구분)<input value={excluded} onChange={event => setExcluded(event.target.value)} /></label>
        <label>하루 준비 한도<input type="number" min={1} max={20} value={daily} onChange={event => setDaily(Number(event.target.value))} /></label>
        <label>전체 준비 한도<input type="number" min={1} max={50} value={total} onChange={event => setTotal(Number(event.target.value))} /></label>
        <label>유효 기간(일)<input type="number" min={1} max={90} value={days} onChange={event => setDays(Number(event.target.value))} /></label>
      </div>
      <div className="action-row"><button className="primary" disabled={busy || !binding} onClick={save}>{busy ? '저장 중…' : '설정 저장'}</button></div>
    </section> : <section className="panel" aria-labelledby="confirm-title">
      <h2 id="confirm-title">설정 확인과 시작</h2>
      <dl className="artifact-meta">
        <div><dt>모드</dt><dd>{MODE_LABELS[policy.mode]}</dd></div>
        <div><dt>서류</dt><dd>{STRATEGY_LABELS[policy.document_strategy]}{policy.allowed_edits.length ? ` · 허용 수정 ${policy.allowed_edits.length}종` : ''}</dd></div>
        <div><dt>조건</dt><dd>{policy.conditions.length ? `${policy.conditions.length}개(필수 ${policy.conditions.filter(item => item.importance === 'required').length}개)` : '없음'}</dd></div>
        <div><dt>제외 회사</dt><dd>{policy.excluded_companies.join(', ') || '없음'}</dd></div>
        <div><dt>한도</dt><dd>하루 {policy.daily_limit}건 · 전체 {policy.total_limit}건</dd></div>
        <div><dt>유효 기간</dt><dd>{new Date(policy.expires_at).toLocaleString('ko-KR')}까지</dd></div>
        <div><dt>설정 hash</dt><dd className="source-url">{policy.content_hash}</dd></div>
      </dl>
      <label className="check confirm-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />위 설정으로 비슷한 공고를 찾고{policy.mode === 'prepare' ? ' 서류를 준비하는 것' : '는 것'}에 동의합니다. 제출은 공고마다 제가 직접 확인·승인합니다.</label>
      <div className="action-row">
        <button className="primary" disabled={!consent || busy} onClick={start}>{busy ? '시작 중…' : '시작'}</button>
        <button className="ghost" disabled={busy} onClick={() => setPolicy(null)}>설정 다시 고치기</button>
      </div>
    </section>}
    {error && <div className="error" role="alert">{error}</div>}
  </div>;
}
