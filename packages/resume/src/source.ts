// 원문 위치는 Unicode code point 기준이다(start 포함, end 제외). UTF-16 index와 혼동하지 않는다.

export type SourcePage = { page: number | null; text: string };
export type SourceText = { input_kind: 'text_pdf' | 'pasted_text' | 'docx'; pages: SourcePage[] };

export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

export function codePointSlice(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join('');
}

export type Line = { text: string; start: number; end: number };

// 줄 단위로 나누고 각 줄의 code point 위치를 함께 돌려준다. 앞뒤 공백은 위치에서 제외한다.
export function splitLines(text: string): Line[] {
  const chars = Array.from(text);
  const lines: Line[] = [];
  let lineStart = 0;
  for (let index = 0; index <= chars.length; index++) {
    if (index < chars.length && chars[index] !== '\n') continue;
    let start = lineStart;
    let end = index;
    while (start < end && /\s/.test(chars[start])) start++;
    while (end > start && /\s/.test(chars[end - 1])) end--;
    lines.push({ text: chars.slice(start, end).join(''), start, end });
    lineStart = index + 1;
  }
  return lines;
}

export function findPage(source: SourceText, page: number | null): SourcePage | undefined {
  return source.pages.find(item => item.page === page);
}

// 붙여넣은 텍스트는 줄바꿈만 LF로 맞춘다. 원본 hash는 정규화 전 UTF-8 bytes로 계산한다.
export function normalizePastedText(text: string): string {
  return text.replace(/\r\n?/g, '\n').normalize('NFC');
}

// 항목 문장이 근거 원문 안의 표현인지 확인한다. 공백·줄바꿈 차이만 무시하고, 일부만 남기는 수정은 허용한다.
// 원문에 없는 내용(새 수치·역할·자격)은 사용자 진술 근거가 생기기 전까지 사실로 확정하지 않는다.
const compact = (text: string) => text.normalize('NFC').replace(/\s+/g, '');

export function statementWithinEvidence(statement: string, quotes: string[]): boolean {
  const target = compact(statement);
  return target.length > 0 && quotes.some(quote => compact(quote).includes(target));
}
