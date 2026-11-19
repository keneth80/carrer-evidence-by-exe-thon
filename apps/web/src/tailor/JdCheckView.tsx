import type { ResumeFact } from '../../../../packages/resume/src/types.ts';
import type { RequirementCheck, TailorTurn } from '../resume/api.ts';
import { stageSummary } from '../resume/progress.ts';

// 공고(JD) 맞춤 점검 결과(DECISIONS S1-18). 요구사항마다 충족·근거 약함·미기재와 근거 경력, 에이전트 질문을 보여 준다.
// 미기재는 '확정 경력에서 찾지 못함'이며 경험 없음이 아니다. 답하기를 누르면 입력창에 요구를 붙여 사용자가 직접 쓴다.

const STATUS: Record<RequirementCheck['status'], string> = { met: '충족', weak: '근거 약함', missing: '미기재' };
const IMPORTANCE: Record<RequirementCheck['importance'], string> = { required: '자격 요건', preferred: '우대', unknown: '요구' };

type Props = { turn: TailorTurn; facts: ResumeFact[]; busy: boolean; onAnswer: (text: string) => void };

export function JdCheckView({ turn, facts, busy, onAnswer }: Props) {
  const statementOf = (id: string) => facts.find(fact => fact.id === id)?.statement ?? null;
  const counts = (['met', 'weak', 'missing'] as const).map(status => `${STATUS[status]} ${turn.requirements.filter(item => item.status === status).length}`).join(' · ');
  return <div className="jd-check">
    <p className="jd-check-head"><strong>요구사항 점검표</strong> <span className="muted">{counts}</span></p>
    <ul className="jd-list">{turn.requirements.map(item => {
      const finding = turn.findings.find(found => found.requirement_id === item.requirement_id);
      const evidence = item.fact_ids.map(statementOf).filter((text): text is string => Boolean(text));
      return <li key={item.requirement_id} className={`jd-item ${item.status}`}>
        <div className="jd-item-head">
          <span className={`jd-status ${item.status}`}>{STATUS[item.status]}</span>
          <span className="tag">{IMPORTANCE[item.importance]}</span>
          <span className="jd-req">{item.requirement}</span>
        </div>
        {evidence.length > 0 ? <p className="jd-evidence">근거: {evidence.map(text => `“${text}”`).join(', ')}</p> : <p className="jd-evidence muted">{item.note}</p>}
        {evidence.length > 0 && item.status === 'weak' && <p className="jd-evidence muted">{item.note}</p>}
        {finding && <div className="jd-question">질문: {finding.question}
          <button type="button" className="ghost" disabled={busy} onClick={() => onAnswer(`‘${item.requirement}’ 관련: `)}>이 요구에 답하기</button></div>}
      </li>;
    })}</ul>
  </div>;
}

// 끝난 턴의 단계 요약과, 근거 검토에서 뺀 수정안의 이유.
export function TailorPipelineNote({ turn }: { turn: TailorTurn }) {
  const { pipeline } = turn;
  return <div className="supp-pipeline">
    <span className="fine-print">{pipeline.mode === 'single' ? '한 번 호출' : '단계별 처리'}: {stageSummary(pipeline.stages)}</span>
    {pipeline.changes_withheld && <p className="supp-withheld" role="note">근거 검토를 하지 못해 수정안은 보여 드리지 않았어요. 내가 말한 경력 후보는 그대로 확인할 수 있어요.</p>}
    {pipeline.dropped_changes.length > 0 && <details className="supp-dropped">
      <summary>근거 검토에서 뺀 수정안 {pipeline.dropped_changes.length}개 보기</summary>
      <ul>{pipeline.dropped_changes.map((item, index) => <li key={index}><span className="muted">“{item.text}”</span> — {item.reason} <span className="tag">{item.by === 'critic' ? 'AI 검토' : '규칙 검사'}</span></li>)}</ul>
    </details>}
  </div>;
}
