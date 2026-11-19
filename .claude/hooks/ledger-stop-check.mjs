// Stop 훅: 하네스 검증 원장(verify_run.py)이 최신 통과 상태가 아니면 완료 전에 검증을 돌리게 한다.
// - stop_hook_active(이미 한 번 막혀 이어서 진행 중)이면 통과시켜 무한 반복을 막는다.
// - 원장이 pass면 그때의 작업 트리 내용 hash를 .git/ 안에 기억한다. 이후 stale이어도 내용이 같으면(커밋만 함) 통과시킨다.
// - 하네스가 없거나 판정 중 오류가 나면 막지 않는다(작업을 멈추게 하지 않는다).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decide, workingTreeHash } from './ledger-decide.mjs';

function findVerifyRun() {
  const base = join(homedir(), '.claude', 'plugins', 'cache', 'harness-design-kit', 'harness-core');
  if (!existsSync(base)) return null;
  const parts = name => name.split('.').map(Number);
  const versions = readdirSync(base).filter(name => /^\d+(\.\d+)*$/.test(name))
    .sort((a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (y[i] ?? 0) - (x[i] ?? 0); if (d) return d; } return 0; });
  for (const version of versions) {
    const script = join(base, version, 'scripts', 'verify_run.py');
    if (existsSync(script)) return script;
  }
  return null;
}

function main() {
  let event = {};
  try { event = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { event = {}; }
  if (event.stop_hook_active) return;
  const script = findVerifyRun();
  if (!script) return;
  const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let raw;
  try {
    raw = execFileSync('python3', [script, '--status'], { cwd: project, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    raw = typeof error?.stdout === 'string' ? error.stdout : ''; // stale·fail은 종료 코드 1로 끝난다
  }
  const status = JSON.parse(raw.trim().split('\n').at(-1) || '{}');
  const memo = join(project, '.git', 'ledger-tree.json');
  let saved = null;
  try { saved = JSON.parse(readFileSync(memo, 'utf8')); } catch { saved = null; }
  const tree = status.state ? workingTreeHash(project) : null;
  const result = decide({ status, tree, saved });
  if (result.save) { try { writeFileSync(memo, JSON.stringify(result.save)); } catch { /* 기억하지 못해도 판정은 그대로 */ } }
  if (result.action !== 'block') return;
  const reason = `하네스 검증 원장이 '${status.state}' 상태이고, 마지막 통과 이후 파일 내용이 바뀌었거나 통과 시점의 내용 기록이 없습니다(원장 기록 ${status.created ?? '없음'}). 완료 보고 전에 \`python3 ${script}\`를 실행해 원장을 갱신하고 결과(pass/fail)를 보고하세요.`;
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

try { main(); } catch { /* 판정 오류로 작업을 막지 않는다 */ }
