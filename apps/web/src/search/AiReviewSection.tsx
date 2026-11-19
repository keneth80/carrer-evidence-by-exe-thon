import { useEffect, useState } from 'react';
import { api, describeError } from '../resume/api.ts';
import type { AiReview } from '../resume/api.ts';
import { useLiveChat } from '../tailor/chatMode.ts';

// AI 1차 점검(DECISIONS S1-14): 버튼을 눌러야 요청한다(live면 유료 호출 1건). 결과는 안내·질문이며 확정 경력을 바꾸지 않는다.

export function AiReviewSection({ revisionId }: { revisionId: string }) {
  const live = useLiveChat();
  const [review, setReview] = useState<AiReview | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!reviewId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => api.aiReview(reviewId).then(value => {
      if (!alive) return;
      setReview(value);
      if (value.state === 'queued') timer = setTimeout(poll, 1500);
    }).catch(failure => { if (alive) setError(describeError(failure)); });
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [reviewId]);

  const request = async () => {
    setBusy(true); setError(null);
    try {
      // 같은 요청을 다시 보내도 같은 key를 써서 점검이 두 번 만들어지지 않게 한다. 끝난 뒤 새 점검은 새 key.
      const accepted = await api.createAiReview(revisionId, key);
      setReviewId(accepted.resource_id);
      setKey(crypto.randomUUID());
    } catch (failure) { setError(describeError(failure)); } finally { setBusy(false); }
  };
  const working = review?.state === 'queued' || (reviewId !== null && review === null);

  return <div className="ai-review">
    <h3>AI 점검 <span className="pill">{live ? 'Liner AI' : 'mock(규칙 기반 합성 응답)'}</span></h3>
    {live && <p className="muted">확정 경력이 Liner(외부 AI)로 전송됩니다(최대 60일 보관, 해외 AI 제공사 경유 가능, 이메일·전화번호는 가림). 요청마다 유료 호출 1건이 쓰입니다.</p>}
    <button className="outline small" disabled={busy || working} onClick={request}>{working ? '점검 중…' : review ? 'AI 점검 다시 받기' : 'AI 점검 받기'}</button>
    {error && <div className="error" role="alert">{error}</div>}
    {review?.state === 'failed' && <div className="error" role="alert">점검하지 못했어요({review.error_code}). 규칙 점검 결과는 위에서 그대로 볼 수 있습니다.</div>}
    {review?.state === 'succeeded' && <>
      {review.summary && <p>{review.summary}</p>}
      {review.items.length === 0 ? <p className="muted">보완할 점을 찾지 못했어요.</p>
        : <ul className="note-list">{review.items.map((item, index) => <li key={index}>
          <strong>{item.title}</strong> <span className="muted">{item.detail}</span>
          {item.question && <div className="muted">질문: {item.question}</div>}
        </li>)}</ul>}
      <p className="muted">AI 점검은 안내입니다. 확정 경력은 바뀌지 않았고, 보완은 원본 수정 후 다시 올리기 또는 공고 맞춤 대화에서 할 수 있어요.</p>
    </>}
  </div>;
}
