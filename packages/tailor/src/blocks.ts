import { SECTION_ORDER, TAILORED_SECTION, TEXT_LIMIT } from './types.ts';
import type { FactLike, ProposedChange, ResumeBlock } from './types.ts';

// 공고별 이력서 블록: 확정 경력에서 기본 문서를 만들고, 검증한 변경만 적용한다.
// 블록 문장은 확정 사실 문장 그대로이거나, 변경 제안이 근거 사실 범위 안에서 다시 쓴 문장이다.

const CATEGORY_SECTION: Record<string, string> = {
  other: '요약', role: '직무', skill: '기술', employer: '경력', period: '경력', responsibility: '경력 내용',
  achievement: '성과', education: '학력', certification: '자격', location: '기타',
};

const sectionRank = (section: string) => {
  const index = (SECTION_ORDER as readonly string[]).indexOf(section);
  return index === -1 ? SECTION_ORDER.length : index;
};

// 구역 순서로 정렬하되 같은 구역 안의 순서는 유지한다.
export function sortBlocks(blocks: ResumeBlock[]): ResumeBlock[] {
  return blocks.map((block, index) => ({ block, index }))
    .sort((a, b) => sectionRank(a.block.section) - sectionRank(b.block.section) || a.index - b.index)
    .map(item => item.block);
}

export function baseBlocks(facts: FactLike[]): ResumeBlock[] {
  const blocks: ResumeBlock[] = [];
  const skills = facts.filter(fact => fact.category === 'skill');
  let skillsAdded = false;
  for (let index = 0; index < facts.length; index++) {
    const fact = facts[index];
    if (fact.category === 'skill') {
      if (!skillsAdded) {
        blocks.push({ id: 'blk_skills', section: '기술', text: skills.map(item => item.statement).join(' · '), fact_ids: skills.map(item => item.id) });
        skillsAdded = true;
      }
      continue;
    }
    // 회사 다음에 바로 기간이 오면 한 줄로 묶는다(두 사실 문장을 그대로 잇는다).
    const next = facts[index + 1];
    if (fact.category === 'employer' && next?.category === 'period') {
      blocks.push({ id: `blk_${fact.id}`, section: '경력', text: `${fact.statement} · ${next.statement}`, fact_ids: [fact.id, next.id] });
      index++;
      continue;
    }
    blocks.push({ id: `blk_${fact.id}`, section: CATEGORY_SECTION[fact.category] ?? '기타', text: fact.statement, fact_ids: [fact.id] });
  }
  return sortBlocks(blocks);
}

export type ApplyResult = { ok: true; blocks: ResumeBlock[] } | { ok: false; code: string; message: string; index: number };

const fail = (code: string, message: string, index: number): ApplyResult => ({ ok: false, code, message, index });
const ID = /^[a-zA-Z0-9_-]{1,128}$/;

// 변경 목록을 순서대로 적용한다. 블록 ID·operation별 before/after 조건과 블록 집합의 유일성을 검사한다.
export function applyChanges(blocks: ResumeBlock[], changes: ProposedChange[]): ApplyResult {
  let current = blocks.map(block => ({ ...block, fact_ids: [...block.fact_ids] }));
  const inserted: ResumeBlock[] = [];
  for (const [index, change] of changes.entries()) {
    if (!ID.test(change.block_id)) return fail('CHANGE_BLOCK_INVALID', '블록 ID 형식이 올바르지 않습니다.', index);
    const position = current.findIndex(block => block.id === change.block_id);
    const target = current[position];
    if (change.operation === 'insert') {
      if (target || inserted.some(block => block.id === change.block_id)) return fail('CHANGE_BLOCK_EXISTS', '이미 있는 블록 ID에 추가할 수 없습니다.', index);
      if (change.before !== null || !change.after?.trim()) return fail('CHANGE_SHAPE_INVALID', '추가는 before=null과 after 문장이 필요합니다.', index);
      if (change.after.length > TEXT_LIMIT) return fail('CHANGE_TEXT_TOO_LONG', `문장은 ${TEXT_LIMIT}자 이하입니다.`, index);
      if (change.fact_ids.length === 0) return fail('CHANGE_FACTS_REQUIRED', '근거 사실이 없는 문장은 추가할 수 없습니다.', index);
      const block = { id: change.block_id, section: TAILORED_SECTION, text: change.after.trim(), fact_ids: [...change.fact_ids] };
      inserted.push(block);
      current = [...current, block];
      continue;
    }
    if (!target) return fail('CHANGE_BLOCK_NOT_FOUND', '바꾸려는 블록이 현재 문서에 없습니다.', index);
    if (change.operation === 'replace') {
      if (change.before !== target.text) return fail('CHANGE_BEFORE_MISMATCH', '변경 전 문장이 현재 문서와 다릅니다.', index);
      if (!change.after?.trim()) return fail('CHANGE_SHAPE_INVALID', '수정은 after 문장이 필요합니다.', index);
      if (change.after.length > TEXT_LIMIT) return fail('CHANGE_TEXT_TOO_LONG', `문장은 ${TEXT_LIMIT}자 이하입니다.`, index);
      if (change.fact_ids.length === 0) return fail('CHANGE_FACTS_REQUIRED', '근거 사실이 없는 문장으로 바꿀 수 없습니다.', index);
      current = current.map(block => block.id === target.id ? { ...block, text: change.after!.trim(), fact_ids: [...change.fact_ids] } : block);
    } else if (change.operation === 'remove') {
      if (change.before !== target.text || change.after !== null) return fail('CHANGE_SHAPE_INVALID', '삭제는 현재 문장과 같은 before, after=null이 필요합니다.', index);
      current = current.filter(block => block.id !== target.id);
    } else if (change.operation === 'reorder') {
      // 같은 구역의 맨 앞으로 옮긴다. 문장은 바뀌지 않는다.
      if (change.before !== null || change.after !== null) return fail('CHANGE_SHAPE_INVALID', '순서 변경은 before·after가 null이어야 합니다.', index);
      const rest = current.filter(block => block.id !== target.id);
      const first = rest.findIndex(block => block.section === target.section);
      current = first === -1 ? [...rest, target] : [...rest.slice(0, first), target, ...rest.slice(first)];
    } else {
      return fail('CHANGE_OPERATION_INVALID', '허용하지 않는 변경 종류입니다.', index);
    }
  }
  if (current.length === 0) return fail('RESUME_EMPTY', '이력서에 블록이 하나 이상 있어야 합니다.', changes.length - 1);
  return { ok: true, blocks: sortBlocks(current) };
}

// 블록 순서·내용·근거가 같으면 같은 hash다. 확정·렌더·제안 CAS의 기준이다.
export function blocksCanonical(blocks: ResumeBlock[]): string {
  return JSON.stringify(blocks.map(block => [block.id, block.section, block.text, block.fact_ids]));
}

export function groupBySection(blocks: ResumeBlock[]): { section: string; blocks: ResumeBlock[] }[] {
  const groups: { section: string; blocks: ResumeBlock[] }[] = [];
  for (const block of blocks) {
    const last = groups[groups.length - 1];
    if (last && last.section === block.section) last.blocks.push(block);
    else groups.push({ section: block.section, blocks: [block] });
  }
  return groups;
}
