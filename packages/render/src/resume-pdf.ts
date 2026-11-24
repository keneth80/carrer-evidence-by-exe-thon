import { readFileSync } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { layoutTexts, resumeLayout } from '../../tailor/src/layout.ts';
import { sectionLabel } from '../../tailor/src/types.ts';
import { withoutHiddenChars } from '../../tailor/src/hidden-chars.ts';
import type { FactLike, ResumeBlock } from '../../tailor/src/types.ts';

// 확정 이력서 블록을 실제 A4 PDF로 만든다. 같은 블록·같은 확정 시각이면 같은 bytes가 나오도록 날짜를 고정한다.
// 글꼴: 나눔고딕 보통체(OFL, fonts/OFL.txt)를 **서브셋 없이 전체 임베딩**한다. pdf-lib 1.17.1 + fontkit의 서브셋은
// 이 TTF에서 한글 글리프 윤곽선을 빠뜨려 Chrome·macOS 렌더에서 글자가 사라졌다(텍스트 추출은 정상이라 추출 검사로는 안 보임).
// 파일 크기를 줄이려고 굵은 글꼴은 넣지 않고 제목은 같은 글꼴을 가로로 살짝 겹쳐 그린다.
// 버전 문자열은 PDF Producer에 기록한다(ce7_artifacts에 렌더 버전 열이 없음).

// v3(2026-11-21): 회사 아래에 직무·업무·성과를 묶는다(layout.ts). facts가 없으면 v2와 같이 구역별로만 나눈다.
export const RENDER_VERSION = 'resume-pdf.v3 (pdf-lib 1.17.1, NanumGothic-Regular full embed, employer layout)';
export type RenderInput = { blocks: ResumeBlock[]; title: string; finalizedAt: Date; facts?: FactLike[] };

export class RenderGlyphError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`RENDER_GLYPH_MISSING: ${missing.join(' ')}`);
    this.name = 'RenderGlyphError';
    this.missing = missing;
  }
}

// 그릴 문자열 정규화: 분해형 한글(NFD)은 조합형으로, 탭·제어문자는 공백으로 바꾸고 보이지 않는 문자는 지운다(S4-16). 의미는 바뀌지 않는다.
export const renderableText = (text: string) => withoutHiddenChars(text.normalize('NFC')).replace(/[\t\u000b\u000c\u00a0]/g, ' ').replace(/[\u0000-\u0008\u000e-\u001f]/g, '');
export type RenderOutput = { bytes: Uint8Array; pageCount: number; renderVersion: string };

const FONT_DIR = new URL('../fonts/', import.meta.url);
let fontCache: Uint8Array | null = null;
function regularFont(): Uint8Array {
  fontCache ??= readFileSync(new URL('NanumGothic-Regular.ttf', FONT_DIR));
  return fontCache;
}
let glyphFont: { hasGlyphForCodePoint(codePoint: number): boolean } | null = null;

// 글꼴에 없는 글자 목록(공백 제외). PDF에서 빈칸·네모로 빠지는 글자를 렌더 전에 찾는다(é, ①, 이모지 등).
export function missingGlyphs(texts: string[]): string[] {
  glyphFont ??= fontkit.create(Buffer.from(regularFont())) as unknown as { hasGlyphForCodePoint(codePoint: number): boolean };
  const chars = new Set(Array.from(texts.map(renderableText).join('')).filter(char => !/\s/.test(char)));
  return [...chars].filter(char => !glyphFont!.hasGlyphForCodePoint(char.codePointAt(0)!));
}

const PAGE = { width: 595.28, height: 841.89, marginX: 56, top: 64, bottom: 64 } as const;
const STYLE = { title: 20, heading: 12.5, employer: 11, body: 10.5, footer: 8.5, line: 1.55 } as const;
const INK = rgb(0.13, 0.17, 0.2);
const MUTED = rgb(0.42, 0.48, 0.52);

