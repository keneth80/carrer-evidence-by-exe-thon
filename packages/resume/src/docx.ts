import { ExtractionError, PDF_ISOLATION, PDF_LIMITS } from './pdf.ts';
import type { SourceText } from './source.ts';

// Word(.docx) 원본에서 본문 텍스트만 읽는다(DECISIONS S1-12). 서식·이미지·머리글/바닥글은 읽지 않는다.
// 쪽 개념이 없어 근거 위치는 붙여넣은 텍스트처럼 page=null + code point 구간이다.

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// 압축 폭탄 방지: 압축을 풀기 전에 중앙 디렉터리의 선언 크기로 거른다.
export const DOCX_LIMITS = { maxEntries: 1000, maxUncompressedBytes: 50 * 1024 * 1024, maxCharacters: PDF_LIMITS.maxCharacters } as const;

export type DocxProblem = { code: string; message: string };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

// ZIP 중앙 디렉터리만 훑어 Word 문서인지, 크기가 한도 안인지 확인한다. 압축은 풀지 않는다.
export function inspectDocx(bytes: Uint8Array): DocxProblem | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = { code: 'DOCX_INVALID', message: 'Word(.docx) 파일 구조를 읽을 수 없습니다. PDF로 저장해 올리거나 내용을 붙여넣어 주세요.' };
  let eocd = -1;
  for (let at = view.length - 22; at >= Math.max(0, view.length - 22 - 0xffff); at--) {
    if (view.readUInt32LE(at) === EOCD) { eocd = at; break; }
  }
  if (eocd < 0) return invalid;
  const entries = view.readUInt16LE(eocd + 10);
  const offset = view.readUInt32LE(eocd + 16);
  if (entries === 0xffff || offset === 0xffffffff) return { code: 'DOCX_TOO_LARGE', message: 'Word 파일이 너무 큽니다.' };
  if (entries > DOCX_LIMITS.maxEntries) return { code: 'DOCX_TOO_LARGE', message: 'Word 파일 구성 요소가 너무 많습니다.' };
  let at = offset;
  let total = 0;
  let hasBody = false;
  for (let index = 0; index < entries; index++) {
    if (at + 46 > view.length || view.readUInt32LE(at) !== CENTRAL) return invalid;
    const flags = view.readUInt16LE(at + 8);
    const size = view.readUInt32LE(at + 24);
    const nameLength = view.readUInt16LE(at + 28);
    const name = view.toString('utf8', at + 46, at + 46 + nameLength);
    if (flags & 1) return { code: 'DOCX_ENCRYPTED', message: '암호가 걸린 Word 파일은 읽을 수 없습니다.' };
    if (size === 0xffffffff) return { code: 'DOCX_TOO_LARGE', message: 'Word 파일이 너무 큽니다.' };
    total += size;
    if (total > DOCX_LIMITS.maxUncompressedBytes) return { code: 'DOCX_TOO_LARGE', message: '압축을 푼 Word 파일 크기가 한도를 넘습니다.' };
    if (name === 'word/document.xml') hasBody = true;
    at += 46 + nameLength + view.readUInt16LE(at + 30) + view.readUInt16LE(at + 32);
  }
  return hasBody ? null : { code: 'DOCX_INVALID', message: 'Word 문서 본문이 없는 압축 파일입니다. PDF 또는 Word(.docx)를 올려 주세요.' };
}

// mammoth는 문단마다 "\n\n"을 붙인다. 한 문단을 한 줄로 두고 빈 문단은 빈 줄로 남긴다.
export function docxRawToSource(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/\n\n/g, '\n').replace(/\s+$/, '').normalize('NFC');
}

export async function extractDocxText(bytes: Uint8Array): Promise<SourceText> {
  const problem = inspectDocx(bytes);
  if (problem) throw new ExtractionError(problem.code, problem.message);
  const mammoth = (await import('mammoth')).default;
  let raw: string;
  try {
    raw = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  } catch {
    throw new ExtractionError('DOCX_PARSE_FAILED', 'Word 파일을 읽는 중 오류가 발생했습니다. PDF로 저장해 올리거나 내용을 붙여넣어 주세요.');
  }
  const text = docxRawToSource(raw);
  if (text.length > DOCX_LIMITS.maxCharacters) throw new ExtractionError('DOCX_TEXT_TOO_LARGE', '추출한 글자 수가 한도를 넘었습니다.');
  return { input_kind: 'docx', pages: [{ page: null, text }] };
}

type WorkerReply = { ok: true; source: SourceText } | { ok: false; code: string; message: string };

// PDF와 같은 한도로 worker thread에서 읽는다. 시간·메모리를 넘으면 종료하고 붙여넣기를 안내한다.
export async function extractDocxTextIsolated(bytes: Uint8Array, limits: { timeoutMs: number; maxOldGenerationSizeMb: number } = PDF_ISOLATION): Promise<SourceText> {
  const { Worker } = await import('node:worker_threads');
  const worker = new Worker(new URL('./docx-worker.ts', import.meta.url), {
    workerData: new Uint8Array(bytes),
    resourceLimits: { maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb },
  });
  try {
    const reply = await new Promise<WorkerReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ExtractionError('DOCX_TIMEOUT', 'Word 파일을 읽는 시간이 너무 오래 걸립니다. 내용을 붙여넣어 주세요.')), limits.timeoutMs);
      worker.once('message', (message: WorkerReply) => { clearTimeout(timer); resolve(message); });
      worker.once('error', (error: Error & { code?: string }) => {
        clearTimeout(timer);
        reject(error.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? new ExtractionError('DOCX_TOO_COMPLEX', 'Word 파일이 너무 복잡해 읽지 못했습니다. 내용을 붙여넣어 주세요.')
          : new ExtractionError('DOCX_PARSE_FAILED', 'Word 파일을 읽는 중 오류가 발생했습니다.'));
      });
      worker.once('exit', code => { clearTimeout(timer); reject(new ExtractionError('DOCX_PARSE_FAILED', `Word 추출 작업이 종료되었습니다(${code}).`)); });
    });
    if (!reply.ok) throw new ExtractionError(reply.code, reply.message);
    return reply.source;
  } finally {
    await worker.terminate();
  }
}
