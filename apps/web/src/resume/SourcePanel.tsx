import { useEffect, useRef } from 'react';
import { splitLines } from '../../../../packages/resume/src/source.ts';
import type { SourceText } from './api.ts';

export type Span = { page: number | null; start: number; end: number };

// 쪽 번호가 없는 원문(page=null)의 이름. Word는 본문, 붙여넣기는 붙여넣은 내용이다(S1-12).
export function pagelessLabel(inputKind: string | undefined): string {
  return inputKind === 'docx' ? 'Word 본문' : '붙여넣은 내용';
}

// 원문을 페이지별로 보여주고 선택한 근거 구간을 강조한다. 위치를 모르면 강조하지 않는다.
function PageText({ page, text, highlight, onAddLine, readOnly, pageless }: { page: number | null; text: string; highlight: Span | null; onAddLine: (span: Span, quote: string) => void; readOnly: boolean; pageless: string }) {
  const markRef = useRef<HTMLElement>(null);
  const active = highlight && highlight.page === page ? highlight : null;
  useEffect(() => { markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [active?.start, active?.end, active?.page]);
  const chars = Array.from(text);
  return <div className="source-page">
    <div className="source-page-label">{page === null ? pageless : `${page}쪽`}</div>
    {splitLines(text).map((line, index) => {
      if (line.text.length === 0) return <div key={index} className="source-line empty" />;
      const overlaps = active && active.start < line.end && active.end > line.start;
      let content: React.ReactNode = line.text;
      if (overlaps && active) {
        const from = Math.max(active.start, line.start), to = Math.min(active.end, line.end);
        content = <>{chars.slice(line.start, from).join('')}<mark ref={markRef}>{chars.slice(from, to).join('')}</mark>{chars.slice(to, line.end).join('')}</>;
      }
      return <div key={index} className="source-line">
        <span>{content}</span>
        {!readOnly && <button type="button" className="ghost" aria-label={`이 줄을 경력 항목으로 추가: ${line.text}`} onClick={() => onAddLine({ page, start: line.start, end: line.end }, line.text)}>+ 추가</button>}
      </div>;
    })}
  </div>;
}

export function SourcePanel({ source, highlight, onAddLine, readOnly }: { source: SourceText | null; highlight: Span | null; onAddLine: (span: Span, quote: string) => void; readOnly: boolean }) {
  if (!source) return <p className="muted">읽은 원문이 없습니다.</p>;
  return <div className="source-text" aria-label="원문">
    {source.pages.map(item => <PageText key={String(item.page)} page={item.page} text={item.text} highlight={highlight} onAddLine={onAddLine} readOnly={readOnly} pageless={pagelessLabel(source.input_kind)} />)}
  </div>;
}

export function quoteAt(source: SourceText | null, span: Span): string | null {
  const page = source?.pages.find(item => item.page === span.page);
  return page ? Array.from(page.text).slice(span.start, span.end).join('') : null;
}
