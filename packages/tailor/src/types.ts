// contracts/v0.7/schemas/domain.schema.json의 ResumeBlock·ProposedChange와 같은 모양이다.
// 이 패키지는 node 전용 모듈을 쓰지 않는다(웹 화면도 변경 적용·비교에 사용).

export type ResumeBlock = { id: string; section: string; text: string; fact_ids: string[] };

export type ChangeOperation = 'replace' | 'insert' | 'remove' | 'reorder';
export type ProposedChange = {
  operation: ChangeOperation;
  block_id: string;
  before: string | null;
  after: string | null;
  fact_ids: string[];
  reason: string;
  needs_fact_confirmation: boolean;
};

export type FactLike = { id: string; category: string; statement: string };

// insert로 추가한 블록이 들어가는 구역. 제안 계약에 위치 필드가 없어 맞춤 요약 구역 맨 앞에 둔다(DECISIONS S4-03).
export const TAILORED_SECTION = '맞춤 요약';
export const SECTION_ORDER = [TAILORED_SECTION, '요약', '직무', '기술', '경력', '경력 내용', '성과', '학력', '자격', '기타'] as const;
// 확정 사실 문장 한도(packages/resume/src/confirm.ts FACT_LIMITS.maxStatement)와 같다.
export const TEXT_LIMIT = 1000;

// 화면 미리보기와 PDF가 같은 구역 이름을 쓴다.
export function sectionLabel(section: string): string {
  return section === TAILORED_SECTION ? '핵심 요약' : section;
}
