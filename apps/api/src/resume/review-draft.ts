import { FACT_LIMITS } from '../../../../packages/resume/src/confirm.ts';
import { codePointLength, codePointSlice, splitLines } from '../../../../packages/resume/src/source.ts';
import type { SourceText } from '../../../../packages/resume/src/source.ts';
import { FACT_CATEGORIES, REVIEW_SECTIONS } from '../../../../packages/resume/src/types.ts';
import type { ExtractionWarning, FactReview, ResumeFact, ReviewSection } from '../../../../packages/resume/src/types.ts';
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
      const statement = quote.replace(/\s+/g, ' ');
      if (!statement || statement.length > FACT_LIMITS.maxStatement) continue;
      const end = start + codePointLength(quote);
      if (section !== 'sensitive' && excluded.some(warning => warning.page === first.page.page
        && warning.start !== null && warning.end !== null && start < warning.end && end > warning.start)) continue;
      const key = JSON.stringify([first.page.page, start, end]);
      if (seen.has(key)) continue;
      seen.add(key);
      const id = `fact_l_${facts.length + 1}`;
      const fact: ResumeFact = { id, category: item.category, statement,
        evidence: [{ kind: 'document', document_id: documentId, page: first.page.page, start, end, quote }] };
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
  return facts.some(fact => review[fact.id].section !== 'sensitive') ? { facts, review } : null;
}
