import { parentPort, workerData } from 'node:worker_threads';
import { extractPdfText, ExtractionError } from './pdf.ts';

// 신뢰할 수 없는 PDF를 API 스레드 밖에서 읽는다. 결과 또는 오류 코드만 돌려준다.
const bytes = workerData as Uint8Array;
try {
  parentPort?.postMessage({ ok: true, source: await extractPdfText(bytes) });
} catch (error) {
  parentPort?.postMessage(error instanceof ExtractionError
    ? { ok: false, code: error.code, message: error.message }
    : { ok: false, code: 'PDF_PARSE_FAILED', message: 'PDF를 읽는 중 오류가 발생했습니다.' });
}
