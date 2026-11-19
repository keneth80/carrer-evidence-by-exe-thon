import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stop 훅 판정(순수 함수). 하네스 원장 지문은 git HEAD·변경 목록·수정 시각이라 내용이 같아도 커밋만 하면 stale이 된다.
// 그래서 원장이 pass일 때의 '작업 트리 내용 hash'를 기억해 두고, stale이라도 내용이 그대로면(커밋만 한 경우) 통과시킨다.

// status: verify_run.py --status 결과, tree: 지금 작업 트리 내용 hash, saved: 기억해 둔 { tree, ledger_created } 또는 null
export function decide({ status, tree, saved }) {
  if (!status?.state) return { action: 'allow', save: null, why: 'no-ledger' };
  if (status.state === 'pass') return { action: 'allow', save: tree ? { tree, ledger_created: status.created ?? null } : null, why: 'pass' };
  const unchanged = status.state === 'stale' && tree && saved && saved.tree === tree && saved.ledger_created === (status.created ?? null);
  if (unchanged) return { action: 'allow', save: null, why: 'content-unchanged' };
  return { action: 'block', save: null, why: status.state };
}

// 커밋 여부·수정 시각과 무관한 작업 트리 내용 hash: 임시 index에 현재 파일(.gitignore 제외)을 담아 tree id를 만든다.
export function workingTreeHash(project) {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-tree-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
    const git = args => execFileSync('git', args, { cwd: project, env, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    git(['read-tree', 'HEAD']);
    git(['add', '-A']);
    return git(['write-tree']);
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
