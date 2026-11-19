// 검색 질의와 조건에 들어가면 안 되는 개인정보 패턴. 확정 사실에도 사용자가 원문 줄을 직접 추가할 수 있으므로
// 검색 계획을 만들 때 다시 확인한다(CLAUDE.md 불변 조건: 연락처·불필요한 개인정보를 검색 질의에서 제외).

const PATTERNS: RegExp[] = [
  /[\w.+-]+@[\w-]+(\.[\w-]+)+/, // 이메일
  /(\+?82[-.\s]?0?1\d|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}/, // 전화번호(+82 10-…, 010-…, 02-…)
  /https?:\/\/|www\./i, // 개인 사이트·SNS 주소
  // scheme 없는 주소(github.com/아이디 등). 'Next.js'·'Socket.io' 같은 기술명은 경로가 없으므로 걸리지 않는다.
  /\b[\w-]+(\.[\w-]+)*\.(com|net|org|io|kr|me|dev|app|site|so|page|blog|xyz|ai)\/[\w@~-]/i,
  /\b(github\.com|linkedin\.com|notion\.site|velog\.io|tistory\.com|medium\.com|brunch\.co\.kr|blog\.naver\.com)\b/i,
  /[가-힣\d]+(로|길)\s*\d+|\d+\s*번지/, // 도로명·지번 상세 주소
  /\d{6}\s*-\s*[1-4]\d{6}/, // 주민등록번호
  /(19|20)\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?\s*(생|출생)/, // 생년월일
  /(이름|성명|연락처|주소|생년월일|휴대폰|전화)\s*[:：]/,
];

export function containsPersonalInfo(text: string): boolean {
  return PATTERNS.some(pattern => pattern.test(text));
}
