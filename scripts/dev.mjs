import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readConfig } from '../apps/api/src/config.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const config = readConfig();
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
if (!existsSync(vite)) throw new Error('DEPENDENCIES_MISSING: run npm ci');
console.log(`개발 화면: ${config.origin} | 검색 ${config.mode === 'live' ? 'Liner live(원장 호출 수·예산 한도 적용)' : 'mock'}·mock 대화 worker 포함 | 지원은 자체 테스트 폼만`);
const children = [
  spawn(process.execPath, ['apps/api/src/main.ts'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [vite, '--config', 'apps/web/vite.config.ts'], { cwd: root, stdio: 'inherit' }),
];
let stopping = false;
// worker는 API가 DB 초기화·migration을 끝낸 뒤 시작한다. 두 프로세스가 빈 DB를 동시에 초기화하지 않게 한다.
async function startWorkerWhenApiReady() {
  for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
    try {
      const response = await fetch(`http://${config.host}:${config.port}/api/health`);
      if (response.ok) {
        const worker = spawn(process.execPath, ['apps/worker/src/main.ts'], { cwd: root, stdio: 'inherit' });
        children.push(worker);
        worker.on('error', error => { console.error('WORKER_START_FAILED', error.message); stop(1); });
        worker.on('exit', code => { if (!stopping) stop(code ?? 1); });
        return;
      }
    } catch { /* API가 아직 열리지 않았다. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!stopping) { console.error('WORKER_START_FAILED: API health did not respond'); stop(1); }
}
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}
for (const child of children) {
  child.on('error', error => { console.error('DEV_START_FAILED', error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
startWorkerWhenApiReady();
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

