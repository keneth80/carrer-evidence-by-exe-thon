import type { ResumeFact } from '../../../../packages/resume/src/types.ts';
import type { SuggestionSet, SupplementCandidate, SupplementTurn } from './api.ts';
import { ExampleBox } from './ExampleBox.tsx';
import { SuggestionPicker } from './SuggestionPicker.tsx';
import type { AdoptAction } from './SuggestionPicker.tsx';
import { categoryLabel } from './FactEditor.tsx';
import { stageSummary } from './progress.ts';
import { findingProgress, isDuplicateFinding } from './finding-state.ts';
import { DedupeBox } from './DedupeBox.tsx';
import type { FactChange } from './finding-state.ts';

// 보완 대화의 에이전트 한 턴. 점검 항목·질문은 안내, 후보는 사용자 문장(추가하면 확정 경력), 초안은 사실이 아닌 문장 제안이다.

type Props = {
  turn: SupplementTurn; busy: boolean; isAdded: (candidate: SupplementCandidate) => boolean;
  // 점검 당시 문장과 지금 문장(바뀌었으면). startFacts=null이면 시작 버전을 아직 못 불러온 것이다.
  factState: (id: string) => FactChange | null; startFacts: ResumeFact[] | null; headFacts: ResumeFact[];
  // 점검 항목별 추천 문장(S1-24). suggestionFor는 이 항목의 가장 최근 추천 응답, suggesting은 지금 만드는 중인 항목 순번.
  suggestionFor?: (index: number) => { set: SuggestionSet; reply: string } | null; suggesting?: number | null; canSuggest?: boolean;
  onSuggest?: (index: number) => void; onAdopt?: (index: number, action: AdoptAction) => void;
  // 중복 정리: 남길 문장 하나만 두고 나머지를 뺀다(모델 없음).
  onRemove?: (removeIds: string[]) => void;
  targetFor: (candidate: SupplementCandidate) => ResumeFact | null;
  // example이 있으면 '이 예시로 답하기'(입력창에 예시를 넣음), 없으면 질문만 붙인다.
  onAnswer: (question: string, example?: string) => void; onAdd: (candidate: SupplementCandidate) => void; onReplace: (candidate: SupplementCandidate, targetId: string) => void; onAdoptDraft: (text: string) => void;
};

// 끝난 턴의 단계 요약과, 근거 검토에서 뺀 초안의 이유(S1-17).
function PipelineNote({ turn }: { turn: SupplementTurn }) {
  const pipeline = turn.pipeline;
  if (!pipeline) return null;
  return <div className="supp-pipeline">
    <span className="fine-print">{pipeline.mode === 'single' ? '한 번 호출' : '단계별 처리'}: {stageSummary(pipeline.stages)}</span>
    {pipeline.drafts_withheld && <p className="supp-withheld" role="note">근거 검토를 하지 못해 다듬은 초안은 보여 드리지 않았어요. 후보(내가 쓴 문장)는 그대로 추가할 수 있어요.</p>}
    {pipeline.dropped_drafts.length > 0 && <details className="supp-dropped">
      <summary>근거 검토에서 뺀 초안 {pipeline.dropped_drafts.length}개 보기</summary>
      <ul>{pipeline.dropped_drafts.map((item, index) => <li key={index}><span className="muted">“{item.text}”</span> — {item.reason} <span className="tag">{item.by === 'critic' ? 'HR 전문가 검토' : '규칙 검사'}</span></li>)}</ul>
    </details>}
  </div>;
}

const PROGRESS_LABEL = { done: '반영함', partial: '일부 반영', open: null } as const;

