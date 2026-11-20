import { useEffect, useState } from 'react';
import { usePathname } from './router.ts';
import { SessionGate } from './resume/SessionGate.tsx';
import { StartPage } from './resume/StartPage.tsx';
import { ReviewPage } from './resume/ReviewPage.tsx';
import { SearchSetupPage } from './search/SearchSetupPage.tsx';
import { SearchResultsPage } from './search/SearchResultsPage.tsx';
import { TailorPage } from './tailor/TailorPage.tsx';
import { FinalPage } from './tailor/FinalPage.tsx';
import { ApplicationsPage } from './apply/ApplicationsPage.tsx';
import { ApplicationPage } from './apply/ApplicationPage.tsx';
import { SelfFormIndex, SelfFormPage } from './demo/SelfFormPage.tsx';
import { CampaignSetupPage } from './automation/CampaignSetupPage.tsx';
import { CampaignPage } from './automation/CampaignPage.tsx';
import type { Priority, Decision } from '../../../packages/domain/src/index.ts';
import type { StarterPreview } from '../../../packages/shared/src/preview.ts';

const decisionText: Record<Decision, string> = {
  review: '지원 검토', needs_information: '추가 확인', hold: '보류',
};

function Preview() {
  const [priority, setPriority] = useState<Priority>('required');
  const [data, setData] = useState<StarterPreview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setData(null);
    fetch(`/api/starter/preview?remote=${priority}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`API 응답 ${response.status}`);
        return await response.json() as StarterPreview;
      })
      .then(value => {
        if (controller.signal.aborted) return;
        if (value.remote_priority !== priority || value.mode !== 'mock' || value.provenance !== 'fixture') throw new Error('예제 응답의 조건 또는 자료 구분이 다릅니다.');
        setData(value);
        setSelectedId(current => value.items.some(item => item.candidate.id === current) ? current : value.items[0]?.candidate.id ?? null);
      })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'API에 연결할 수 없습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [priority]);

  const selected = data?.items.find(item => item.candidate.id === selectedId);
  return <main className="shell">
    <section className="hero">
      <span className="eyebrow">CAREER EVIDENCE / INTEGRATED v0.7</span>
      <h1>나에게 맞는 기회,<br /><span>근거부터 살펴보세요.</span></h1>
      <p>같은 공고도 내 조건에 따라 판단이 달라집니다.<br />통합 개발 자료에 포함된 기반 확인 화면입니다.</p>
    </section>
    <div className="notice"><strong>합성 데이터 모드</strong><span>가상의 공고 3개를 사용합니다. 이력서 업로드·맞춤 편집·자동 지원은 개발할 기능입니다.</span></div>
    <section className="conditions" aria-label="예제 조건">
      <div><span className="small-label">조건 예제</span><h2>원격 근무를 얼마나 중요하게 보나요?</h2><p>필수에서 선호로 바꾸면 같은 근거의 평가가 달라집니다.</p></div>
      <label className="select-label">원격 근무
        <select aria-label="원격 근무 중요도" value={priority} onChange={event => setPriority(event.target.value as Priority)}>
          <option value="required">필수 조건</option><option value="preferred">선호 조건</option>
        </select>
      </label>
    </section>
    <div className="section-title"><h2>공고 비교 <span>03</span></h2><p>판단 기준 match.v1 · 원격 조건 1개만 평가</p></div>
    <div role="status" aria-live="polite" className="status-line">{loading ? '예제 근거를 불러오는 중…' : error ? '' : '조건 평가를 반영했습니다.'}</div>
    {error && <div role="alert" className="error">{error}. 터미널의 API 실행 상태를 확인하세요.</div>}
    <section className="job-grid" aria-label="합성 공고 목록" aria-busy={loading}>
      {data?.items.map(item => <article key={item.candidate.id} className={`job-card ${selectedId === item.candidate.id ? 'selected' : ''}`}>
        <div className="card-top"><span className="company">{item.candidate.company_name}</span><span className={`badge ${item.assessment.decision}`}>{decisionText[item.assessment.decision]}</span></div>
        <h3>{item.candidate.title}</h3>
        <p className="job-snippet">{item.candidate.snippet}</p>
        <p className="reason">{item.assessment.evaluations[0]?.reason}</p>
        <button className="outline" aria-pressed={selectedId === item.candidate.id} onClick={() => setSelectedId(item.candidate.id)}>판단 근거 보기 <span aria-hidden="true">↗</span></button>
      </article>)}
    </section>
    {selected && <section className="evidence" aria-labelledby="evidence-title">
      <div className="evidence-heading"><div><span className="small-label">EVIDENCE</span><h2 id="evidence-title">{selected.candidate.company_name}의 판단 근거</h2></div><span className="pill">합성 출처</span></div>
      <blockquote>{selected.facts.sources[0]?.excerpt}</blockquote>
      <p>{selected.assessment.summary}</p>
      <dl><div><dt>확인 상태</dt><dd>{selected.facts.claims[0]?.state === 'unknown' ? '자료에 정보 없음 · 불가로 단정하지 않음' : '예제 원문에 명시'}</dd></div><div><dt>예제 출처 주소</dt><dd className="source-url">{selected.candidate.source_url}</dd></div></dl>
      <p className="fine-print">.example 주소와 기업명은 개발용 가상 자료입니다. 근무 조건 외 역량·급여·지역은 아직 평가하지 않습니다.</p>
    </section>}
    <section className="next-step"><div><span className="small-label">다음 구현</span><h2>이제 실제 제품 흐름을 연결합니다.</h2><p>이력서 등록 → 추출 내용 확인 → 이력서 기반 공고 검색부터 구현하세요.</p></div><a className="text-link" href="/demo/apply">자체 테스트 폼 열기 →</a></section>
  </main>;
}

type ProductRoute = { page: 'start' } | { page: 'review' | 'search'; documentId: string } | { page: 'results'; searchId: string } | { page: 'tailor' | 'final'; sessionId: string }
  | { page: 'applications' } | { page: 'application'; applicationId: string } | { page: 'campaign_new'; applicationId: string } | { page: 'campaign'; campaignId: string };

function productPage(route: ProductRoute) {
  if (route.page === 'review') return <ReviewPage key={route.documentId} documentId={route.documentId} />;
  if (route.page === 'search') return <SearchSetupPage key={route.documentId} documentId={route.documentId} />;
  if (route.page === 'results') return <SearchResultsPage key={route.searchId} searchId={route.searchId} />;
  if (route.page === 'tailor') return <TailorPage key={route.sessionId} sessionId={route.sessionId} />;
  if (route.page === 'final') return <FinalPage key={route.sessionId} sessionId={route.sessionId} />;
  if (route.page === 'applications') return <ApplicationsPage />;
  if (route.page === 'application') return <ApplicationPage key={route.applicationId} applicationId={route.applicationId} />;
  if (route.page === 'campaign_new') return <CampaignSetupPage key={route.applicationId} applicationId={route.applicationId} />;
  if (route.page === 'campaign') return <CampaignPage key={route.campaignId} campaignId={route.campaignId} />;
  return <StartPage />;
}

function ResumeArea({ route }: { route: ProductRoute }) {
  return <main className="shell">
    <SessionGate>{(session, logout) => <>
      <div className="session-bar">
        <span>{session.mode === 'authenticated' ? '로컬 개발 세션' : '합성 전용 세션'} · 운영 로그인 아님</span>
        <button className="ghost" onClick={logout}>연결 해제</button>
      </div>
      {productPage(route)}
    </>}</SessionGate>
  </main>;
}

export function App() {
  const path = usePathname();
  // 상단 범위 문구가 실제 검색 모드(mock/Liner live)와 어긋나지 않도록 서버 health에서 읽는다.
  const [liveSearch, setLiveSearch] = useState(false);
  useEffect(() => {
    fetch('/api/health').then(response => response.json()).then(body => setLiveSearch(body?.live_search === 'implemented_liner_web')).catch(() => setLiveSearch(false));
  }, []);
  const review = /^\/resumes\/([a-zA-Z0-9_-]+)\/(review|search)$/.exec(path);
  const results = /^\/searches\/([a-zA-Z0-9_-]+)$/.exec(path);
  const tailoring = /^\/tailoring\/([a-zA-Z0-9_-]+)(\/final)?$/.exec(path);
  const application = /^\/applications\/([a-zA-Z0-9_-]+)$/.exec(path);
  const selfForm = /^\/demo\/apply\/([a-z0-9][a-z0-9-]{0,63})$/.exec(path);
  const campaignNew = /^\/campaigns\/new\/([a-zA-Z0-9_-]+)$/.exec(path);
  const campaign = /^\/campaigns\/([a-zA-Z0-9_-]+)$/.exec(path);
  const route: ProductRoute = review ? { page: review[2] as 'review' | 'search', documentId: review[1] } : results ? { page: 'results', searchId: results[1] }
    : tailoring ? { page: tailoring[2] ? 'final' : 'tailor', sessionId: tailoring[1] }
      : path === '/applications' ? { page: 'applications' } : application ? { page: 'application', applicationId: application[1] }
        : campaignNew ? { page: 'campaign_new', applicationId: campaignNew[1] } : campaign ? { page: 'campaign', campaignId: campaign[1] } : { page: 'start' };
  // 자체 테스트 폼은 별도 '사이트' 화면이라 제품 세션 없이 연다.
  const page = selfForm ? <SelfFormPage key={selfForm[1]} postingId={selfForm[1]} /> : path === '/demo/apply' ? <SelfFormIndex /> : path === '/preview' ? <Preview /> : <ResumeArea route={route} />;
  return <><header className="topbar"><a className="brand" href="/start"><span className="brand-icon">ce</span>Career Evidence</a><nav className="top-nav"><a href="/start">내 이력서</a><a href="/applications">지원 이력</a><a href="/preview">기반 진단(합성)</a></nav><span className="mode-label">이력서 등록 · {liveSearch ? 'Liner 웹 검색' : 'mock 검색'} · 맞춤 편집·PDF · 자체 폼 지원 · 유사 공고 준비</span></header>{page}<footer>Career Evidence · 근거를 확인하고, 다음 기회를 준비하세요.</footer></>;
}
