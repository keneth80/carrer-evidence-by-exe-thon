import { parentPort, workerData } from 'node:worker_threads';
import { ocrPdf } from './pdf-ocr.ts';

// 스캔본 글자 인식을 API 스레드 밖에서 돌린다. 결과 또는 실패 여부만 돌려준다.
try {
  parentPort?.postMessage({ ok: true, source: await ocrPdf(workerData as Uint8Array) });
} catch {
  parentPort?.postMessage({ ok: false });
}