export function SupplementTurnView({ turn, busy, isAdded, factState, startFacts, headFacts, targetFor, onAnswer, onAdd, onReplace, onAdoptDraft, suggestionFor, suggesting = null, canSuggest = false, onSuggest, onAdopt, onRemove }: Props) {
  return <div className="supp-turn">
    <p>{turn.reply}</p>
    <PipelineNote turn={turn} />
    {turn.findings.length > 0 && <ul className="supp-findings">
      {turn.findings.map((item, index) => {
        const remaining = item.fact_ids.filter(id => headFacts.some(fact => fact.id === id));
        // 중복 항목은 하나만 남으면(나머지를 뺐으면) 반영한 것이다.
        const deduped = isDuplicateFinding(item) && remaining.length === 1 && startFacts !== null;
        const progress = deduped ? PROGRESS_LABEL.done : PROGRESS_LABEL[findingProgress(item.fact_ids, startFacts, headFacts)];
        const targets = item.fact_ids.map(id => factState(id)).filter((state): state is FactChange => state !== null);
        return <li key={index} className={progress ? 'resolved' : undefined}>
        {progress && <span className="tag done">{progress}</span>} <strong>{item.title}</strong> <span className="muted">{item.detail}</span>
        {targets.length > 0 && <div className="fine-print">대상: {targets.map((state, at) => <span key={at} className="supp-target">{at > 0 && ', '}
          {state.changed ? <><del>“{state.text}”</del> → {state.replacedBy ? <ins>“{state.replacedBy}”</ins> : <em>지웠거나 바뀐 항목</em>}</> : `“${state.text}”`}
        </span>)}</div>}
        {item.question && <div className="supp-question">질문: {item.question} <button type="button" className="ghost" onClick={() => onAnswer(item.question!)}>이 질문에 답하기</button></div>}
        {item.example && <ExampleBox text={item.example} onUse={() => onAnswer(item.question ?? item.title, item.example!)} />}
        {(() => {
          const picked = suggestionFor?.(index) ?? null;
          // 지금 경력에 남아 있는 대상 문장만 바꿀 수 있다(이미 바꾼 문장은 '반영함').
          const ids = picked?.set.target_fact_ids ?? item.fact_ids;
          const targets = ids.map(id => headFacts.find(fact => fact.id === id)).filter((fact): fact is ResumeFact => Boolean(fact));
          if (isDuplicateFinding(item) && targets.length >= 2 && onRemove) return <DedupeBox facts={targets} busy={busy} onKeep={(_keep, removeIds) => onRemove(removeIds)} />;
          if (suggesting === index) return <p className="status-line" role="status">추천 문장을 만드는 중이에요(추천 문장 작성 → 근거 검토)…</p>;
          if (picked) return <SuggestionPicker key={picked.set.options.map(option => option.text).join('|')} set={picked.set} reply={picked.reply} targets={targets} busy={busy} onAdopt={action => onAdopt?.(index, action)} />;
          return canSuggest && !progress && onSuggest ? <button type="button" className="outline small suggest-cta" disabled={busy} onClick={() => onSuggest(index)}>문장 추천받기</button> : null;
        })()}
      </li>;
      })}
    </ul>}
    {turn.candidates.length > 0 && <div className="supp-block">
      <h4>경력 후보 <span className="fine-print">내가 말한 문장 그대로입니다. 맞으면 추가하세요.</span></h4>
      {turn.candidates.map((candidate, index) => {
        const added = isAdded(candidate);
        const target = added ? null : targetFor(candidate);
        return <div key={index} className="supp-card">
          <span className="tag added">{categoryLabel[candidate.category]}</span>
          <span>{candidate.statement}</span>
          {target && <span className="fine-print">비슷한 기존 항목: “{target.statement}”</span>}
          {!target && candidate.supplements_fact_id && factState(candidate.supplements_fact_id) && <span className="fine-print">보완 대상: “{factState(candidate.supplements_fact_id)!.text}”</span>}
          <span className="row-actions">
            {target && <button type="button" className="primary small" disabled={busy} onClick={() => onReplace(candidate, target.id)}>기존 항목 바꾸기</button>}
            <button type="button" className="outline small" disabled={busy || added} onClick={() => onAdd(candidate)}>{added ? '경력에 추가됨' : target ? '새 항목으로 추가' : '경력에 추가'}</button>
          </span>
        </div>;
      })}
    </div>}
    {turn.drafts.length > 0 && <div className="supp-block">
      <h4>다듬은 문장 초안 <span className="fine-print">HR 전문가 제안이며 아직 사실이 아닙니다. 쓰려면 내 답변으로 보내세요.</span></h4>
      {turn.drafts.map((draft, index) => <div key={index} className="supp-card draft">
        <span>{draft.text}</span>
        <span className="fine-print">{draft.note}</span>
        <button type="button" className="ghost" disabled={busy} onClick={() => onAdoptDraft(draft.text)}>이 문장으로 답하기</button>
      </div>)}
    </div>}
    {turn.questions.length > 0 && <ul className="supp-questions">{turn.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>}
  </div>;
}
