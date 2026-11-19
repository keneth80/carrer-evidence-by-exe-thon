import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeError } from '../resume/api.ts';
import type { JobSnapshot } from '../resume/api.ts';
import { navigate } from '../router.ts';
import { applyApi, STAGE_LABELS, STATE_LABELS } from './api.ts';
import { automationApi, CAMPAIGN_LABELS } from '../automation/api.ts';
import type { Campaign } from '../automation/api.ts';
import type { Application, Device, External, Pairing } from './api.ts';

// U07 지원 이력: 제품에서 만든 지원 건(전송 상태·채용 단계 분리), 사용자가 기록한 외부 지원, 실행기(Chrome 확장) 연결.

type Row = { application: Application; job: JobSnapshot | null };

export function ApplicationsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [externals, setExternals] = useState<External[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, external] = await Promise.all([applyApi.list(), applyApi.externals()]);
      const jobs = await Promise.all(list.items.map(item => api.job(item.current.job_snapshot_id).catch(() => null)));
      setRows(list.items.map((application, index) => ({ application, job: jobs[index] })));
      setExternals(external.items);
    } catch (failure) { setError(describeError(failure)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return <div className="apply-page">
    <section className="hero compact">
      <span className="eyebrow">U07 · 지원 이력</span>
      <h1>지원 이력</h1>
      <p>제출 당시의 공고·파일·답변·승인·접수 근거를 다시 볼 수 있습니다. 접수 상태와 채용 진행 단계는 따로 기록합니다.</p>
    </section>
    {error && <div className="error" role="alert">{error}</div>}
    <section className="panel" aria-labelledby="apps-title">
      <h2 id="apps-title">Career Evidence로 준비한 지원</h2>
      {rows === null ? <p className="muted">불러오는 중…</p> : rows.length === 0
        ? <p className="muted">아직 지원 건이 없습니다. 공고에 맞춰 이력서를 확정하고 PDF를 만든 뒤 최종 제출본 화면에서 지원을 준비하세요.</p>
        : <ul className="apply-list">{rows.map(({ application, job }) => <li key={application.id}>
          <a href={`/applications/${application.id}`} onClick={event => { event.preventDefault(); navigate(`/applications/${application.id}`); }}>
            <strong>{job ? `${job.company_name} · ${job.title}` : application.job_key}</strong>
            <span className={`state-pill submission-${application.submission_state}`}>{STATE_LABELS[application.submission_state]}</span>
            <span className="muted">채용 단계: {STAGE_LABELS[application.recruitment_stage]} · 지원 내용 {application.current.revision}번째 · 최근 {new Date(application.updated_at).toLocaleString('ko-KR')}</span>
          </a>
        </li>)}</ul>}
    </section>
    <CampaignSection rows={rows ?? []} />
    <ExternalSection externals={externals} onCreated={load} />
    <DeviceSection />
  </div>;
}

function ExternalSection({ externals, onCreated }: { externals: External[]; onCreated: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ company_name: '', title: '', channel: '', applied_on: today, note: '' });
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await applyApi.createExternal({ job_snapshot_id: null, ...form }, key);
      setForm({ company_name: '', title: '', channel: '', applied_on: today, note: '' });
      setKey(crypto.randomUUID());
      onCreated();
    } catch (failure) { setError(describeError(failure)); }
  };
  const set = (name: keyof typeof form) => (event: { target: { value: string } }) => setForm(current => ({ ...current, [name]: event.target.value }));
  return <section className="panel" aria-labelledby="external-title">
    <h2 id="external-title">다른 경로로 지원한 기록</h2>
    <p className="muted">회사 홈페이지·다른 채용사이트에서 직접 지원한 기록입니다. 같은 공고(검색 결과에서 기록)는 다시 지원 준비를 막고, 회사·직무명만 같은 기록은 확인 안내에 씁니다.</p>
    {externals.length > 0 && <ul className="apply-list compact-list">{externals.map(item => <li key={item.id}><div>
      <strong>{item.company_name} · {item.title}</strong>
      <span className="muted">{item.applied_on} · {item.channel}{item.job_key ? ' · 검색 공고와 연결됨' : ''}{item.note ? ` · ${item.note}` : ''}</span>
    </div></li>)}</ul>}
    <form className="inline-grid" onSubmit={submit}>
      <label>회사<input value={form.company_name} onChange={set('company_name')} maxLength={100} required /></label>
      <label>직무<input value={form.title} onChange={set('title')} maxLength={100} required /></label>
      <label>지원 경로<input value={form.channel} onChange={set('channel')} maxLength={60} placeholder="예: 회사 채용 홈페이지" required /></label>
      <label>지원일<input type="date" value={form.applied_on} max={today} onChange={set('applied_on')} required /></label>
      <label className="wide">메모<input value={form.note} onChange={set('note')} maxLength={500} /></label>
      <div className="action-row wide"><button className="outline small" type="submit">외부 지원 기록 추가</button></div>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

