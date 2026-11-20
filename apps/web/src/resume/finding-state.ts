// 보완 대화 점검 항목의 반영 상태(사용자 테스트 2026-11-20). 점검은 시작 버전의 확정 경력을 본 기록이라 다시 쓰지 않고,
// 시작 버전과 현재 버전을 비교해 '대상' 문장이 바뀌었는지만 보여 준다. '기존 항목 바꾸기'는 같은 자리에 새 id로 넣는다(similar.ts replaceFact).

type FactText = { id: string; statement: string };
export type FactChange = { text: string; changed: boolean; replacedBy: string | null };
export type FindingProgress = 'done' | 'partial' | 'open';

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

// text: 점검 당시 문장. changed면 replacedBy에 지금 문장(지웠거나 찾지 못하면 null).
export function factChange(id: string, start: FactText[] | null, head: FactText[]): FactChange | null {
  const now = head.find(fact => fact.id === id);
  const before = start?.find(fact => fact.id === id) ?? null;
  if (now) {
    const changed = before !== null && squash(before.statement) !== squash(now.statement);
    return { text: changed ? before.statement : now.statement, changed, replacedBy: changed ? now.statement : null };
  }
  if (!start || !before) return null;
  const startIds = new Set(start.map(fact => fact.id));
  const sameSlot = head[start.indexOf(before)];
  return { text: before.statement, changed: true, replacedBy: sameSlot && !startIds.has(sameSlot.id) ? sameSlot.statement : null };
}

export function findingProgress(factIds: string[], start: FactText[] | null, head: FactText[]): FindingProgress {
  const states = factIds.map(id => factChange(id, start, head)).filter((state): state is FactChange => state !== null);
  const changed = states.filter(state => state.changed).length;
  if (changed === 0) return 'open';
  return changed === states.length ? 'done' : 'partial';
}
