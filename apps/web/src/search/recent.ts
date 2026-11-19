// 문서별 최근 검색 ID를 이 브라우저에만 기억한다(편의 기능). 검색 결과 자체는 서버 DB에 있다.
const keyFor = (documentId: string) => `ce.recentSearch.${documentId}`;

export function rememberSearch(documentId: string, searchId: string) {
  try { window.localStorage.setItem(keyFor(documentId), searchId); } catch { /* 저장소를 쓸 수 없으면 기억하지 않는다. */ }
}

export function recentSearch(documentId: string): string | null {
  try {
    const value = window.localStorage.getItem(keyFor(documentId));
    return value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}