export function DeviceSection() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { applyApi.devices().then(result => setDevices(result.items)).catch(failure => setError(describeError(failure))); }, []);
  useEffect(() => { load(); }, [load]);
  // 코드를 만든 뒤에는 연결이 끝났는지 몇 초마다 다시 읽는다.
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [pairing, load]);
  const create = async () => {
    setError(null);
    try { setPairing(await applyApi.pairing()); } catch (failure) { setError(describeError(failure)); }
  };
  const revoke = async (id: string) => {
    try { await applyApi.revokeDevice(id); load(); } catch (failure) { setError(describeError(failure)); }
  };
  const active = devices.filter(device => !device.revoked_at);
  return <section className="panel" aria-labelledby="device-title">
    <h2 id="device-title">Chrome 확장 연결</h2>
    <p className="muted">확장이 승인한 지원서만 입력·제출하도록 이 계정과 브라우저를 연결합니다. 확장에는 이력서 서비스의 비밀 키를 보내지 않습니다.</p>
    {active.length > 0 && <ul className="apply-list compact-list">{active.map(device => <li key={device.id}><div>
      <strong>{device.label}</strong><span className="muted">연결 {new Date(device.created_at).toLocaleString('ko-KR')} · 최근 확인 {new Date(device.last_seen_at).toLocaleString('ko-KR')}</span>
    </div><button className="ghost" onClick={() => revoke(device.id)}>연결 해제</button></li>)}</ul>}
    {pairing && <div className="pairing-code" role="status">
      <span>확장 패널에 입력할 연결 코드</span>
      <strong data-testid="pairing-code">{pairing.code}</strong>
      <span className="muted">{new Date(pairing.expires_at).toLocaleTimeString('ko-KR')}까지 한 번만 쓸 수 있습니다.</span>
    </div>}
    <div className="action-row"><button className="outline small" onClick={create}>확장 연결 코드 만들기</button></div>
    <details className="muted"><summary>확장 설치 방법(개발용)</summary>
      <ol><li>Chrome 주소창에 chrome://extensions 를 엽니다.</li><li>개발자 모드를 켜고 &quot;압축해제된 확장 프로그램을 로드&quot;로 저장소의 apps/extension 폴더를 선택합니다.</li><li>확장 아이콘을 눌러 패널을 열고 위 코드를 입력합니다.</li></ol>
    </details>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function CampaignSection({ rows }: { rows: Row[] }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  useEffect(() => { automationApi.campaigns().then(result => setCampaigns(result.items)).catch(() => setCampaigns([])); }, []);
  if (!campaigns.length) return null;
  const seedName = (id: string) => { const row = rows.find(item => item.application.id === id); return row?.job ? `${row.job.company_name} · ${row.job.title}` : '기준 지원 건'; };
  return <section className="panel" aria-labelledby="campaign-title">
    <h2 id="campaign-title">유사 공고 찾기</h2>
    <ul className="apply-list">{campaigns.map(item => <li key={item.id}>
      <a href={`/campaigns/${item.id}`} onClick={event => { event.preventDefault(); navigate(`/campaigns/${item.id}`); }}>
        <strong>{seedName(item.seed_application_id)} 기준</strong>
        <span className="state-pill">{CAMPAIGN_LABELS[item.state]}</span>
        <span className="muted">찾은 공고 {item.discovered_job_snapshot_ids.length}건 · 준비한 지원서 {item.application_ids.length}건 · {new Date(item.created_at).toLocaleString('ko-KR')}</span>
      </a>
    </li>)}</ul>
  </section>;
}
