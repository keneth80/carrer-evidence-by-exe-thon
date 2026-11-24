import type { ProposedChange, ResumeBlock } from '../../../../packages/tailor/src/types.ts';

// 공고 맞춤 수정 전후 비교(DECISIONS S4-17). 처음 버전(확정 경력으로 만든 기본 이력서)과 지금 버전을 줄마다 비교한다.
// 이유는 적용한 수정안 중 지금 문장을 만든 변경에서만 가져온다. 사용자가 나중에 다시 고친 줄에 AI의 이유를 붙이지 않기 위해서다.

export type Segment = { text: string; changed: boolean };
export type RowKind = 'added' | 'changed' | 'removed' | 'moved' | 'same';
export type CompareRow = { kind: RowKind; block_id: string; section: string; before: string | null; after: string | null; reason: string | null };
type ProposalLike = { state: string; changes: ProposedChange[] };

function push(segments: Segment[], text: string, changed: boolean) {
  const last = segments.at(-1);
  if (last && last.changed === changed) segments[segments.length - 1] = { text: last.text + text, changed };
  else segments.push({ text, changed });
}

// 낱말(공백 포함) 단위 LCS. 블록 문장은 최대 1000자라 표 크기가 작다.
export function wordDiff(before: string, after: string): { before: Segment[]; after: Segment[] } {
  const x = before ? before.split(/(\s+)/) : [];
  const y = after ? after.split(/(\s+)/) : [];
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const left: Segment[] = [], right: Segment[] = [];
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { push(left, x[i++], false); push(right, y[j++], false); }
    else if (j >= y.length || (i < x.length && dp[i + 1][j] >= dp[i][j + 1])) push(left, x[i++], true);
    else push(right, y[j++], true);
  }
  return { before: left, after: right };
}

// 구역 안에서 두 버전 모두에 있는 블록의 상대 순서.
function sectionOrder(blocks: ResumeBlock[], shared: Set<string>): Map<string, number> {
  const counters = new Map<string, number>();
  const order = new Map<string, number>();
  for (const block of blocks) {
    if (!shared.has(block.id)) continue;
    const index = counters.get(block.section) ?? 0;
    order.set(block.id, index);
    counters.set(block.section, index + 1);
  }
  return order;
}

export function compareRevisions(base: ResumeBlock[], current: ResumeBlock[], proposals: ProposalLike[]): CompareRow[] {
  const applied = proposals.filter(proposal => proposal.state === 'accepted').flatMap(proposal => proposal.changes);
  const reasonFor = (match: (change: ProposedChange) => boolean) => applied.filter(match).at(-1)?.reason ?? null;
  const baseById = new Map(base.map(block => [block.id, block]));
  const currentIds = new Set(current.map(block => block.id));
  const shared = new Set(base.filter(block => currentIds.has(block.id)).map(block => block.id));
  const baseOrder = sectionOrder(base, shared);
  const currentOrder = sectionOrder(current, shared);

  const rows: CompareRow[] = current.map(block => {
    const old = baseById.get(block.id);
    const row = { block_id: block.id, section: block.section, before: old?.text ?? null, after: block.text };
    const madeIt = (change: ProposedChange) => change.block_id === block.id && change.after === block.text && (change.operation === 'insert' || change.operation === 'replace');
    if (!old) return { ...row, kind: 'added' as const, reason: reasonFor(madeIt) };
    if (old.text !== block.text) return { ...row, kind: 'changed' as const, reason: reasonFor(madeIt) };
    const reorder = (change: ProposedChange) => change.block_id === block.id && change.operation === 'reorder';
    if (baseOrder.get(block.id) !== currentOrder.get(block.id) && applied.some(reorder)) return { ...row, kind: 'moved' as const, reason: reasonFor(reorder) };
    return { ...row, kind: 'same' as const, reason: null };
  });

  // 빠진 블록은 처음 버전에서 바로 앞에 있던(지금도 남은) 블록 뒤에 둔다.
  base.forEach((block, index) => {
    if (currentIds.has(block.id)) return;
    const removed: CompareRow = { kind: 'removed', block_id: block.id, section: block.section, before: block.text, after: null,
      reason: reasonFor(change => change.block_id === block.id && change.operation === 'remove' && change.before === block.text) };
    const anchor = base.slice(0, index).reverse().find(item => currentIds.has(item.id) || rows.some(row => row.block_id === item.id));
    const at = anchor ? rows.findIndex(row => row.block_id === anchor.id) + 1 : 0;
    rows.splice(at, 0, removed);
  });
  return rows;
}

export function compareSummary(rows: CompareRow[]): Record<RowKind, number> {
  const counts: Record<RowKind, number> = { added: 0, changed: 0, removed: 0, moved: 0, same: 0 };
  for (const row of rows) counts[row.kind] += 1;
  return counts;
}
