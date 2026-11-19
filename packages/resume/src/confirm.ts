import { createHash } from 'node:crypto';
import { findPage, statementWithinEvidence } from './source.ts';
import type { SourceText } from './source.ts';
import { FACT_CATEGORIES } from './types.ts';
import type { DocumentEvidence, EvidenceReference, ResumeFact, UserStatementEvidence } from './types.ts';

export const FACT_LIMITS = { maxFacts: 300, maxStatement: 1000, maxEvidence: 10 } as const;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export type FactValidation = { ok: true; facts: ResumeFact[] } | { ok: false; code: string; message: string; index?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type PageChars = (page: number | null) => string[] | undefined;

function pageCharsCache(source: SourceText): PageChars {
  const cache = new Map<number | null, string[]>();
  return page => {
    if (!cache.has(page)) {
      const found = findPage(source, page);
      if (!found) return undefined;
      cache.set(page, Array.from(found.text));
    }
    return cache.get(page);
  };
}

// 대화 진술 근거 조회. 서버가 같은 workspace의 사용자 메시지만 돌려준다(assistant 메시지는 근거가 될 수 없다).
// confirmedAt: 이전 revision에 이미 있던 근거면 그 시각을, 새 근거면 서버의 현재 시각을 돌려준다.
export type StatementLookup = { message(messageId: string): { content: string } | undefined; confirmedAt(messageId: string, quote: string): string };

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

function checkStatement(value: Record<string, unknown>, statements: StatementLookup | undefined): UserStatementEvidence | string {
  if (!statements) return 'USER_STATEMENT_NOT_AVAILABLE';
  if (Object.keys(value).sort().join() !== 'confirmed_at,kind,message_id,quote') return 'EVIDENCE_INVALID';
  const { message_id, quote } = value;
  if (typeof message_id !== 'string' || !ID_PATTERN.test(message_id) || typeof quote !== 'string' || !quote.trim()) return 'EVIDENCE_INVALID';
  const message = statements.message(message_id);
  if (!message) return 'USER_STATEMENT_NOT_FOUND';
  if (!squash(message.content).includes(squash(quote))) return 'EVIDENCE_QUOTE_MISMATCH';
  return { kind: 'user_statement', message_id, quote: squash(quote), confirmed_at: statements.confirmedAt(message_id, squash(quote)) };
}

function checkEvidence(value: unknown, documentId: string, pageChars: PageChars, statements?: StatementLookup): EvidenceReference | string {
  if (!isRecord(value)) return 'EVIDENCE_INVALID';
  if (value.kind === 'user_statement') return checkStatement(value, statements);
  if (value.kind !== 'document') return 'EVIDENCE_INVALID';
  const keys = Object.keys(value).sort().join();
  if (keys !== 'document_id,end,kind,page,quote,start') return 'EVIDENCE_INVALID';
  const { document_id, page, start, end, quote } = value;
  if (document_id !== documentId) return 'EVIDENCE_OTHER_DOCUMENT';
  if (page !== null && !(Number.isInteger(page) && (page as number) >= 1)) return 'EVIDENCE_INVALID';
  if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 0 || (end as number) <= (start as number)) return 'EVIDENCE_RANGE_INVALID';
  if (typeof quote !== 'string' || quote.trim().length === 0) return 'EVIDENCE_INVALID';
  const chars = pageChars(page as number | null);
  if (!chars) return 'EVIDENCE_PAGE_NOT_FOUND';
  if ((end as number) > chars.length) return 'EVIDENCE_RANGE_INVALID';
  if (chars.slice(start as number, end as number).join('') !== quote) return 'EVIDENCE_QUOTE_MISMATCH';
  return { kind: 'document', document_id: documentId, page: page as number | null, start: start as number, end: end as number, quote };
}

const EVIDENCE_MESSAGES: Record<string, string> = {
  USER_STATEMENT_NOT_AVAILABLE: '대화 진술 근거를 확인할 수 없습니다. 원문 구간을 선택하세요.',
  USER_STATEMENT_NOT_FOUND: '근거로 든 대화 메시지를 찾을 수 없습니다. 직접 작성한 메시지만 근거가 될 수 있습니다.',
  EVIDENCE_QUOTE_MISMATCH: '근거 문장이 원문 또는 대화 메시지와 일치하지 않습니다.',
};

// 사용자가 확인한 사실 목록을 원문 근거와 대조한다. 형식이 맞아도 원문과 다르면 거절한다.
export function validateConfirmedFacts(value: unknown, documentId: string, source: SourceText, statements?: StatementLookup): FactValidation {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, code: 'FACTS_REQUIRED', message: '확정할 경력 항목이 하나 이상 필요합니다.' };
  if (value.length > FACT_LIMITS.maxFacts) return { ok: false, code: 'TOO_MANY_FACTS', message: `경력 항목은 최대 ${FACT_LIMITS.maxFacts}개입니다.` };
  const seen = new Set<string>();
  const pageChars = pageCharsCache(source);
  const facts: ResumeFact[] = [];
  for (const [index, raw] of value.entries()) {
    const fail = (code: string, message: string): FactValidation => ({ ok: false, code, message, index });
    if (!isRecord(raw) || Object.keys(raw).sort().join() !== 'category,evidence,id,statement') return fail('FACT_INVALID', '경력 항목 형식이 올바르지 않습니다.');
    const { id, category, statement, evidence } = raw;
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || seen.has(id)) return fail('FACT_ID_INVALID', '경력 항목 ID가 없거나 중복되었습니다.');
    seen.add(id);
    if (!FACT_CATEGORIES.includes(category as never)) return fail('FACT_CATEGORY_INVALID', '알 수 없는 항목 분류입니다.');
    if (typeof statement !== 'string' || statement.trim().length === 0 || statement.length > FACT_LIMITS.maxStatement) return fail('FACT_STATEMENT_INVALID', '항목 내용은 비어 있을 수 없고 1000자 이하여야 합니다.');
    if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > FACT_LIMITS.maxEvidence) return fail('EVIDENCE_REQUIRED', '각 항목에는 원문 근거가 필요합니다.');
    const checked: EvidenceReference[] = [];
    for (const item of evidence) {
      const result = checkEvidence(item, documentId, pageChars, statements);
      if (typeof result === 'string') return fail(result, EVIDENCE_MESSAGES[result] ?? '원문 근거가 현재 문서의 추출 텍스트와 일치하지 않습니다.');
      checked.push(result);
    }
    if (!statementWithinEvidence(statement, checked.map(item => item.quote))) {
      return fail('STATEMENT_EXCEEDS_EVIDENCE', '항목 내용은 원문 근거 안의 표현만 쓸 수 있습니다. 원문에 없는 내용은 아직 확정할 수 없습니다.');
    }
    facts.push({ id, category: category as ResumeFact['category'], statement: statement.trim(), evidence: checked });
  }
  return { ok: true, facts };
}

export function factsContentHash(facts: ResumeFact[]): string {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}
