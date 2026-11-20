import { reviewFacts } from '../../../../packages/tailor/src/review.ts';
import type { FactLike } from '../../../../packages/tailor/src/types.ts';
import { AiReviewSection } from './AiReviewSection.tsx';
import { ExampleBox } from '../resume/ExampleBox.tsx';

// 1차 점검(규칙) 패널: 검색 전에 기본 이력서에서 보완하면 좋은 점과 직무별 문장 패턴을 보여 준다(DECISIONS S1-13).
// 사실을 바꾸지 않는다. 그대로 검색해도 되고, 보완은 원본 수정·다시 올리기 또는 공고 맞춤 대화에서 한다.

export function ReviewPanel({ facts, revisionId }: { facts: FactLike[]; revisionId: string }) {
  const review = reviewFacts(facts);
  const warns = review.findings.filter(item => item.severity === 'warn').length;
  return <section className="panel" aria-labelledby="review-title">
    <h2 id="review-title">기본 이력서 1차 점검 <span className="count">{review.findings.length}</span></h2>
    <p className="muted">아래 목록은 규칙 기반 점검입니다(외부 전송 없음). 확정 경력 {review.checked}개를 훑었고, 사실은 바꾸지 않습니다. {warns > 0 ? `먼저 볼 항목 ${warns}개가 있어요.` : '검색을 막는 문제는 없어요.'}</p>
    {review.findings.length === 0 ? <p>보완할 점을 찾지 못했어요.</p>
      : <ul className="note-list">{review.findings.map((item, index) => <li key={`${item.kind}-${index}`} className={item.severity === 'warn' ? 'miss' : ''}>
        <strong>{item.title}</strong> <span className="muted">{item.detail}</span>
        {item.question && <div className="muted">질문: {item.question}</div>}
        {item.example && <ExampleBox text={item.example} />}
      </li>)}</ul>}
    <AiReviewSection key={revisionId} revisionId={revisionId} />
    <details>
      <summary className="muted">{review.patterns.label} 문장 패턴 보기(합성 예시)</summary>
      <ul className="note-list">{review.patterns.principles.map(line => <li key={line}>{line}</li>)}</ul>
      <ul className="note-list">{review.patterns.examples.map(example => <li key={example.weak}>
        <span className="muted">약함</span> {example.weak} → <span className="muted">나음</span> {example.better} <span className="muted">({example.why})</span>
      </li>)}</ul>
    </details>
  </section>;
}
