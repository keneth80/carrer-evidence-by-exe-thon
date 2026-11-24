// 보이지 않는 문자 지우기(사용자 요청 2026-11-24, DECISIONS S4-16). AI 응답에 제로폭 문자·방향 제어·태그 문자 같은
// 화면에 안 보이는 문자가 섞이면 이력서를 복사하거나 파일로 낼 때 AI가 쓴 흔적처럼 남는다. 이력서 문장에는 쓸 일이 없으므로 지운다.
// 특이한 공백(줄바꿈 없는 공백·좁은 공백·전각 공백 등)은 보통 공백으로 바꾼다. 줄바꿈·탭·일반 문장부호는 그대로 둔다.
// 이 패키지는 node 전용 모듈을 쓰지 않는다(브라우저의 Word 내려받기에서도 쓴다).

// U+00AD 소프트 하이픈, U+034F, U+061C, U+115F·U+1160·U+3164·U+FFA0 한글 채움 문자, U+17B4·U+17B5, U+180E,
// U+200B–U+200F 제로폭·방향 표시, U+202A–U+202E·U+2066–U+2069 방향 제어, U+2060–U+2064·U+206A–U+206F 서식 문자,
// U+FE00–U+FE0F·U+E0100–U+E01EF 변형 선택자, U+FEFF BOM, U+FFF9–U+FFFB, U+E0000–U+E007F 태그 문자(숨은 글자로 쓰인다).
const HIDDEN = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;
const ODD_SPACE = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/gu;

export function withoutHiddenChars(text: string): string {
  return text.replace(HIDDEN, '').replace(ODD_SPACE, ' ');
}
