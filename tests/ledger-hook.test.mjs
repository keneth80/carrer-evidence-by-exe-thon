import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, workingTreeHash } from '../.claude/hooks/ledger-decide.mjs';

// Stop 훅(하네스 원장 확인): 커밋만 해서 stale이 된 경우는 통과, 내용이 바뀌었으면 막는다.

test('판정: pass면 내용 hash를 기억, stale이어도 같은 원장·같은 내용이면 통과, 내용이 다르거나 기록이 없으면 막음', () => {
  const pass = { state: 'pass', created: '2026-11-19T11:38:20' };
  const stale = { state: 'stale', created: '2026-11-19T11:38:20' };
  assert.deepEqual(decide({ status: pass, tree: 'T1', saved: null }), { action: 'allow', save: { tree: 'T1', ledger_created: pass.created }, why: 'pass' });
  const saved = { tree: 'T1', ledger_created: pass.created };
  assert.equal(decide({ status: stale, tree: 'T1', saved }).action, 'allow', 'commit only');
  assert.equal(decide({ status: stale, tree: 'T2', saved }).action, 'block', 'content changed');
  assert.equal(decide({ status: stale, tree: 'T1', saved: null }).action, 'block', 'no memory of the passing content');
  assert.equal(decide({ status: stale, tree: 'T1', saved: { tree: 'T1', ledger_created: 'older' } }).action, 'block', 'memory belongs to another ledger run');
  assert.equal(decide({ status: stale, tree: null, saved }).action, 'block', 'hash unavailable');
  assert.equal(decide({ status: { state: 'fail', created: pass.created }, tree: 'T1', saved }).action, 'block', 'a failing ledger is never waved through');
  assert.equal(decide({ status: {}, tree: null, saved: null }).action, 'allow', 'no harness ledger');
});

test('내용 hash: 커밋·수정 시각과 무관하고, 내용·새 파일 변경에는 달라지며, .gitignore 파일은 무시한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-hook-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n');
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'first');
    const base = workingTreeHash(dir);
    assert.match(base, /^[0-9a-f]{40}$/);

    writeFileSync(join(dir, 'a.txt'), 'two\n');
    const edited = workingTreeHash(dir);
    assert.notEqual(edited, base, 'content change');
    git('commit', '-q', '-am', 'second');
    assert.equal(workingTreeHash(dir), edited, 'committing the same content keeps the hash');

    utimesSync(join(dir, 'a.txt'), new Date(0), new Date(0));
    assert.equal(workingTreeHash(dir), edited, 'mtime alone does not change it');
    writeFileSync(join(dir, 'ignored.txt'), 'x\n');
    assert.equal(workingTreeHash(dir), edited, 'ignored files do not count');
    writeFileSync(join(dir, 'new.txt'), 'n\n');
    assert.notEqual(workingTreeHash(dir), edited, 'a new untracked file counts');
    assert.equal(git('status', '--porcelain').includes('new.txt'), true, 'the real index is untouched');
    assert.equal(git('diff', '--cached', '--name-only').trim(), '', 'nothing staged in the real index');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
