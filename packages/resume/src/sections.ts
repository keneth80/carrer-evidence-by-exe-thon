import { codePointSlice } from './source.ts';
import type { SourcePage } from './source.ts';
import { parseWarning } from './types.ts';
import type { ResumeFact } from './types.ts';
import { UNUSED_NOTE } from './structure.ts';

// 확인 화면에서 '기타'로 몰리는 항목을 원문의 구역 제목으로 나눠 보여 주기 위한 계산(사용자 테스트 2026-11-21, DECISIONS S1-33).
// 모델이 항목에서 뺀 줄 가운데 제목처럼 보이는 줄("업무 접근 방식", "강점")을 찾아, 각 항목에 바로 앞의 제목을 붙인다.
// 표시에만 쓴다. 제목은 항목이 아니고 저장하지 않는다.

const SENTENCE_END = /(?:다|요|[.!?。])$/;
// 쪽 번호('Page 1 / 3'). 한글은 JS 정규식의 \\W에 걸리므로 \\W를 쓰지 않는다.
const PAGE_MARK = /^[^가-힣A-Za-z]*(?:page)?[^가-힣A-Za-z]*$/i;
const isHeading = (text: string) => text.length >= 2 && text.length <= 30 && /[가-힣A-Za-z]/.test(text) && !SENTENCE_END.test(text) && !PAGE_MARK.test(text);

// facts와 같은 길이의 배열. 근거가 원문 위치가 아니거나 앞에 제목이 없으면 null.
export function sectionTitles(facts: ResumeFact[], source: { pages: SourcePage[] } | null, warnings: string[]): (string | null)[] {
  if (!source) return facts.map(() => null);
  const rank = new Map(source.pages.map((page, at) => [page.page, at]));
  const headings = warnings.flatMap(raw => {
    const item = parseWarning(raw);
    const page = item && item.start !== null && item.end !== null && item.message.includes(UNUSED_NOTE) ? source.pages.find(candidate => candidate.page === item.page) : undefined;
    if (!item || !page) return [];
    const text = codePointSlice(page.text, item.start!, item.end!).replace(/^[\s[\]【】<>■□▶•·\-–—|#*]+|[\s[\]【】<>■□▶•·\-–—|#*:：]+$/g, '').replace(/\s{2,}/g, ' ');
    return isHeading(text) ? [{ order: (rank.get(item.page) ?? 0) * 1e9 + item.start!, text }] : [];
  }).sort((a, b) => a.order - b.order);
  return facts.map(fact => {
    const evidence = fact.evidence[0];
    if (!evidence || evidence.kind !== 'document') return null;
    const order = (rank.get(evidence.page) ?? 0) * 1e9 + evidence.start;
    return headings.filter(heading => heading.order < order).at(-1)?.text ?? null;
  });
}
