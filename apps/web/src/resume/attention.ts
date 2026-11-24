import { statementWithinEvidence } from '../../../../packages/resume/src/source.ts';
import { parseWarning } from '../../../../packages/resume/src/types.ts';
import type { FactReview } from '../../../../packages/resume/src/types.ts';
import type { EditableFact } from './FactEditor.tsx';

// 확정 화면 확인 부담 줄이기(DECISIONS S1-37). 실제 이력서 62개 중 34개는 원문 그대로라 확인할 것이 없었는데 모두 같은 비중으로 펼쳐졌다.
// 사용자가 판단해야 하는 항목만 '확인할 것'으로 앞에 두고, 그런 항목이 없는 묶음은 접는다. 묶음을 펼쳐 고치고 빼는 기능은 그대로다.

export type AttentionReason = 'not_in_source' | 'sensitive_excluded' | 'user_added';

export const attentionLabel: Record<AttentionReason, string> = {
  not_in_source: '원문에 없는 표현',
  sensitive_excluded: '민감정보라 자동 제외',
  user_added: '직접 추가한 줄 · 분류 확인',
};

const quotes = (item: EditableFact) => item.fact.evidence.map(evidence => evidence.quote);

// 저장을 막는 표현이 가장 먼저다. 직접 고친 문장은 사용자가 이미 본 것이라 다시 묻지 않는다.
export function attentionReason(item: EditableFact, annotation: FactReview | undefined): AttentionReason | null {
  if (item.included && !statementWithinEvidence(item.fact.statement, quotes(item))) return 'not_in_source';
  if (item.origin === 'user_added') return 'user_added';
  if (item.origin === 'extracted' && annotation?.section === 'sensitive') return 'sensitive_excluded';
  return null;
}

// 확정 경력은 원문 안의 표현만 저장된다(S1-10). 원문 밖으로 다듬은 문구는 저장되지 않으므로 확정 화면에 보여 주지 않고
// 적용할 수 있는 제안만 남긴다. 문장 다듬기는 확정 뒤 보완 단계에서 한다.
export function applicableWording(item: EditableFact, annotation: FactReview | undefined): string | null {
  const wording = item.origin === 'extracted' ? annotation?.wording : null;
  if (!wording || wording === item.fact.statement) return null;
  return statementWithinEvidence(wording, quotes(item)) ? wording : null;
}

// indexes는 하위 묶음 항목까지 포함한다(fact-groups.ts).
export function groupNeedsAttention(group: { indexes: number[] }, reasons: (AttentionReason | null)[]): boolean {
  return group.indexes.some(index => reasons[index] != null);
}

export type AttentionSummary = Record<AttentionReason, number> & { source_lines: number; total: number };

// source_lines: 경력 후보로 넣지 않은 '추가 확인 필요' 원문 줄(WarningsPanel). 연락처·희망 조건은 안내일 뿐 판단할 것이 아니다.
export function attentionSummary(items: EditableFact[], review: Record<string, FactReview> | undefined, warnings: string[]): AttentionSummary {
  const counts: Record<AttentionReason, number> = { not_in_source: 0, sensitive_excluded: 0, user_added: 0 };
  for (const item of items) {
    const reason = attentionReason(item, review?.[item.fact.id]);
    if (reason) counts[reason] += 1;
  }
  const sourceLines = warnings.map(parseWarning).filter(warning => warning !== null && warning.start !== null
    && (warning.code === 'UNCLASSIFIED_LINE' || warning.code === 'NEGATED_OR_UNVERIFIED')).length;
  const flagged = counts.not_in_source + counts.sensitive_excluded + counts.user_added;
  return { ...counts, source_lines: sourceLines, total: flagged + sourceLines };
}
