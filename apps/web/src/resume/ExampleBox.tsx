import { hasBlank } from '../../../../packages/tailor/src/example.ts';

// 점검 항목의 작성 예시(DECISIONS S1-22). 예시는 사실이 아니라 틀이다: [빈칸]은 사용자가 실제 기록으로 채운다.
// '이 예시로 답하기'는 입력창에 넣기만 한다. 빈칸이 남은 채로는 보내지 않고(BLANK_LEFT), 서버도 후보로 만들지 않는다.

export const BLANK_LEFT = '빈칸 [ ]을 실제 내용으로 채우거나, 기록이 없으면 그 부분을 지운 뒤 보내 주세요.';

const PARTS = /(\[[^\]\n]*\])/;

export function ExampleBox({ text, onUse }: { text: string; onUse?: () => void }) {
  const blanks = hasBlank(text);
  return <div className="example-box">
    <span className="example-label">작성 예시</span>
    <p className="example-text">{text.split(PARTS).map((part, index) => PARTS.test(part) ? <mark key={index} className="blank">{part}</mark> : part)}</p>
    {blanks && <p className="fine-print">[ ] 빈칸은 실제 기록으로 채워 주세요. 기록이 없으면 그 부분을 지우면 돼요. 예시는 이력서에 바로 들어가지 않아요.</p>}
    {onUse && <button type="button" className="ghost" onClick={onUse}>이 예시로 답하기</button>}
  </div>;
}
