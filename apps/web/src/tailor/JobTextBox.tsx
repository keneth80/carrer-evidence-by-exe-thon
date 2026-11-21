import { useState } from 'react';

// 공고 본문 붙여넣기(DECISIONS S1-28). 실시간 검색 공고는 요약(약 100자)만 저장돼 요구사항을 제대로 읽지 못한다.
// 사용자가 채용 사이트에서 본문을 복사해 넣으면 이 세션의 JD 점검·수정이 그 본문을 쓴다. Liner live 대화에서는 본문도 외부로 전송된다(대화 안내와 같음).

const MIN = 50;
const MAX = 20000;
type Props = { saved: string | null; sourceUrl: string | null; busy: boolean; onSave: (text: string) => void; onCheck: () => void };

export function JobTextBox({ saved, sourceUrl, busy, onSave, onCheck }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const length = text.trim().length;
  const ready = length >= MIN && length <= MAX;
  if (saved && !open) return <div className="job-text-box saved">
    <p><strong>붙여넣은 공고 본문</strong> <span className="muted">{saved.length.toLocaleString('ko-KR')}자</span></p>
    <pre className="job-content">{saved}</pre>
    <div className="row-actions">
      <button type="button" className="primary small" disabled={busy} onClick={onCheck}>이 본문으로 JD 점검받기</button>
      <button type="button" className="ghost" disabled={busy} onClick={() => { setText(saved); setOpen(true); }}>본문 고치기</button>
    </div>
  </div>;
  return <div className="job-text-box">
    <label htmlFor="job-text"><strong>공고 본문 붙여넣기</strong></label>
    <p className="fine-print">채용 사이트에서 주요 업무·자격 요건·우대 사항을 복사해 넣어 주세요.{sourceUrl && <> <a href={sourceUrl} target="_blank" rel="noreferrer noopener">공고 원문 열기</a></>}</p>
    <textarea id="job-text" value={text} maxLength={MAX} rows={8} placeholder="예: [주요 업무] … [자격 요건] … [우대 사항] …" onChange={event => setText(event.target.value)} />
    <div className="row-actions">
      <button type="button" className="primary small" disabled={busy || !ready} onClick={() => { onSave(text); setOpen(false); }}>공고 본문 저장</button>
      {saved && <button type="button" className="ghost" onClick={() => setOpen(false)}>취소</button>}
      <span className="fine-print" role="status">{length > 0 && length < MIN ? `${MIN}자 이상 붙여넣어 주세요.` : `${length.toLocaleString('ko-KR')} / ${MAX.toLocaleString('ko-KR')}자`}</span>
    </div>
  </div>;
}
