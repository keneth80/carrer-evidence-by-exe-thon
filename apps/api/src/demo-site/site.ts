import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { demoPosting, FILE_FIELD } from '../../../../packages/apply/src/self-form.ts';
import { sha256Hex } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';

// 자체 테스트 폼 '사이트'. 제품 DB 기록이 아니라 채용사이트 쪽 접수 저장소를 흉내 낸다(demo_site_submissions).
// 우리 서버가 저장소를 통제하므로 같은 접수 키의 중복 접수를 막고(receipt), 접수 여부를 확정·봉인할 수 있다(reconcile).
// 이 강한 보장은 이 자체 폼에만 해당한다. 외부 채용사이트 adapter에 같은 보장을 가정하지 않는다(DECISIONS S5-04).
//
// 개발 검증용 동작(지원 동기 답변에 표식을 넣으면 사이트가 그렇게 행동한다):
//   [demo:slow]   접수 저장 전 4초 지연(전송 중 끊김 재현)
//   [demo:drop]   접수를 저장한 뒤 응답 없이 연결을 끊음(응답 유실 재현)
//   [demo:reject] 저장하지 않고 503 오류(전송 여부가 불분명한 오류 화면 재현)

export type SiteSubmission = {
  submission_key: string; posting_id: string; state: 'accepted' | 'sealed'; receipt_number: string | null;
  fields_json: string | null; file_name: string | null; file_size: number | null; file_sha256: string | null; created_at_ms: number;
};

const KEY = /^[a-zA-Z0-9_-]{1,128}$/;
const PDF_LIMIT = 5 * 1024 * 1024;
const siteError = (request: ProductRequest, status: number, code: string, message: string, fields?: string[]): Reply =>
  ({ status, body: { code, message, request_id: request.requestId, ...(fields ? { fields } : {}) } });

export function getPosting(request: ProductRequest, postingId: string): Reply {
  const posting = demoPosting(postingId);
  if (!posting) return siteError(request, 404, 'POSTING_NOT_FOUND', '공고를 찾을 수 없습니다.');
  return { status: 200, body: { ...posting, file: { field: FILE_FIELD, accept: 'application/pdf', required: true }, notice: '개발용 자체 테스트 폼입니다. 실제 기업에 접수되지 않습니다.' } };
}

export const lookupSubmission = (db: DatabaseSync, key: string) =>
  db.prepare('SELECT * FROM demo_site_submissions WHERE submission_key = ?').get(key) as SiteSubmission | undefined;

// 접수 기록이 없으면 이 키로 더는 접수되지 않게 닫는다. 호출자의 transaction 안에서 쓴다.
export function sealSubmission(db: DatabaseSync, key: string, postingId: string, nowMs: number): SiteSubmission {
  const existing = lookupSubmission(db, key);
  if (existing) return existing;
  db.prepare("INSERT INTO demo_site_submissions (submission_key, posting_id, state, created_at_ms) VALUES (?, ?, 'sealed', ?)").run(key, postingId, nowMs);
  return lookupSubmission(db, key)!;
}

function receiptNumber(nowMs: number): string {
  const day = new Date(nowMs).toISOString().slice(0, 10).replaceAll('-', '');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = [...randomBytes(6)].map(byte => alphabet[byte % alphabet.length]).join('');
  return `R-${day}-${code}`;
}

function receiptBody(row: SiteSubmission) {
  return { receipt_number: row.receipt_number, posting_id: row.posting_id, submission_key: row.submission_key, accepted_at: new Date(row.created_at_ms).toISOString(), file: { name: row.file_name, size: row.file_size, sha256: row.file_sha256 } };
}

// 지원서 접수. 같은 접수 키로 다시 보내면 처음 접수를 그대로 돌려준다(중복 접수 없음). 닫힌 키는 거절한다.
export async function submitApplication(db: DatabaseSync, request: ProductRequest, postingId: string): Promise<Reply> {
  const posting = demoPosting(postingId);
  if (!posting) return siteError(request, 404, 'POSTING_NOT_FOUND', '공고를 찾을 수 없습니다.');
  const type = String(request.headers['content-type'] ?? '');
  if (!/^multipart\/form-data\b/i.test(type)) return siteError(request, 415, 'MULTIPART_REQUIRED', '지원서 형식이 올바르지 않습니다.');
  let form: FormData;
  try { form = await new Request('http://local/submit', { method: 'POST', headers: { 'content-type': type }, body: new Uint8Array(request.body) }).formData(); } catch { return siteError(request, 400, 'FORM_INVALID', '지원서를 읽을 수 없습니다.'); }
  const rawKey = form.get('submission_key');
  const key = typeof rawKey === 'string' && rawKey ? rawKey : `site_${randomBytes(12).toString('hex')}`;
  if (!KEY.test(key)) return siteError(request, 400, 'SUBMISSION_KEY_INVALID', '접수 키 형식이 올바르지 않습니다.');

  const fields: Record<string, string> = {};
  const missing: string[] = [];
  for (const question of posting.questions) {
    const value = form.get(question.question_id);
    const text = typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : '';
    if (question.kind === 'checkbox') fields[question.question_id] = text === 'on' ? 'on' : '';
    else fields[question.question_id] = text;
    if (question.required && !fields[question.question_id].trim()) missing.push(question.question_id);
  }
  const file = form.get(FILE_FIELD);
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : null;
  if (!bytes || !bytes.length || bytes.length > PDF_LIMIT || Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') missing.push(FILE_FIELD);
  // 필수 입력 오류는 접수하지 않는다(전송 전 명확한 오류). 접수 키도 소모하지 않는다.
  if (missing.length) return siteError(request, 422, 'FORM_INVALID', '필수 항목을 확인해 주세요.', missing);

  const motivation = fields.motivation ?? '';
  if (motivation.includes('[demo:reject]')) return siteError(request, 503, 'SITE_UNAVAILABLE', '일시적인 오류로 접수하지 못했습니다. 잠시 후 확인해 주세요.');
  if (motivation.includes('[demo:slow]')) await delay(4000);

  const now = Date.now();
  let row: SiteSubmission | undefined;
  db.exec('BEGIN IMMEDIATE');
  try {
    row = lookupSubmission(db, key);
    if (!row) {
      db.prepare("INSERT INTO demo_site_submissions (submission_key, posting_id, state, receipt_number, fields_json, file_name, file_size, file_sha256, created_at_ms) VALUES (?, ?, 'accepted', ?, ?, ?, ?, ?, ?)")
        .run(key, postingId, receiptNumber(now), JSON.stringify(fields), (file as File).name.slice(0, 200) || 'resume.pdf', bytes!.length, sha256Hex(bytes!), now);
      row = lookupSubmission(db, key)!;
      db.exec('COMMIT');
      if (motivation.includes('[demo:drop]')) return { status: 201, drop: true };
      return { status: 201, body: receiptBody(row) };
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
  if (row.state === 'sealed') return siteError(request, 409, 'SUBMISSION_CLOSED', '이 접수 요청은 이미 닫혔습니다. 새 지원 절차로 다시 진행해 주세요.');
  if (row.posting_id !== postingId) return siteError(request, 409, 'SUBMISSION_KEY_REUSED', '다른 공고에 사용한 접수 키입니다.');
  return { status: 200, body: receiptBody(row), headers: { 'Idempotent-Replay': 'true' } };
}
