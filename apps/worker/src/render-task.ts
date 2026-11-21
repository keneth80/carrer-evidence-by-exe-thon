import { createHash, randomUUID } from 'node:crypto';
import { RenderGlyphError, renderResumePdf } from '../../../packages/render/src/resume-pdf.ts';
import type { FactLike, ResumeBlock } from '../../../packages/tailor/src/types.ts';
import type { ObjectStore } from '../../api/src/resume/storage.ts';
import { claimTask, completeTask, failTask, holdsLease, inTransaction, MAX_ATTEMPTS, withHeartbeat } from './lease.ts';
import type { LeaseDeps } from './lease.ts';

// render_resume 작업: 확정(final) 이력서 revision을 실제 PDF로 만들고 bytes hash와 함께 저장한다.
// 외부 전송이 없는 로컬 작업이라 lease 만료 후 다시 실행해도 안전하다. 파일은 transaction 밖에서 먼저 쓰고,
// lease를 잃어 기록하지 못하면 지운다.

export type RenderWorkerDeps = LeaseDeps & { store: ObjectStore };
export type RenderRunResult = 'idle' | 'succeeded' | 'failed' | 'lease_lost';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;

// 다운로드 파일명. 경로 구분자·제어문자를 빼고 길이를 제한한다(저장 경로에는 쓰지 않는다).
export function artifactFilename(company: string, title: string, revision: number): string {
  const clean = (text: string) => text.replace(/\((합성)\)/g, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  return `이력서_${clean(company) || '회사'}_${clean(title) || '직무'}_v${revision}.pdf`;
}

export async function runRenderTask(deps: RenderWorkerDeps, taskId?: string): Promise<RenderRunResult> {
  const task = claimTask(deps, 'render_resume', taskId);
  if (!task) return 'idle';
  const failWith = (code: string): RenderRunResult => failTask(deps, task, code, 'not_dispatched') ? 'failed' : 'lease_lost';
  if (task.generation > MAX_ATTEMPTS) return failWith('RENDER_ATTEMPTS_EXCEEDED');
  let input: { resume_revision_id: string; content_hash: string };
  try { input = JSON.parse(task.inputJson); } catch { return failWith('TASK_INPUT_INVALID'); }
  const ws = task.workspaceId;
  // 회사별 배치(layout.ts)는 확정 경력의 순서·종류로 블록을 묶는다. 사실은 블록 근거와 같은 확정 경력 버전에서 읽는다.
  const revision = deps.db.prepare(`SELECT r.blocks_json, r.content_hash, r.state, r.finalized_at_ms, r.revision, j.company_name, j.title, f.facts_json
    FROM ce7_resume_revisions r JOIN ce7_job_snapshots j ON j.workspace_id = r.workspace_id AND j.id = r.job_snapshot_id
    LEFT JOIN ce7_fact_revisions f ON f.workspace_id = r.workspace_id AND f.id = r.fact_revision_id
    WHERE r.workspace_id = ? AND r.id = ?`).get(ws, input.resume_revision_id);
  if (!revision) return failWith('RESUME_REVISION_MISSING');
  // 확정 시점 내용과 같은 revision만 렌더한다. 확정 미리보기와 PDF의 content hash가 같아야 한다.
  if (revision.state !== 'final' || revision.content_hash !== input.content_hash) return failWith('RESUME_NOT_FINAL');

  let rendered;
  try {
    rendered = await withHeartbeat(deps, task, () => renderResumePdf({ blocks: JSON.parse(String(revision.blocks_json)) as ResumeBlock[], title: '이력서', finalizedAt: new Date(Number(revision.finalized_at_ms)),
      facts: revision.facts_json ? JSON.parse(String(revision.facts_json)) as FactLike[] : [] }));
  } catch (error) {
    return failWith(error instanceof RenderGlyphError ? 'RENDER_GLYPH_MISSING' : 'RENDER_FAILED');
  }
  const artifactId = newId('artifact');
  const objectKey = `artifacts/${artifactId}.pdf`;
  deps.store.put(ws, objectKey, rendered.bytes);
  let saved = false;
  try {
    saved = inTransaction(deps.db, () => {
      if (!holdsLease(deps, task)) return false;
      deps.db.prepare('INSERT INTO ce7_artifacts (id, workspace_id, resume_revision_id, filename, mime_type, byte_size, sha256, object_key, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(artifactId, ws, input.resume_revision_id, artifactFilename(String(revision.company_name), String(revision.title), Number(revision.revision)), 'application/pdf', rendered.bytes.length, sha256(rendered.bytes), objectKey, deps.now());
      completeTask(deps, task, 'succeeded', null, { artifact_id: artifactId, page_count: rendered.pageCount, render_version: rendered.renderVersion }, 'not_dispatched');
      return true;
    });
  } finally {
    // 기록하지 못한 파일(lease 상실·저장 예외)은 남기지 않는다.
    if (!saved) deps.store.remove(ws, objectKey);
  }
  return saved ? 'succeeded' : 'lease_lost';
}
