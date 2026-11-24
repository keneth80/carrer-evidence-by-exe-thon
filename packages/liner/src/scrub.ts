// Liner 응답의 설명 문장에서 내부 ID(fact_005, req_1, blk_new_1, said_…)를 지운다(사용자 요청 2026-11-19, DECISIONS S1-19).
// 프롬프트로도 막지만(persona.ts) 모델이 지키지 않을 수 있어 서버에서 한 번 더 지운다.
// 근거로 쓰는 필드(statement·text·before·after)와 ID 필드는 원문 대조에 쓰이므로 내부 ID 지우기를 하지 않는다.
// 보이지 않는 문자(hidden-chars.ts, S4-16)는 모든 문자열에서 지운다. 다만 원문 위치를 찾는 필드(검토 초안 quote,
// 맞춤 수정 before, 읽기 보정 parts[].text)는 원문 글자와 그대로 맞춰야 하므로 건드리지 않는다.
import { withoutHiddenChars } from '../../tailor/src/hidden-chars.ts';

const ID = String.raw`(?:fact|blk|req|said)_[A-Za-z0-9_]+`;
const ID_GROUP = new RegExp(String.raw`\s*[(（\[]\s*${ID}(?:\s*[,，、/]\s*${ID})*\s*[)）\]]`, 'g');
const BARE_ID = new RegExp(String.raw`\s*${ID}\s*`, 'g');
const PROSE_KEYS = new Set(['reply', 'question', 'questions', 'detail', 'title', 'note', 'reason', 'summary']);
const LOCATOR_KEYS = new Set(['quote', 'before']);
const LOCATOR_PARENTS = new Set(['parts']);

export function withoutInternalIds(text: string): string {
  return text.replace(ID_GROUP, '').replace(BARE_ID, ' ').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.?!)])/g, '$1').trim();
}

// 새 값을 돌려준다(입력은 바꾸지 않는다). 설명 문장 필드의 문자열(또는 문자열 배열)만 고친다.
// parent: 이 값을 담은 객체가 들어 있던 필드 이름(parts[].text를 가리기 위해).
export function scrubProse(value: unknown, key = '', parent = ''): unknown {
  if (typeof value === 'string') {
    if (LOCATOR_KEYS.has(key) || LOCATOR_PARENTS.has(parent)) return value;
    const visible = withoutHiddenChars(value);
    return PROSE_KEYS.has(key) ? withoutInternalIds(visible) : visible;
  }
  if (Array.isArray(value)) return value.map(item => scrubProse(item, key, parent));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, scrubProse(item, name, key)]));
  return value;
}
