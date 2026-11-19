import { parseJobAttributes, valueLabel } from '../../../../packages/search/src/job-attributes.ts';
import type { MatchExplanation } from '../../../../packages/search/src/match.ts';
import type { FactLike } from '../../../../packages/search/src/types.ts';
import type { JobSnapshot } from '../resume/api.ts';

// 공고 카드와 상세. 추천 이유·확인할 조건은 저장된 공고와 확정 경력·조건에서 계산한 설명이며 합격 가능성이 아니다.

const STATE_LABEL: Record<string, string> = { met: '충족', unmet: '조건 미충족', unknown: '정보 없음·확인 필요', no_evidence: '근거 미확인' };
const FIELD_LABEL: Record<string, string> = { role: '희망 직무', seniority: '경력 수준', location: '근무 지역', work_mode: '근무 방식', employment_type: '고용 형태', annual_salary: '최소 연봉' };

function salaryText(job: JobSnapshot): string {
  const salary = parseJobAttributes(job.content_text).salary;
  if (!salary) return '연봉 정보 없음';
  if (salary.min !== null && salary.max !== null && salary.min !== salary.max) return `${valueLabel(salary.min)}~${valueLabel(salary.max)}`;
  if (salary.min !== null) return `${valueLabel(salary.min)}${salary.max === null ? ' 이상' : ''}`;
  return `${valueLabel(salary.max ?? 0)} 이하`;
}

// live 공고는 검색 요약만 받았다. 요약에서 조건을 읽어 충족·미충족으로 단정하지 않는다.
const isLive = (job: JobSnapshot) => job.data_origin === 'live';
const stateLabel = (job: JobSnapshot, state: string) => (isLive(job) && state === 'unmet' ? '확인 필요' : STATE_LABEL[state]);

function Attributes({ job }: { job: JobSnapshot }) {
  if (isLive(job)) return <ul className="job-attributes"><li className="unknown">근무 조건 확인 필요 · 검색 요약만 확인</li></ul>;
  const attributes = parseJobAttributes(job.content_text);
  const items = [
    attributes.location ?? '근무지 정보 없음',
    attributes.work_mode ? valueLabel(attributes.work_mode) : '근무 방식 정보 없음',
    attributes.employment_type ? valueLabel(attributes.employment_type) : '고용 형태 정보 없음',
    salaryText(job),
  ];
  return <ul className="job-attributes">{items.map(item => <li key={item} className={/정보 없음/.test(item) ? 'unknown' : ''}>{item}</li>)}</ul>;
}

export function JobCard({ job, explanation, selected, onSelect }: { job: JobSnapshot; explanation: MatchExplanation; selected: boolean; onSelect: () => void }) {
  const reasons = explanation.reasons.slice(0, 3);
  const checks = explanation.checks.slice(0, 3);
  return <article className={`job-card result ${selected ? 'selected' : ''}`}>
    <div className="card-top"><span className="company">{job.company_name}</span>{job.data_origin === 'synthetic' ? <span className="pill">합성 공고</span> : <span className="pill">Liner 웹 검색</span>}</div>
    <h3>{job.title}</h3>
    <Attributes job={job} />
    <div className="card-section">
      <h4>추천한 이유</h4>
      {reasons.length ? <ul>{reasons.map(reason => <li key={reason.requirement_id}>‘{reason.requirement}’ — 확정 경력 {reason.facts.map(fact => `‘${fact}’`).join(', ')}과 연결</li>)}</ul>
        : <p className="muted">요구 사항과 직접 연결된 경력은 없고, {isLive(job) ? '검색 요약' : '공고 원문'}에 검색어({explanation.matched_terms.join(', ') || '없음'})가 포함되어 찾았습니다.</p>}
    </div>
    <div className="card-section">
      <h4>확인할 조건</h4>
      {checks.length ? <ul>{checks.map((check, index) => <li key={index} className={`check-item ${check.state}`}><span className="state-tag">{stateLabel(job, check.state)}</span> {check.kind === 'condition' ? `${FIELD_LABEL[check.field]}${check.importance === 'required' ? '(필수)' : ''}: ` : ''}{check.detail}</li>)}</ul>
        : <p className="muted">입력한 조건과 공고 요구에서 확인할 항목을 찾지 못했습니다.</p>}
    </div>
    {isLive(job)
      ? <p className="fine-print">검색 {new Date(job.observed_at).toLocaleString('ko-KR')} · 출처 <a href={job.canonical_url} target="_blank" rel="noreferrer noopener">{job.site_id}</a> · 검색 요약만 확인(원문 확인 필요)</p>
      : <p className="fine-print">확인 {new Date(job.observed_at).toLocaleString('ko-KR')} · 출처 {job.site_id}</p>}
    <button className="outline" aria-pressed={selected} aria-controls="job-detail" onClick={onSelect}>상세 비교 보기 <span aria-hidden="true">↗</span></button>
  </article>;
}

