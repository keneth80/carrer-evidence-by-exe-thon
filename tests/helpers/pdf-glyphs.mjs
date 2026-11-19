import { inflateSync } from 'node:zlib';
import fontkit from '@pdf-lib/fontkit';

// PDF 본문에 실제로 그린 글리프가 임베딩된 글꼴에 윤곽선을 갖고 있는지 확인한다.
// 텍스트 추출은 ToUnicode 표만 보므로, 글리프 윤곽선이 빠져 화면에 글자가 안 보이는 결함을 잡지 못한다(S04 렌더 결함).
// 전제: 글꼴 하나를 Identity-H(CID = 글리프 ID)로 임베딩한 PDF(현재 렌더러 출력).

function streams(bytes) {
  const text = bytes.toString('latin1');
  const out = [];
  for (const match of text.matchAll(/(\d+) 0 obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g)) {
    const length = Number(/\/Length (\d+)/.exec(match[2])?.[1]);
    const start = match.index + match[0].length;
    const raw = bytes.subarray(start, start + length);
    out.push({ id: match[1], dict: match[2], data: /\/FlateDecode/.test(match[2]) ? inflateSync(raw) : raw });
  }
  return out;
}

export function glyphReport(pdf) {
  const bytes = Buffer.from(pdf);
  const all = streams(bytes);
  const fontRefs = [...bytes.toString('latin1').matchAll(/\/FontFile2 (\d+) 0 R/g)].map(match => match[1]);
  const fonts = fontRefs.map(id => fontkit.create(all.find(stream => stream.id === id).data));
  // ToUnicode: CID → 유니코드(공백 판별용)
  const unicode = new Map();
  for (const stream of all) {
    const text = stream.data.toString('latin1');
    if (!text.includes('beginbfchar') && !text.includes('beginbfrange')) continue;
    for (const [, cid, value] of text.matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]+)>/g)) unicode.set(parseInt(cid, 16), Buffer.from(value, 'hex').swap16().toString('utf16le'));
  }
  // 본문에서 그린 글리프 ID
  const used = new Set();
  for (const stream of all) {
    const text = stream.data.toString('latin1');
    for (const [, hex] of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) for (let i = 0; i + 4 <= hex.length; i += 4) used.add(parseInt(hex.slice(i, i + 4), 16));
  }
  const missing = [...used].filter(gid => {
    const char = unicode.get(gid) ?? '';
    if (/^\s*$/.test(char) && char !== '') return false;
    // 글리프 데이터가 잘려 읽을 수 없는 경우도 윤곽선이 없는 것으로 본다.
    return !fonts.some(font => { try { return gid < font.numGlyphs && font.getGlyph(gid).path.commands.length > 0; } catch { return false; } });
  }).map(gid => unicode.get(gid) ?? `#${gid}`);
  return { fonts: fonts.length, usedGlyphs: used.size, missing };
}
