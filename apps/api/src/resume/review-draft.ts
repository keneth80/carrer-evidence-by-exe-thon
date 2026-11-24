import { FACT_LIMITS } from '../../../../packages/resume/src/confirm.ts';
import { codePointLength, codePointSlice, splitLines } from '../../../../packages/resume/src/source.ts';
import type { SourceText } from '../../../../packages/resume/src/source.ts';
import { FACT_CATEGORIES, REVIEW_SECTIONS } from '../../../../packages/resume/src/types.ts';
import type { DocumentEvidence, ExtractionWarning, FactReview, ResumeFact, ReviewSection } from '../../../../packages/resume/src/types.ts';
import { LEADING_BULLET } from '../../../../packages/resume/src/candidates.ts';
import { checkSupported } from '../../../../packages/tailor/src/guard.ts';
import { findSlop } from '../../../../packages/tailor/src/slop.ts';

export function validateReviewDraft(output: unknown, source: SourceText, documentId: string, warnings: ExtractionWarning[]) {
  const proposed = (output as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(proposed)) return null;
  const lines = source.pages.flatMap(page => splitLines(page.text).filter(line => line.text).map(line => ({ ...line, page })));
  const excluded = warnings.filter(warning => ['PERSONAL_INFO_EXCLUDED', 'PREFERENCE_NOT_FACT', 'NEGATED_OR_UNVERIFIED'].includes(warning.code));
  const facts: ResumeFact[] = [];
  const review: Record<string, FactReview> = {};
  const seen = new Set<string>();
  const addEntries = (entries: unknown[], section: ReviewSection) => {
    const members: ResumeFact[] = [];
    for (const candidate of entries) {
      if (facts.length >= FACT_LIMITS.maxFacts) break;
      const item = candidate as Partial<{ category: ResumeFact['category']; from: number; to: number; quote: string | null; text: string | null }> | null;
      if (!item?.category || !FACT_CATEGORIES.includes(item.category) || typeof item.from !== 'number' || typeof item.to !== 'number'
        || !Number.isInteger(item.from) || !Number.isInteger(item.to) || item.from > item.to) continue;
      const first = lines[item.from], last = lines[item.to];
      if (!first || !last || first.page !== last.page) continue;
      const range = codePointSlice(first.page.text, first.start, last.end);
      let quote = range;
      let start = first.start;
      if (item.quote !== null) {
        const quoted = typeof item.quote === 'string' ? item.quote.trim() : '';
        if (!quoted || quoted.length > FACT_LIMITS.maxStatement) continue;
        const pattern = quoted.split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
        const left = /^\d/.test(quoted) ? '(?<!\\d)' : '';
        const right = /\d$/.test(quoted) ? '(?!\\d)' : '';
        const matches = [...range.matchAll(new RegExp(left + pattern + right, 'gu'))];
        if (matches.length !== 1) continue;
        const [match] = matches;
        quote = match[0];
        start += codePointLength(range.slice(0, match.index));
      }
      const span = tidySpan(first.page.text, start, start + codePointLength(quote));
      const statement = span.quote.replace(/\s+/g, ' ');
      if (!statement || statement.length > FACT_LIMITS.maxStatement) continue;
      if (section !== 'sensitive' && excluded.some(warning => warning.page === first.page.page
        && warning.start !== null && warning.end !== null && span.start < warning.end && span.end > warning.start)) continue;
      const key = JSON.stringify([first.page.page, span.start, span.end]);
      if (seen.has(key)) continue;
      seen.add(key);
      const id = `fact_l_${facts.length + 1}`;
      const fact: ResumeFact = { id, category: item.category, statement,
        evidence: [{ kind: 'document', document_id: documentId, page: first.page.page, ...span }] };
      const wording = typeof item.text === 'string' ? item.text.trim().replace(/\s+/g, ' ') : '';
      const supported = section !== 'sensitive' && wording && wording !== fact.statement && wording.length <= FACT_LIMITS.maxStatement
        && !checkSupported(wording, [id], [fact]).length && !findSlop(wording).length;
      review[id] = { section, wording: supported ? wording : null, primary: true };
      members.push(fact);
      facts.push(fact);
    }
    return members;
  };

  for (const [index, group] of proposed.entries()) {
    if (!group || !REVIEW_SECTIONS.includes(group.section) || !Array.isArray(group.entries)) continue;
    const members = addEntries(group.entries, group.section);
    if (group.section !== 'career') continue;
    const title = [members.find(fact => fact.category === 'employer')?.statement ?? members.find(fact => fact.category === 'location')?.statement,
      members.find(fact => fact.category === 'period')?.statement].filter(Boolean).join(' · ');
    const career = { id: String(index), title: group.older_career_summary === true ? '이전 경력 요약' : title || '근무 이력' };
    for (const fact of members) review[fact.id].group = career;
    if (!Array.isArray(group.projects)) continue;
    for (const [at, project] of group.projects.entries()) {
      if (!project || !Array.isArray(project.entries)) continue;
      // 제목도 다른 항목과 같은 근거 검사를 거쳐야 화면의 프로젝트 이름으로 쓸 수 있다.
      const headings = addEntries(project.heading?.category === 'other' ? [project.heading] : [], 'career');
      const items = addEntries(project.entries, 'career');
      const annotation = { id: String(at), title: headings[0]?.statement ?? '프로젝트' };
      for (const fact of [...headings, ...items]) {
        review[fact.id].group = career;
        review[fact.id].project = annotation;
      }
    }
  }
  const resolved = withoutOverlaps(facts, review, source);
  return resolved.facts.some(fact => resolved.review[fact.id].section !== 'sensitive') ? resolved : null;
}

