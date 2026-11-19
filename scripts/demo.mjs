import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// S08 로컬 시연(개발용, 제출 없음): 새 임시 DB로 개발 서버(API·웹·worker)를 띄우고,
// 합성 이력서 파일을 실제 API 경로로 통과시켜(등록 → 추출 확인 → 확정 경력 → mock 검색 → 맞춤 이력서 확정·PDF → 지원서 → 폼 입력 확인)
// 제출 직전 상태를 만든 뒤 화면 주소를 알려 준다. Ctrl+C로 끝내면 서버를 내리고 임시 DB를 지운다(--keep이면 남김).
// 사용: node scripts/demo.mjs [--keep]   (127.0.0.1:4310·4311이 비어 있어야 한다)

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const APP = 'http://127.0.0.1:4310';
const API = 'http://127.0.0.1:4311';
const PROFILE = 'demo';
const work = mkdtempSync(join(tmpdir(), 'ce-demo-'));
const keep = process.argv.includes('--keep');

async function waitHttp(url, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* 아직 열리지 않았다. */ }
    await new Promise(done => setTimeout(done, 300));
  }
  throw new Error(`TIMEOUT ${url}`);
}

function run(args) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('exit', code => (code === 0 ? done(out) : fail(new Error(`${args.join(' ')} exited ${code}`))));
  });
}

const dev = spawn(process.execPath, ['scripts/dev.mjs'], { cwd: ROOT, env: { ...process.env, DATABASE_PATH: join(work, 'app.sqlite'), OBJECT_DIR: join(work, 'objects') }, stdio: ['ignore', 'ignore', 'inherit'] });
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  dev.kill('SIGTERM');
  dev.once('exit', () => {
    if (!keep) rmSync(work, { recursive: true, force: true });
    process.exit(code);
  });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
dev.on('exit', code => { if (!stopping) { console.error(`DEV_SERVER_EXITED ${code}`); process.exit(1); } });

try {
  await waitHttp(`${API}/api/health`);
  await waitHttp(`${APP}/start`);
  const health = await (await fetch(`${API}/api/health`)).json();
  const seed = JSON.parse((await run(['scripts/demo-seed.mjs', PROFILE])).trim().split('\n').at(-1));
  const lines = [
    '',
    '== Career Evidence 로컬 시연 준비 완료 (제출 없음) ==',
    `검색: ${health.live_search === 'mock' ? 'mock(합성 공고, Liner 실호출 아님)' : `${health.live_search}(Liner 실호출·원장 한도)`} · 대화 수정: ${health.conversational_editing} · 자동화: ${health.auto_apply}`,
    `임시 DB: ${join(work, 'app.sqlite')}${keep ? ' (종료 후 남김)' : ' (종료 시 삭제)'}`,
    '',
    `1) ${APP}/start 를 열고 프로필 이름에 '${PROFILE}'를 입력해 로컬 연결합니다.`,
    `2) 지원서(제출 직전 상태): ${APP}/applications/${seed.application_id}  — ${seed.job}`,
    '   · 폼 입력 확인까지 끝난 상태입니다. "승인하고 제출"은 누르지 마세요(로컬 자체 폼에 접수됩니다).',
    `3) 같은 화면의 '이 지원을 기준으로 비슷한 공고 찾기'로 S06 유사 공고·서류 자동 준비를 시연합니다(제출 없음).`,
    `4) 처음부터 보여 주려면 ${APP}/start 에서 fixtures/resumes/의 합성 PDF를 새로 올립니다.`,
    '',
    '끝내려면 Ctrl+C.',
  ];
  console.log(lines.join('\n'));
} catch (error) {
  console.error('DEMO_SETUP_FAILED', error instanceof Error ? error.message : String(error));
  stop(1);
}
