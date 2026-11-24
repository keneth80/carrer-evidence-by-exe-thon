// PDF 한 쪽의 글자 조각을 읽는 순서대로 글로 만든다(사용자 요청 2026-11-23: 다양한 PDF 양식 대응, DECISIONS S1-34).
// PDF는 글자를 '그린 순서'로 담는다. 워드프로세서로 만든 PDF는 그 순서가 읽는 순서와 같지만,
// 디자인 도구(표·단·글상자)로 만든 PDF는 순서가 뒤섞여 회사·기간·문장이 엉킨다.
// 그린 순서가 읽는 순서와 맞으면 그대로 쓰고(카드 묶음처럼 그린 순서가 더 정확한 양식이 있다), 뒤섞였을 때만 화면 위치로 다시 맞춘다.

export type TextPiece = { str: string; x: number; y: number; width: number; height: number; eol?: boolean };
type Segment = { x0: number; x1: number; text: string };
type Row = { y: number; height: number; segments: Segment[] };

// 뒤섞임 판단: 그린 순서대로 가다가 위로 되돌아가는 일 가운데 '오른쪽 칸으로 넘어가는 것'이 아닌 횟수.
// 2단·카드 묶음·열 단위 표는 한 칸을 다 그리고 오른쪽 칸 위로 올라가므로 되돌아감이 모두 오른쪽으로 간다(실제 카드형 이력서: 9번 중 8번).
// 뒤섞인 PDF는 같은 칸 안에서도 오르내린다. 카드 묶음을 뒤섞임으로 보면 카드가 줄 단위로 쪼개지므로 이 구분이 중요하다.
export const SCRAMBLE = { minWild: 4, ratio: 0.08, rightShift: 20 } as const;
const CELL_SEPARATOR = ' | ';

const sameRow = (a: { y: number; height: number }, b: { y: number; height: number }) => Math.abs(a.y - b.y) <= Math.max(2, 0.45 * Math.min(a.height || 10, b.height || 10));

export function isScrambled(pieces: TextPiece[]): boolean {
  const inked = pieces.filter(piece => piece.str.trim());
  let moves = 0, wild = 0;
  for (let at = 1; at < inked.length; at++) {
    if (sameRow(inked[at - 1], inked[at])) continue;
    moves++;
    if (inked[at].y > inked[at - 1].y && inked[at].x <= inked[at - 1].x + SCRAMBLE.rightShift) wild++;
  }
  return wild >= SCRAMBLE.minWild && wild > moves * SCRAMBLE.ratio;
}

// 그린 순서 그대로. 같은 줄에서 떨어져 있는 조각 사이에 빈칸이 없으면 하나 넣는다("회사명2020.01"처럼 붙는 것을 막는다).
function streamText(pieces: TextPiece[]): string {
  let text = '';
  pieces.forEach((piece, at) => {
    const previous = pieces[at - 1];
    if (previous && !previous.eol && piece.str.trim() && previous.str.trim() && sameRow(previous, piece)
      && piece.x - (previous.x + previous.width) > 0.25 * (piece.height || 10) && !/\s$/.test(text) && !/^\s/.test(piece.str)) text += ' ';
    text += piece.str;
    if (piece.eol) text += '\n';
  });
  return text;
}

