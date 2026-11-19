import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson, sha256 } from '../../../../packages/apply/src/payload.ts';
import { iso, isPlainObject, newId, problem, readJson } from '../http.ts';
import type { ProductRequest, Reply } from '../http.ts';
import type { Principal } from '../auth.ts';
import { idempotentWrite, readIdempotencyKey } from '../idempotency.ts';
import { getJobSnapshot } from '../search/repository.ts';
import type { ApplyDeps } from './applications.ts';

// 사용자가 제품 밖에서 직접 지원한 기록. 같은 공고(job_key)면 새 지원을 막고, 회사·직무만 같으면 확인 안내에만 쓴다
// (회사·제목 유사성만으로 같은 공고라고 확정하지 않는다: SERVICE_RULES).

export type ExternalRow = { id: string; workspace_id: string; job_snapshot_id: string | null; job_key: string | null; company_name: string; title: string; channel: string; applied_on: string; note: string; created_at_ms: number };

const KEYS = ['applied_on', 'channel', 'company_name', 'job_snapshot_id', 'note', 'title'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const normalizeName = (text: string) => text.replace(/\(합성\)/g, '').replace(/\s+/g, '').toLowerCase();

export function externalBody(row: ExternalRow) {
  return { id: row.id, job_snapshot_id: row.job_snapshot_id, job_key: row.job_key, company_name: row.company_name, title: row.title, channel: row.channel, applied_on: row.applied_on, note: row.note, created_at: iso(row.created_at_ms) };
}

// 같은 공고 기록(job_key 일치)과 회사·직무명이 같은 기록(확인 필요)을 함께 돌려준다.
export function matchingExternal(db: DatabaseSync, ws: string, job: { job_key: string; company_name: string; title: string }): ExternalRow[] {
  const rows = db.prepare('SELECT * FROM ce8_external_applications WHERE workspace_id = ? ORDER BY created_at_ms DESC').all(ws) as ExternalRow[];
  return rows.filter(row => row.job_key === job.job_key || (row.job_key === null && normalizeName(row.company_name) === normalizeName(job.company_name) && normalizeName(row.title) === normalizeName(job.title)));
}

function validDate(value: string, nowMs: number): boolean {
  if (!DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value && time <= nowMs + 24 * 60 * 60 * 1000;
}

export function createExternalApplication(deps: ApplyDeps, request: ProductRequest, principal: Principal): Reply {
  const key = readIdempotencyKey(request);
  if ('reply' in key) return key.reply;
  const parsed = readJson(request, deps.config.limits.jsonBodyBytes);
  if (!parsed.ok) return parsed.reply;
  const body = parsed.value;
  const text = (value: unknown, max: number, min = 1) => typeof value === 'string' && value.trim().length >= min && value.length <= max;
  if (!isPlainObject(body) || Object.keys(body).sort().join() !== KEYS.join() || !text(body.channel, 60) || !text(body.note, 500, 0) || typeof body.applied_on !== 'string' || !validDate(body.applied_on, request.nowMs)
    || (body.job_snapshot_id !== null && typeof body.job_snapshot_id !== 'string') || !text(body.company_name, 100) || !text(body.title, 100)) {
    return problem(request, 400, 'INVALID_EXTERNAL_APPLICATION', '회사·직무·지원 경로·지원일(오늘 이전)을 확인해 주세요.');
  }
  const ws = principal.workspaceId;
  let jobKey: string | null = null;
  if (typeof body.job_snapshot_id === 'string') {
    const job = getJobSnapshot(deps.db, ws, body.job_snapshot_id);
    if (!job) return problem(request, 404, 'JOB_NOT_FOUND', '공고를 찾을 수 없습니다.');
    if (job.company_name !== body.company_name || job.title !== body.title) return problem(request, 422, 'EXTERNAL_JOB_MISMATCH', '선택한 공고의 회사·직무명과 다릅니다.');
    jobKey = job.job_key;
  }
  return idempotentWrite(deps.db, request, ws, 'createExternalApplication', key.key, sha256(canonicalJson(body)), () => {
    if (jobKey) {
      const app = deps.db.prepare('SELECT id FROM ce7_applications WHERE workspace_id = ? AND job_key = ?').get(ws, jobKey) as { id: string } | undefined;
      if (app) return problem(request, 409, 'APPLICATION_EXISTS', '이 공고의 지원 건이 이미 있습니다. 지원 이력에서 확인해 주세요.', { application_id: app.id });
      if (deps.db.prepare('SELECT 1 FROM ce8_external_applications WHERE workspace_id = ? AND job_key = ?').get(ws, jobKey)) return problem(request, 409, 'EXTERNAL_APPLICATION_EXISTS', '이 공고의 외부 지원 기록이 이미 있습니다.');
    }
    const id = newId('external');
    deps.db.prepare('INSERT INTO ce8_external_applications (id, workspace_id, job_snapshot_id, job_key, company_name, title, channel, applied_on, note, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ws, typeof body.job_snapshot_id === 'string' ? body.job_snapshot_id : null, jobKey, String(body.company_name).trim(), String(body.title).trim(), String(body.channel).trim(), String(body.applied_on), String(body.note), request.nowMs);
    return { status: 201, body: externalBody(deps.db.prepare('SELECT * FROM ce8_external_applications WHERE id = ?').get(id) as ExternalRow) };
  });
}

export function listExternalApplications(deps: ApplyDeps, _request: ProductRequest, principal: Principal): Reply {
  const rows = deps.db.prepare('SELECT * FROM ce8_external_applications WHERE workspace_id = ? ORDER BY applied_on DESC, created_at_ms DESC LIMIT 200').all(principal.workspaceId) as ExternalRow[];
  return { status: 200, body: { items: rows.map(externalBody) } };
}
