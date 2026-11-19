// Liner 응답의 설명 문장에서 내부 ID(fact_005, req_1, blk_new_1, said_…)를 지운다(사용자 요청 2026-11-19, DECISIONS S1-19).
// 프롬프트로도 막지만(persona.ts) 모델이 지키지 않을 수 있어 서버에서 한 번 더 지운다.
// 근거로 쓰는 필드(statement·text·before·after)와 ID 필드는 원문 대조에 쓰이므로 절대 바꾸지 않는다.

const ID = String.raw`(?:fact|blk|req|said)_[A-Za-z0-9_]+`;
const ID_GROUP = new RegExp(String.raw`\s*[(（\[]\s*${ID}(?:\s*[,，、/]\s*${ID})*\s*[)）\]]`, 'g');
const BARE_ID = new RegExp(String.raw`\s*${ID}\s*`, 'g');
const PROSE_KEYS = new Set(['reply', 'question', 'questions', 'detail', 'title', 'note', 'reason', 'summary']);

export function withoutInternalIds(text: string): string {
  return text.replace(ID_GROUP, '').replace(BARE_ID, ' ').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.?!)])/g, '$1').trim();
}

// 새 값을 돌려준다(입력은 바꾸지 않는다). 설명 문장 필드의 문자열(또는 문자열 배열)만 고친다.
export function scrubProse(value: unknown, key = ''): unknown {
  if (typeof value === 'string') return PROSE_KEYS.has(key) ? withoutInternalIds(value) : value;
  if (Array.isArray(value)) return value.map(item => scrubProse(item, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, scrubProse(item, name)]));
  return value;
}
