// contracts/v0.7/schemas/domain.schema.json의 ResumeFact·EvidenceReference와 같은 모양이다.

export const FACT_CATEGORIES = ['role', 'employer', 'period', 'skill', 'responsibility', 'achievement', 'education', 'certification', 'location', 'other'] as const;
export type FactCategory = typeof FACT_CATEGORIES[number];
export const REVIEW_SECTIONS = ['intro', 'career', 'awards', 'education', 'skills', 'certifications', 'sensitive', 'other'] as const;
export type ReviewSection = typeof REVIEW_SECTIONS[number];
export type FactReview = {
  section: ReviewSection; wording: string | null; primary?: true;
  group?: { id: string; title: string };
  project?: { id: string; title: string };
};

export type DocumentEvidence = { kind: 'document'; document_id: string; page: number | null; start: number; end: number; quote: string };
export type UserStatementEvidence = { kind: 'user_statement'; message_id: string; confirmed_at: string; quote: string };
export type EvidenceReference = DocumentEvidence | UserStatementEvidence;

export type ResumeFact = { id: string; category: FactCategory; statement: string; evidence: EvidenceReference[] };

// 사실 후보가 아닌 줄을 남기는 경고. API에서는 문자열로 직렬화한다(ExtractionDraft.warnings).
export const WARNING_CODES = ['PERSONAL_INFO_EXCLUDED', 'PREFERENCE_NOT_FACT', 'NEGATED_OR_UNVERIFIED', 'UNCLASSIFIED_LINE', 'EMPTY_TEXT', 'NO_FACT_CANDIDATES', 'CANDIDATE_LIMIT_REACHED', 'OCR_TEXT'] as const;
export type WarningCode = typeof WARNING_CODES[number];
export type ExtractionWarning = { code: WarningCode; page: number | null; start: number | null; end: number | null; message: string };

export function formatWarning(warning: ExtractionWarning): string {
  const location = warning.start === null ? '-' : `${warning.page ?? 'text'}:${warning.start}-${warning.end}`;
  return `${warning.code}@${location} ${warning.message}`;
}

export function parseWarning(value: string): ExtractionWarning | null {
  const match = /^([A-Z_]+)@(-|(\d+|text):(\d+)-(\d+)) (.*)$/s.exec(value);
  if (!match) return null;
  const located = match[2] !== '-';
  return {
    code: match[1] as WarningCode,
    page: located && match[3] !== 'text' ? Number(match[3]) : null,
    start: located ? Number(match[4]) : null,
    end: located ? Number(match[5]) : null,
    message: match[6],
  };
}
