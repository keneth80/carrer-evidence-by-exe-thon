// Liner 응답을 기다리는 동안 지루하지 않게 보여 주는 표시(사용자 요청 2026-11-24, DECISIONS S1-39).
// 연필이 막대를 따라 밑줄을 그으며 움직인다. 진행률이 아니라 '일하는 중'이라는 표시라서 화면 읽기 프로그램에는 문구만 알린다.
// 움직임 줄이기 설정이면 연필과 점이 멈춘다(CSS).

export const HR_REVIEWING_TEXT = 'HR 담당자가 검토중입니다';

export function HrReviewing({ text = HR_REVIEWING_TEXT }: { text?: string }) {
  return <div className="hr-reviewing" role="status">
    <p className="hr-reviewing-text">{text}<span className="hr-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></p>
    <div className="hr-track" aria-hidden="true">
      <span className="hr-ink" />
      <span className="hr-pencil"><span className="hr-pencil-tip">✏️</span></span>
    </div>
  </div>;
}
