import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { SourceText } from './source.ts';
import { pageText } from './pdf-layout.ts';

export const PDF_LIMITS = { maxPages: 30, maxCharacters: 200_000 } as const;

export class ExtractionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function pdfjsAssetDir(name: 'cmaps' | 'standard_fonts'): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('pdfjs-dist/package.json')), name) + '/';
}

type TextItem = { str?: string; hasEOL?: boolean; transform?: number[]; width?: number; height?: number };

// 키나 네트워크 없이 로컬에서 텍스트 레이어만 읽는다. 스캔 이미지 PDF는 OCR 없이 빈 텍스트가 된다.
export async function extractPdfText(bytes: Uint8Array): Promise<SourceText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let document;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      cMapUrl: pdfjsAssetDir('cmaps'), cMapPacked: true,
      standardFontDataUrl: pdfjsAssetDir('standard_fonts'),
      useSystemFonts: false, disableFontFace: true,
      verbosity: 0,
    }).promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') throw new ExtractionError('PDF_ENCRYPTED', '암호가 걸린 PDF는 읽을 수 없습니다.');
    if (name === 'InvalidPDFException') throw new ExtractionError('PDF_INVALID', 'PDF 구조를 읽을 수 없습니다.');
    throw new ExtractionError('PDF_PARSE_FAILED', 'PDF를 여는 중 오류가 발생했습니다.');
  }
  try {
    if (document.numPages > PDF_LIMITS.maxPages) {
      throw new ExtractionError('PDF_TOO_MANY_PAGES', `PDF는 최대 ${PDF_LIMITS.maxPages}쪽까지 읽습니다.`);
    }
    const pages = [];
    let total = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      // 글자 조각의 위치를 함께 읽는다. 그린 순서가 뒤섞인 PDF(표·단·글상자)는 화면 위치로 다시 맞춘다(pdf-layout.ts).
      const pieces = (content.items as TextItem[]).filter(item => typeof item.str === 'string').map(item => ({
        str: item.str as string, x: item.transform?.[4] ?? 0, y: item.transform?.[5] ?? 0, width: item.width ?? 0,
        height: item.height || Math.abs(item.transform?.[3] ?? 0), eol: item.hasEOL,
      }));
      const text = pageText(pieces).text.normalize('NFC');
      total += text.length;
      if (total > PDF_LIMITS.maxCharacters) throw new ExtractionError('PDF_TEXT_TOO_LARGE', '추출한 글자 수가 한도를 넘었습니다.');
      pages.push({ page: number, text });
      page.cleanup();
    }
    return { input_kind: 'text_pdf', pages };
  } finally {
    await document.destroy();
  }
}

export const PDF_ISOLATION = { timeoutMs: 20_000, maxOldGenerationSizeMb: 256 } as const;

type WorkerReply = { ok: true; source: SourceText } | { ok: false; code: string; message: string };

// worker thread에서 추출하고 시간·메모리 한도를 넘으면 종료한다. API 요청 처리를 막지 않는다.
export async function extractPdfTextIsolated(bytes: Uint8Array, limits: { timeoutMs: number; maxOldGenerationSizeMb: number } = PDF_ISOLATION): Promise<SourceText> {
  const { Worker } = await import('node:worker_threads');
  const worker = new Worker(new URL('./pdf-worker.ts', import.meta.url), {
    workerData: new Uint8Array(bytes),
    resourceLimits: { maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb },
  });
  try {
    const reply = await new Promise<WorkerReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ExtractionError('PDF_TIMEOUT', 'PDF를 읽는 시간이 너무 오래 걸립니다. 내용을 붙여넣어 주세요.')), limits.timeoutMs);
      worker.once('message', (message: WorkerReply) => { clearTimeout(timer); resolve(message); });
      worker.once('error', (error: Error & { code?: string }) => {
        clearTimeout(timer);
        reject(error.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? new ExtractionError('PDF_TOO_COMPLEX', 'PDF가 너무 복잡해 읽지 못했습니다. 내용을 붙여넣어 주세요.')
          : new ExtractionError('PDF_PARSE_FAILED', 'PDF를 읽는 중 오류가 발생했습니다.'));
      });
      worker.once('exit', code => { clearTimeout(timer); reject(new ExtractionError('PDF_PARSE_FAILED', `PDF 추출 작업이 종료되었습니다(${code}).`)); });
    });
    if (!reply.ok) throw new ExtractionError(reply.code, reply.message);
    return reply.source;
  } finally {
    await worker.terminate();
  }
}
