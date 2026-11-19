import { parentPort, workerData } from 'node:worker_threads';
import { extractDocxText } from './docx.ts';
import { ExtractionError } from './pdf.ts';

// 신뢰할 수 없는 Word 파일을 API 스레드 밖에서 읽는다. 결과 또는 오류 코드만 돌려준다.
const bytes = workerData as Uint8Array;
try {
  parentPort?.postMessage({ ok: true, source: await extractDocxText(bytes) });
} catch (error) {
  parentPort?.postMessage(error instanceof ExtractionError
    ? { ok: false, code: error.code, message: error.message }
    : { ok: false, code: 'DOCX_PARSE_FAILED', message: 'Word 파일을 읽는 중 오류가 발생했습니다.' });
}