// 너비를 넘으면 공백에서 끊고, 공백 없이 긴 낱말(한글 붙여쓰기·URL)은 글자 단위로 끊는다.
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      if (!word) continue;
      const candidate = line + word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
      if (/^\s+$/.test(word)) continue;
      for (const char of Array.from(word)) {
        if (font.widthOfTextAtSize(line + char, size) > width && line) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

type Cursor = { page: PDFPage; y: number };

export async function renderResumePdf(input: RenderInput): Promise<RenderOutput> {
  const sections = resumeLayout(input.blocks, input.facts ?? []);
  const missing = missingGlyphs([input.title, ...layoutTexts(sections), ...sections.map(section => sectionLabel(section.section))]);
  if (missing.length) throw new RenderGlyphError(missing);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const body = await doc.embedFont(regularFont(), { subset: false });
  const contentWidth = PAGE.width - PAGE.marginX * 2;
  const newPage = (): Cursor => ({ page: doc.addPage([PAGE.width, PAGE.height]), y: PAGE.height - PAGE.top });
  let cursor = newPage();
  const ensure = (height: number) => { if (cursor.y - height < PAGE.bottom) cursor = newPage(); };
  const draw = (text: string, x: number, size: number, bold = false, color = INK) => {
    cursor.page.drawText(text, { x, y: cursor.y - size, size, font: body, color });
    // 굵게: 같은 글자를 글자 크기의 3%만큼 옮겨 한 번 더 그린다.
    if (bold) cursor.page.drawText(text, { x: x + size * 0.03, y: cursor.y - size, size, font: body, color });
    cursor.y -= size * STYLE.line;
  };

  draw(input.title, PAGE.marginX, STYLE.title, true);
  cursor.y -= 6;
  const bullets = (texts: string[], marked: boolean) => {
    for (const text of texts) {
      const indent = marked ? 12 : 0;
      const lines = wrapText(renderableText(text), body, STYLE.body, contentWidth - indent);
      lines.forEach((line, index) => {
        ensure(STYLE.body * STYLE.line);
        if (marked && index === 0) cursor.page.drawText('•', { x: PAGE.marginX + 2, y: cursor.y - STYLE.body, size: STYLE.body, font: body, color: INK });
        draw(line || ' ', PAGE.marginX + indent, STYLE.body);
      });
      cursor.y -= 3;
    }
  };
  for (const group of sections) {
    // 구역 제목만 페이지 끝에 남지 않도록 제목 + 첫 줄 높이를 확보한다.
    ensure(STYLE.heading * STYLE.line + STYLE.body * STYLE.line * 2 + 10);
    cursor.y -= 8;
    draw(sectionLabel(group.section), PAGE.marginX, STYLE.heading, true);
    cursor.page.drawLine({ start: { x: PAGE.marginX, y: cursor.y + 4 }, end: { x: PAGE.width - PAGE.marginX, y: cursor.y + 4 }, thickness: 0.6, color: MUTED });
    cursor.y -= 2;
    bullets(group.blocks.map(block => block.text), group.section !== '기술');
    for (const employer of group.employers) {
      // 회사 제목이 페이지 끝에 홀로 남지 않게 제목 + 두 줄을 확보한다.
      ensure(STYLE.employer * STYLE.line + STYLE.body * STYLE.line * 2 + 6);
      cursor.y -= 4;
      for (const line of wrapText(renderableText(employer.title), body, STYLE.employer, contentWidth)) draw(line, PAGE.marginX, STYLE.employer, true);
      const sub = employer.items.filter(item => item.kind === 'role' || item.kind === 'period');
      for (const item of sub) for (const line of wrapText(renderableText(item.block.text), body, STYLE.body, contentWidth)) { ensure(STYLE.body * STYLE.line); draw(line || ' ', PAGE.marginX, STYLE.body, false, MUTED); }
      bullets(employer.items.filter(item => !sub.includes(item)).map(item => item.block.text), true);
    }
  }

  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const label = `${index + 1} / ${pages.length}`;
    page.drawText(label, { x: PAGE.width / 2 - body.widthOfTextAtSize(label, STYLE.footer) / 2, y: PAGE.bottom / 2, size: STYLE.footer, font: body, color: MUTED });
  });
  doc.setTitle(input.title);
  doc.setProducer(RENDER_VERSION);
  doc.setCreator('Career Evidence');
  doc.setCreationDate(input.finalizedAt);
  doc.setModificationDate(input.finalizedAt);
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, pageCount: pages.length, renderVersion: RENDER_VERSION };
}
