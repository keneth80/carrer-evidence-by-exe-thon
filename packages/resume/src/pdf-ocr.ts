import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ExtractionError } from './pdf.ts';
import type { SourceText } from './source.ts';

// 스캔 이미지 PDF의 글자 인식(사용자 요청 2026-11-23, DECISIONS S1-35).
// 글자 정보가 없는 PDF는 쪽을 그림으로 그린 뒤 이 컴퓨터 안에서 글자를 인식한다(tesseract.js, 한국어·영어 자료는 설치된 패키지에서 읽는다).
// 이력서 그림을 외부로 보내지 않는다. 그림에서는 연락처를 가릴 수 없기 때문이다. 인식한 글은 일반 PDF와 같은 경로(연락처 가림 → Liner 항목 구성)를 탄다.
// 인식 결과에는 오탈자가 있을 수 있어 화면에 따로 알린다(extraction.ts의 OCR_TEXT 경고).

export const OCR_LIMITS = { maxPages: 8, scale: 2, timeoutMs: 100_000, maxOldGenerationSizeMb: 768 } as const;
// 이보다 글자가 적으면 글자 정보가 없는 스캔본으로 본다(쪽 번호나 스캐너 표시만 있는 경우 포함).
export const SCAN_TEXT_THRESHOLD = 30;

export const looksScanned = (source: SourceText) => source.pages.reduce((sum, page) => sum + page.text.replace(/\s/g, '').length, 0) < SCAN_TEXT_THRESHOLD;

// 언어 자료는 패키지마다 다른 폴더에 있어 한 폴더로 모아 둔다(인식기는 폴더 하나만 받는다). 내려받지 않는다.
// 'best_int' 자료를 쓴다: 기본(4.0.0) 한국어 자료는 글자마다 띄어 쓰고("영 업 지원 파 트 장") 영어 자료와 함께 불러오지 못했다(시험 2026-11-23).
const LANGUAGE_DATA = '4.0.0_best_int';
function languageDir(): string {
  const require = createRequire(import.meta.url);
  const target = join(tmpdir(), `career-evidence-tessdata-${LANGUAGE_DATA}`);
  mkdirSync(target, { recursive: true });
  for (const lang of ['kor', 'eng']) {
    const file = join(target, `${lang}.traineddata.gz`);
    if (!existsSync(file)) copyFileSync(join(dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), LANGUAGE_DATA, `${lang}.traineddata.gz`), file);
  }
  return target;
}

export async function ocrPdf(bytes: Uint8Array): Promise<SourceText> {
  const require = createRequire(import.meta.url);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assets = dirname(require.resolve('pdfjs-dist/package.json'));
  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes), cMapUrl: join(assets, 'cmaps') + '/', cMapPacked: true, standardFontDataUrl: join(assets, 'standard_fonts') + '/',
    useSystemFonts: false, verbosity: 0,
  }).promise;
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['kor', 'eng'], 1, { langPath: languageDir(), gzip: true, cacheMethod: 'none' });
  try {
    const pages = [];
    const count = Math.min(document.numPages, OCR_LIMITS.maxPages);
    for (let number = 1; number <= count; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: OCR_LIMITS.scale });
      const factory = (document as unknown as { canvasFactory: { create(width: number, height: number): { canvas: { toBuffer(type: 'image/png'): Buffer }; context: unknown } } }).canvasFactory;
      const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: context, viewport, canvas } as unknown as Parameters<typeof page.render>[0]).promise;
      const { data } = await worker.recognize(canvas.toBuffer('image/png'));
      pages.push({ page: number, text: data.text.normalize('NFC') });
      page.cleanup();
    }
    return { input_kind: 'text_pdf', pages };
  } finally {
    await worker.terminate();
    await document.destroy();
  }
}

type WorkerReply = { ok: true; source: SourceText } | { ok: false };

// 그림 그리기와 글자 인식은 오래 걸리고 메모리를 많이 쓴다. 별도 스레드에서 시간·메모리 한도 안에서만 돈다.
export async function ocrPdfIsolated(bytes: Uint8Array): Promise<SourceText> {
  const { Worker } = await import('node:worker_threads');
  const worker = new Worker(new URL('./pdf-ocr-worker.ts', import.meta.url), { workerData: new Uint8Array(bytes), resourceLimits: { maxOldGenerationSizeMb: OCR_LIMITS.maxOldGenerationSizeMb } });
  try {
    const reply = await new Promise<WorkerReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ExtractionError('OCR_TIMEOUT', '스캔본의 글자를 인식하는 데 시간이 너무 오래 걸립니다. 쪽 수를 줄이거나 내용을 붙여넣어 주세요.')), OCR_LIMITS.timeoutMs);
      worker.once('message', (message: WorkerReply) => { clearTimeout(timer); resolve(message); });
      worker.once('error', () => { clearTimeout(timer); resolve({ ok: false }); });
      worker.once('exit', () => { clearTimeout(timer); resolve({ ok: false }); });
    });
    if (!reply.ok) throw new ExtractionError('OCR_FAILED', '스캔본의 글자를 인식하지 못했습니다. 내용을 붙여넣어 주세요.');
    return reply.source;
  } finally {
    await worker.terminate();
  }
}