// onTailor: 이 공고와 검색에 쓴 확정 경력으로 편집 세션을 만든다.
export function JobDetail({ job, explanation, facts, onTailor, tailoring }: { job: JobSnapshot; explanation: MatchExplanation; facts: FactLike[]; onTailor: () => void; tailoring: boolean }) {
  const linked = new Map(explanation.reasons.map(reason => [reason.requirement_id, reason]));
  const usedFacts = new Set(explanation.reasons.flatMap(reason => reason.fact_ids));
  return <section id="job-detail" className="evidence" aria-labelledby="job-detail-title">
    <div className="evidence-heading"><div><span className="small-label">공고 상세 · 경력 비교</span><h2 id="job-detail-title">{job.company_name} · {job.title}</h2></div>
      <span className="pill">{job.data_origin === 'synthetic' ? '합성 출처' : 'Liner 웹 검색 · 원문 확인 필요'}</span></div>
    <div className="compare-grid">
      <div>
        <h3>공고 요구</h3>
        {isLive(job) && job.requirements.length === 0 && <p className="muted">검색 요약만 받아 공고 요구 사항을 읽지 않았습니다. 원문에서 확인하세요.</p>}
        <ul className="requirement-list">{job.requirements.map(requirement => {
          const reason = linked.get(requirement.id);
          return <li key={requirement.id} className={reason ? 'linked' : requirement.importance === 'required' ? 'missing' : ''}>
            <span className="tag">{requirement.importance === 'required' ? '자격 요건' : requirement.importance === 'preferred' ? '우대' : '구분 없음'}</span> {requirement.text}
            <div className="muted">{reason ? `연결된 확정 경력: ${reason.facts.join(', ')}` : '확정 경력에서 근거를 찾지 못함 — 경험 없음으로 단정하지 않음'}</div>
          </li>;
        })}</ul>
        {explanation.conditions.length > 0 && <>
          <h3>희망 조건 확인</h3>
          <ul className="requirement-list">{explanation.conditions.map((result, index) => <li key={index} className={`check-item ${result.state}`}>
            <span className="state-tag">{stateLabel(job, result.state)}</span> {FIELD_LABEL[result.condition.field]}{result.condition.importance === 'required' ? '(필수)' : '(선호)'}: {result.detail}
          </li>)}</ul>
        </>}
      </div>
      <div>
        <h3>확정 경력</h3>
        <ul className="chip-list">{facts.filter(fact => fact.category === 'role' || fact.category === 'skill').map(fact => <li key={fact.id} className={`chip ${fact.category} ${usedFacts.has(fact.id) ? 'used' : ''}`}>{fact.statement}</li>)}</ul>
        <h3>{isLive(job) ? '검색 요약(원문 아님)' : '공고 원문'}</h3>
        <pre className="job-content">{job.content_text}</pre>
        <dl><div><dt>원문 주소</dt><dd className="source-url">{job.data_origin === 'synthetic' ? `${job.canonical_url} (합성 주소 · 접속 불가)` : /^https?:\/\//i.test(job.canonical_url) ? <a href={job.canonical_url} target="_blank" rel="noreferrer noopener">{job.canonical_url}</a> : job.canonical_url}</dd></div>
          <div><dt>모집 상태</dt><dd>{job.open_status === 'open' ? '모집 중' : job.open_status === 'closed' ? '마감' : '확인되지 않음'}</dd></div></dl>
      </div>
    </div>
    <div className="action-row">
      <button className="primary" disabled={tailoring} onClick={onTailor}>{tailoring ? '편집 세션을 여는 중…' : '이 공고에 맞춰 이력서 수정'}</button>
    </div>
  </section>;
}