function rowsOf(pieces: TextPiece[]): Row[] {
  const inked = pieces.filter(piece => piece.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: TextPiece[][] = [];
  for (const piece of inked) {
    const last = groups.at(-1);
    if (last && sameRow(last[0], piece)) last.push(piece); else groups.push([piece]);
  }
  return groups.map(group => {
    const sorted = [...group].sort((a, b) => a.x - b.x);
    const height = Math.max(...sorted.map(piece => piece.height || 10));
    const segments: Segment[] = [];
    for (const piece of sorted) {
      const last = segments.at(-1);
      const gap = last ? piece.x - last.x1 : 0;
      // 글자 높이의 2배 넘게 떨어져 있으면 다른 칸(표의 칸, 다른 단)으로 본다.
      if (!last || gap > Math.max(18, 2.2 * height)) { segments.push({ x0: piece.x, x1: piece.x + piece.width, text: piece.str.trim() }); continue; }
      last.text += (gap > 0.25 * height && !/\s$/.test(last.text) && !/^\s/.test(piece.str) ? ' ' : '') + piece.str.trimEnd();
      last.x1 = Math.max(last.x1, piece.x + piece.width);
    }
    return { y: sorted[0].y, height, segments };
  });
}

// 단(또는 표의 칸 경계) 찾기: 거의 모든 줄이 가로지르지 않는 세로 빈 띠. 후보는 한 줄 안의 칸 사이 틈에서 얻는다.
// 왼쪽 좁은 단(기술·학력)과 오른쪽 본문처럼 줄 높이가 서로 달라 같은 줄에 양쪽 글자가 거의 없어도 찾을 수 있어야 한다.
// 한 단짜리 문서에서 '회사명 ……… 기간'의 틈은 긴 본문 줄이 가로지르므로 단으로 보지 않는다.
function gutterOf(rows: Row[]): number | null {
  const candidates = rows.flatMap(row => row.segments.slice(1).map((segment, at) => (row.segments[at].x1 + segment.x0) / 2));
  let best: { x: number; clear: number } | null = null;
  for (const x of candidates) {
    const crossing = rows.filter(row => row.segments.some(segment => segment.x0 < x && x < segment.x1)).length;
    const left = rows.filter(row => row.segments.some(segment => segment.x1 <= x)).length;
    const right = rows.filter(row => row.segments.some(segment => segment.x0 >= x)).length;
    if (crossing > rows.length * 0.15 || left < 3 || right < 3) continue;
    const clear = rows.length - crossing;
    if (!best || clear > best.clear) best = { x, clear };
  }
  return best?.x ?? null;
}

const joined = (segments: Segment[]) => segments.map(segment => segment.text).join(CELL_SEPARATOR);

// 화면 위치로 다시 맞춘 글. 전체 폭 줄은 그 자리에 두고, 단이 있는 구간은 표면 줄 단위로, 2단 글이면 왼쪽 단을 다 읽은 뒤 오른쪽 단을 읽는다.
function layoutText(pieces: TextPiece[]): string {
  const rows = rowsOf(pieces);
  const gutter = gutterOf(rows);
  if (gutter === null) return rows.map(row => joined(row.segments)).join('\n');
  const lines: string[] = [];
  let block: Row[] = [];
  const flush = () => {
    if (block.length === 0) return;
    const both = block.filter(row => row.segments.some(segment => segment.x1 <= gutter) && row.segments.some(segment => segment.x0 >= gutter)).length;
    const lengths = block.flatMap(row => row.segments.map(segment => segment.text.length)).sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
    // 표: 거의 모든 줄에 양쪽 칸이 있고 칸 글자가 짧다 → 줄 단위로 읽는다. 아니면 2단 글 → 단 단위로 읽는다.
    if (both >= block.length * 0.8 && median <= 24) lines.push(...block.map(row => joined(row.segments)));
    else for (const side of [0, 1]) for (const row of block) { const part = row.segments.filter(segment => side === 0 ? segment.x1 <= gutter : segment.x0 >= gutter); if (part.length) lines.push(joined(part)); }
    block = [];
  };
  for (const row of rows) {
    // 빈 띠를 가로지르는 줄(전체 폭 제목 등)은 단 구간을 끊는다.
    if (row.segments.some(segment => segment.x0 < gutter && gutter < segment.x1)) { flush(); lines.push(joined(row.segments)); } else block.push(row);
  }
  flush();
  return lines.join('\n');
}

export function pageText(pieces: TextPiece[]): { text: string; reordered: boolean } {
  const reordered = isScrambled(pieces);
  return { text: reordered ? layoutText(pieces) : streamText(pieces), reordered };
}