type Span = { start: number; end: number; quote: string };
const at = (fact: ResumeFact) => fact.evidence[0] as DocumentEvidence;
const SENTENCE_END = /[.!?。](?=\s)/g;

// 근거 구간 앞뒤 공백과 맨 앞 글머리표를 뺀다. 렌더러(PDF·Word)가 글머리표를 따로 붙여 "• •"가 되었다.
function tidySpan(text: string, start: number, end: number): Span {
  const raw = codePointSlice(text, start, end);
  const trimmed = raw.trimStart();
  const head = codePointLength(raw) - codePointLength(trimmed) + codePointLength(LEADING_BULLET.exec(trimmed)?.[0] ?? '');
  const quote = codePointSlice(raw, head, codePointLength(raw)).trimEnd();
  return { start: start + head, end: start + head + codePointLength(quote), quote };
}

function respan(fact: ResumeFact, text: string, start: number, end: number): ResumeFact | null {
  const span = tidySpan(text, start, end);
  return span.quote ? { ...fact, statement: span.quote.replace(/\s+/g, ' '), evidence: [{ ...at(fact), ...span }] } : null;
}

function lastSentenceEnd(text: string, from: number, to: number): number | null {
  const region = codePointSlice(text, from, to);
  const last = [...region.matchAll(SENTENCE_END)].at(-1);
  return last?.index === undefined ? null : from + codePointLength(region.slice(0, last.index + 1));
}

// 초안 범위가 겹치면 같은 문장이 두 항목에 들어가 확정 이력서에 중복된다(2026-11-23 실이력서 테스트, 66개 중 14쌍).
// 원문 글자는 바꾸지 않는다. 한 범위가 다른 범위 안에 있으면 큰 범위만 남기고, 한 줄을 나눠 쓰면 겹친 구간의
// 마지막 문장 끝에서 나눈다(문장 끝이 없으면 앞 항목이 가진다). 범위가 바뀐 항목의 다듬은 문구는 원래 범위를
// 보고 쓴 것이라 버린다. 민감정보 항목은 이력서에 들어가지 않으므로 대상이 아니다.
function withoutOverlaps(facts: ResumeFact[], review: Record<string, FactReview>, source: SourceText) {
  const open = (fact: ResumeFact) => review[fact.id].section !== 'sensitive';
  const order = new Map(facts.map((fact, index) => [fact.id, index]));
  const covers = (outer: ResumeFact, inner: ResumeFact) => {
    const a = at(outer), b = at(inner);
    return outer !== inner && open(outer) && a.page === b.page && a.start <= b.start && b.end <= a.end
      && (a.end - a.start > b.end - b.start || order.get(outer.id)! < order.get(inner.id)!);
  };
  const outer = facts.filter(fact => !open(fact) || !facts.some(other => covers(other, fact)));
  const textOf = (page: number | null) => source.pages.find(item => item.page === page)?.text ?? '';
  const placed: (ResumeFact | null)[] = [];
  for (const fact of outer.filter(open).sort((x, y) => (at(x).page ?? 0) - (at(y).page ?? 0) || at(x).start - at(y).start)) {
    let current: ResumeFact | null = fact;
    for (const [index, previous] of placed.entries()) {
      if (!current || !previous) continue;
      const a = at(previous), b = at(current);
      if (a.page !== b.page || b.start >= a.end) continue;
      const text = textOf(a.page);
      const cut = lastSentenceEnd(text, b.start, a.end) ?? a.end;
      placed[index] = respan(previous, text, a.start, cut);
      current = respan(current, text, cut, b.end);
    }
    placed.push(current);
  }
  const trimmed = new Map(placed.filter((fact): fact is ResumeFact => fact !== null).map(fact => [fact.id, fact]));
  const kept = outer.flatMap(fact => !open(fact) ? [fact] : trimmed.has(fact.id) ? [trimmed.get(fact.id)!] : []);
  const moved = (fact: ResumeFact) => {
    const now = at(fact), before = at(facts[order.get(fact.id)!]);
    return now.start !== before.start || now.end !== before.end;
  };
  const nextReview = Object.fromEntries(kept.map(fact => [fact.id, moved(fact) ? { ...review[fact.id], wording: null } : review[fact.id]]));
  return { facts: kept, review: nextReview };
}
