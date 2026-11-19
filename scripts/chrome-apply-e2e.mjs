import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launchChrome, sleep } from './lib/cdp.mjs';

// S05 실제 Chrome 검증(개발용): 임시 DB로 개발 서버(API·웹·worker)를 띄우고, 임시 프로필 Chrome에 확장을 올려
// 웹 화면 클릭 → 확장 연결 → 자체 폼 입력·첨부·readback → 웹에서 승인 → 확장 제출 → 접수 근거,
// 입력 충돌 거절, 전송 중 브라우저 강제 종료 → 재시작 → 재제출 없음 → 접수 결과 확인까지 확인한다.
// 기본은 '제출 직전'에서 멈춘다: 연결 → 폼 입력·첨부·readback → 웹 승인 화면 표시까지만 하고 승인·제출 버튼은 누르지 않는다.
// 로컬 자체 폼에 실제 제출까지 하는 S05 전체 검증은 --submit-local을 줄 때만 실행한다.
// 사용: node scripts/chrome-apply-e2e.mjs [--headful] [--submit-local] [--hold=초]   (127.0.0.1:4310·4311이 비어 있어야 한다)
//   --headful: Chrome 창을 띄워 진행을 보여 주고 단계 사이에 간격을 둔다. --hold: 끝난 화면을 닫기 전 대기(창 모드 기본 30초).
// 합성 이력서·합성 공고·가상 지원자 정보만 쓴다. 실제 기업 사이트에는 접속하지 않는다.

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const APP = 'http://127.0.0.1:4310';
const API = 'http://127.0.0.1:4311';
const headless = !process.argv.includes('--headful');
const submitLocal = process.argv.includes('--submit-local');
const holdArg = process.argv.find(arg => arg.startsWith('--hold='));
const holdMs = (holdArg ? Number(holdArg.slice(7)) : headless ? 0 : 30) * 1000;
// 창 모드에서는 사람이 따라볼 수 있도록 단계 사이에 간격을 둔다.
const pace = () => sleep(headless ? 0 : 1500);
const work = mkdtempSync(join(tmpdir(), 'ce-e2e-'));
const shots = join(work, 'shots');
mkdirSync(shots);
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, result: ok ? 'PASS' : 'FAIL', detail }); if (!ok) throw new Error(`CHECK_FAILED: ${name} ${detail}`); };
const ANSWERS = { applicant_name: '김가상 (합성)', applicant_email: 'synthetic.applicant@example.com', motivation: '공고의 React·TypeScript 업무와 확인된 경력이 맞아 지원합니다.\n운영 화면 개선 경험을 살리겠습니다.', privacy_consent: '동의' };
const LABELS = { applicant_name: '이름', applicant_email: '이메일', motivation: '지원 동기', privacy_consent: '개인정보 수집·이용 동의' };
const answers = values => Object.entries(values).map(([id, answer]) => ({ question_id: id, question_text: LABELS[id], answer, source: 'user_answer', source_ids: [`ua_${id}`] }));

async function waitHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { if ((await fetch(url)).ok) return; } catch { /* 아직 시작 전 */ } await sleep(300); }
  throw new Error(`SERVER_NOT_READY: ${url}`);
}

async function login() {
  const response = await fetch(`${API}/api/v1/local-dev/session`, { method: 'POST', headers: { Origin: APP, 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: 'e2e' }) });
  const body = await response.json();
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const call = async (method, path, json, raw) => {
    const headers = { Cookie: cookie };
    if (method !== 'GET') Object.assign(headers, { Origin: APP, 'X-CSRF-Token': body.csrf_token, 'Idempotency-Key': `e2e-${crypto.randomUUID()}` });
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    const result = await fetch(API + path, { method, headers, body: raw ?? (json === undefined ? undefined : JSON.stringify(json)) });
    return { status: result.status, body: await result.json().catch(() => null) };
  };
  return { get: path => call('GET', path), post: (path, json) => call('POST', path, json), patch: (path, json) => call('PATCH', path, json), upload: (path, form) => call('POST', path, undefined, form) };
}

async function until(read, done, timeoutMs = 30_000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await read(); if (done(value)) return value; await sleep(300); }
  throw new Error(`TIMEOUT: ${label}`);
}

// 제품 화면 이전 단계(S01·S02·S04)는 API로 준비한다: 합성 이력서 확정 → mock 검색 → 공고 두 개의 확정 PDF.
async function prepareData(http) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(join(ROOT, 'fixtures/resumes/frontend.synthetic.pdf'))], { type: 'application/pdf' }), 'frontend.synthetic.pdf');
  const uploaded = await http.upload('/api/v1/resume-documents', form);
  const documentId = uploaded.body.resource_id;
  await until(() => http.get(`/api/v1/resume-documents/${documentId}`), r => r.body.extraction_status === 'review_required', 30_000, 'extraction');
  const draft = (await http.get(`/api/v1/resume-documents/${documentId}/extraction`)).body;
  const facts = (await http.post(`/api/v1/resume-documents/${documentId}/fact-revisions`, { extraction_id: draft.id, expected_parent_revision_id: null, facts: draft.facts })).body;
  const intent = (await http.post('/api/v1/search-intents', { fact_revision_id: facts.id, conditions: [] })).body;
  const search = (await http.post('/api/v1/resume-searches', { intent_id: intent.id, max_candidates: 10 })).body;
  const run = await until(() => http.get(`/api/v1/resume-searches/${search.resource_id}`), r => r.body.state === 'succeeded', 30_000, 'search');
  const prepared = [];
  for (const jobId of run.body.job_snapshot_ids.slice(0, 2)) {
    const session = (await http.post('/api/v1/tailoring-sessions', { job_snapshot_id: jobId, fact_revision_id: facts.id })).body;
    const revision = (await http.get(`/api/v1/resume-revisions/${session.current_resume_revision_id}`)).body;
    const final = await http.post(`/api/v1/resume-revisions/${revision.id}/finalize`, { expected_content_hash: revision.content_hash, reviewed: true });
    if (final.status !== 200) throw new Error(`FINALIZE_FAILED ${JSON.stringify(final.body)}`);
    await http.post('/api/v1/artifacts', { resume_revision_id: revision.id });
    const artifacts = await until(() => http.get(`/api/v1/resume-revisions/${revision.id}/artifacts`), r => r.body.items.length > 0, 60_000, 'render');
    prepared.push({ jobId, revision, artifact: artifacts.body.items[0], job: (await http.get(`/api/v1/job-snapshots/${jobId}`)).body });
  }
  return prepared;
}

const pageJson = (page, path, init = {}) => page.evaluate(`(async () => { const csrf = (document.cookie.match(/ce_csrf=([a-f0-9]{64})/) || [])[1]; const init = ${JSON.stringify(init)}; if (init.method && init.method !== 'GET') init.headers = { ...(init.headers || {}), 'X-CSRF-Token': csrf, 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'application/json' }; const r = await fetch(${JSON.stringify(path)}, init); return { status: r.status, body: await r.json().catch(() => null) }; })()`);
const clickText = (page, selector, text) => page.evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)}) && !e.disabled); if (!el) return false; el.click(); return true; })()`);
const save = async (page, name) => writeFileSync(join(shots, `${name}.png`), await page.screenshot());
const executor = (sw, expression) => sw.evaluate(`(${expression}).then(value => ({ ok: true, value }), error => ({ ok: false, code: error.code, message: error.message }))`);

async function approveInWeb(web, applicationId) {
  await web.goto(`${APP}/applications/${applicationId}`);
  await web.waitFor(`document.body.innerText.includes('폼 입력을 확인했습니다')`);
  await web.evaluate(`document.querySelector('label.confirm-check input').click()`);
  await sleep(200);
  check(`web approve button (${applicationId.slice(-6)})`, await clickText(web, 'button', '승인하고 제출'));
  await web.waitFor(`document.body.innerText.includes('제출을 승인했습니다')`);
  const history = await pageJson(web, `/api/v1/job-applications/${applicationId}/history`);
  return history.body.attempts.at(-1).id;
}

const dev = spawn(process.execPath, ['scripts/dev.mjs'], { cwd: ROOT, env: { ...process.env, DATABASE_PATH: join(work, 'app.sqlite'), OBJECT_DIR: join(work, 'objects') }, stdio: ['ignore', 'pipe', 'pipe'] });
let devLog = '';
dev.stdout.on('data', chunk => { devLog += chunk; });
dev.stderr.on('data', chunk => { devLog += chunk; });
let browser;
let exitCode = 0;
try {
  await waitHttp(`${API}/api/health`);
  await waitHttp(`${APP}/applications`);
  const http = await login();
  scenario: {
  const [first, second] = await prepareData(http);
  const created = [];
  for (const [item, values] of [[first, ANSWERS], [second, { ...ANSWERS, motivation: '전송 중 종료 검증용 지원서입니다. [demo:slow]' }]]) {
    const app = await http.post('/api/v1/job-applications', { job_snapshot_id: item.jobId, resume_revision_id: item.revision.id, artifact_id: item.artifact.id, answers: answers(values) });
    check(`application created (${item.job.company_name})`, app.status === 201, JSON.stringify(app.body));
    created.push({ ...item, application: app.body, target: `${APP}/demo/apply/${item.job.job_key.split(':')[1]}` });
  }

  browser = await launchChrome({ profile: join(work, 'chrome-profile'), headless });
  const extensionId = await browser.loadExtension(join(ROOT, 'apps/extension'));
  const swTarget = await browser.waitTarget(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`));
  const sw = await browser.attach(swTarget.targetId);
  await sw.waitFor('globalThis.ceExecutor !== undefined');

  // 웹 화면: 로컬 세션으로 로그인한 뒤 지원 이력에서 확장 연결 코드를 만든다.
  const web = await browser.newPage(`${APP}/start`);
  check('web login', (await pageJson(web, '/api/v1/local-dev/session', { method: 'POST', body: JSON.stringify({ profile: 'e2e' }) })).status === 201);
  await web.goto(`${APP}/applications`);
  await web.waitFor(`document.body.innerText.includes('확장 연결 코드 만들기')`);
  check('pairing button', await clickText(web, 'button', '확장 연결 코드 만들기'));
  await web.waitFor(`document.querySelector('[data-testid="pairing-code"]')`);
  const code = await web.evaluate(`document.querySelector('[data-testid="pairing-code"]').textContent`);
  await save(web, '01-applications-pairing');
  await pace();
  const paired = await executor(sw, `ceExecutor.pair(${JSON.stringify(code)}, 'E2E Chrome')`);
  check('extension paired with one-time code', paired.ok, JSON.stringify(paired));
  check('pairing code is single use', !(await executor(sw, `ceExecutor.pair(${JSON.stringify(code)}, 'again')`)).ok);
  const status = await executor(sw, 'ceExecutor.status()');
  check('extension keeps device token after failed re-pair', status.ok && status.value.paired === true, JSON.stringify(status));

  // A: 정상 제출.
  const [appA, appB] = created;
  const formA = await browser.newPage(appA.target);
  await formA.waitFor(`document.querySelector('form[data-ce-form="self-form.v1"]')`);
  await pace();
  const prepA = await executor(sw, `ceExecutor.prepare(${JSON.stringify(appA.application.id)})`);
  check('A form filled, file attached, readback verified', prepA.ok && prepA.value.ok && prepA.value.observation.state === 'verified', JSON.stringify(prepA));
  check('A attached file hash equals final PDF', prepA.value.observation.readback.file.sha256 === appA.artifact.sha256);
  const pageValues = await formA.evaluate(`(() => { const f = document.querySelector('form'); return { name: f.applicant_name.value, motivation: f.motivation.value, consent: f.privacy_consent.checked, file: f.resume_file.files[0]?.name, size: f.resume_file.files[0]?.size }; })()`);
  check('A Korean multi-line values present in the page', pageValues.name === ANSWERS.applicant_name && pageValues.motivation === ANSWERS.motivation && pageValues.consent === true && pageValues.size === appA.artifact.byte_size, JSON.stringify(pageValues));
  await save(formA, '02-form-filled');
  await pace();
  if (!submitLocal) {
    // 제출 직전: 웹 지원서 화면에 '폼 입력 확인됨'과 승인 버튼이 보이는 것까지만 확인하고 누르지 않는다.
    await web.goto(`${APP}/applications/${appA.application.id}`);
    await web.waitFor(`document.body.innerText.includes('폼 입력을 확인했습니다')`);
    await web.send('Page.bringToFront');
    await web.evaluate(`[...document.querySelectorAll('button')].find(e => e.textContent.includes('승인하고 제출'))?.scrollIntoView({ block: 'center' })`);
    check('web shows approval step without clicking it', await web.evaluate(`[...document.querySelectorAll('button')].some(e => e.textContent.includes('승인하고 제출'))`));
    await save(web, '03-ready-before-submit');
    const db = new DatabaseSync(join(work, 'app.sqlite'), { readOnly: true });
    const counts = db.prepare('SELECT (SELECT count(*) FROM demo_site_submissions) AS receipts, (SELECT count(*) FROM ce7_attempts) AS attempts, (SELECT count(*) FROM ce7_authorizations) AS grants').get();
    db.close();
    check('nothing submitted: 0 approvals, 0 attempts, 0 site receipts', counts.receipts === 0 && counts.attempts === 0 && counts.grants === 0, JSON.stringify(counts));
    check('form page has not been submitted', await formA.evaluate(`!!document.querySelector('form[data-ce-form="self-form.v1"]') && !document.body.innerText.includes('접수번호')`));
    if (holdMs) await sleep(holdMs);
    break scenario;
  }
  const attemptA = await approveInWeb(web, appA.application.id);
  await save(web, '03-application-approved');
  const runA = await executor(sw, `ceExecutor.runAttempt(${JSON.stringify(attemptA)})`);
  check('A submitted with receipt evidence', runA.ok && runA.value.state === 'submitted' && runA.value.evidence_ids.length === 2, JSON.stringify(runA));
  await formA.waitFor(`document.querySelector('[data-ce-receipt]')`);
  await save(formA, '04-form-receipt');
  check('A dispatched attempt is not re-run', !(await executor(sw, `ceExecutor.runAttempt(${JSON.stringify(attemptA)})`)).ok);
  await web.goto(`${APP}/applications/${appA.application.id}`);
  await web.waitFor(`document.body.innerText.includes('사이트의 접수 기록으로 접수를 확인했습니다')`);
  await save(web, '05-application-submitted');

  // B: 사용자가 미리 입력한 다른 값은 덮어쓰지 않는다 → 새로 연 폼으로 확인 → 승인 → 전송 중 Chrome 강제 종료.
  const formB = await browser.newPage(appB.target);
  await formB.waitFor(`document.querySelector('form[data-ce-form="self-form.v1"]')`);
  await formB.evaluate(`document.querySelector('form').applicant_name.value = '다른 사람'`);
  const conflict = await executor(sw, `ceExecutor.prepare(${JSON.stringify(appB.application.id)})`);
  check('B existing different value is not overwritten', !conflict.ok && conflict.code === 'FIELD_HAS_OTHER_VALUE', JSON.stringify(conflict));
  check('B page value kept', (await formB.evaluate(`document.querySelector('form').applicant_name.value`)) === '다른 사람');
  await formB.goto(appB.target);
  const prepB = await executor(sw, `ceExecutor.prepare(${JSON.stringify(appB.application.id)})`);
  check('B verified after reopening the form', prepB.ok && prepB.value.ok, JSON.stringify(prepB));
  const attemptB = await approveInWeb(web, appB.application.id);
  await sw.evaluate(`(ceExecutor.runAttempt(${JSON.stringify(attemptB)}).catch(() => null), 'started')`);
  await until(() => pageJson(web, `/api/v1/submission-attempts/${attemptB}`), r => r.body.state === 'dispatched', 20_000, 'B dispatched');
  await formB.waitFor(`document.querySelector('[data-ce-status="sending"]')`, 3000);
  await browser.kill();
  browser = null;

  const http2 = await login();
  const afterKill = (await http2.get(`/api/v1/submission-attempts/${attemptB}`)).body;
  check('B stays dispatched after browser crash (no false result)', afterKill.state === 'dispatched', afterKill.state);
  await sleep(5000);
  browser = await launchChrome({ profile: join(work, 'chrome-profile'), headless });
  const extensionAgain = await browser.loadExtension(join(ROOT, 'apps/extension'));
  check('same extension id after restart', extensionAgain === extensionId);
  const swAgain = await browser.attach((await browser.waitTarget(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`))).targetId);
  await swAgain.waitFor('globalThis.ceExecutor !== undefined');
  const restarted = await executor(swAgain, 'ceExecutor.status()');
  check('device stays paired after restart', restarted.ok && restarted.value.paired === true, JSON.stringify(restarted));
  const pending = await executor(swAgain, 'ceExecutor.work()');
  check('dispatched attempt is not offered again after restart', pending.ok && pending.value.attempts.length === 0, JSON.stringify(pending.value?.attempts));
  check('re-claim of dispatched attempt refused', (await executor(swAgain, `ceExecutor.runAttempt(${JSON.stringify(attemptB)})`)).code === 'ATTEMPT_NOT_PREPARED');
  check('early observe refused (executor gets time to report)', (await http2.post(`/api/v1/submission-attempts/${attemptB}/observe`, {})).body?.code === 'OBSERVATION_TOO_EARLY');
  await sleep(Math.max(0, Date.parse(afterKill.dispatch_started_at) + 61_000 - Date.now()));
  const observe = await http2.post(`/api/v1/submission-attempts/${attemptB}/observe`, {});
  check('observe accepted (lookup only)', observe.status === 202, JSON.stringify(observe.body));
  const settled = await until(() => http2.get(`/api/v1/submission-attempts/${attemptB}`), r => r.body.state !== 'dispatched', 20_000, 'B observe');
  check('B resolved from site receipt store without resubmission', settled.body.state === 'submitted', settled.body.state);

  const db = new DatabaseSync(join(work, 'app.sqlite'), { readOnly: true });
  const receipts = db.prepare('SELECT submission_key, file_sha256, state FROM demo_site_submissions ORDER BY created_at_ms').all();
  db.close();
  check('exactly one site receipt per attempt', receipts.length === 2 && receipts[0].submission_key === attemptA && receipts[1].submission_key === attemptB, JSON.stringify(receipts.map(r => r.submission_key)));
  check('site received the exact final PDF bytes', receipts[0].file_sha256 === appA.artifact.sha256 && receipts[1].file_sha256 === appB.artifact.sha256);
  const historyB = (await http2.get(`/api/v1/job-applications/${appB.application.id}/history`)).body;
  check('B history keeps file, answers, authorization and evidence', historyB.revisions[0].artifact_sha256 === appB.artifact.sha256 && historyB.authorizations.length === 1 && historyB.evidence.some(item => item.kind === 'receipt_id'));
  const webAgain = await browser.newPage(`${APP}/start`);
  await pageJson(webAgain, '/api/v1/local-dev/session', { method: 'POST', body: JSON.stringify({ profile: 'e2e' }) });
  await webAgain.goto(`${APP}/applications/${appB.application.id}`);
  await webAgain.waitFor(`document.body.innerText.includes('제출 당시 자료')`);
  await save(webAgain, '06-application-b-history');
  await webAgain.goto(`${APP}/applications`);
  await webAgain.waitFor(`document.body.innerText.includes('접수 확인됨')`);
  await save(webAgain, '07-applications-list');
  // 작은 화면(390px): 지원 상세·자체 폼에 가로 넘침이 없어야 한다.
  await webAgain.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (const [name, url] of [['08-mobile-application', `${APP}/applications/${appB.application.id}`], ['09-mobile-form', appA.target]]) {
    await webAgain.goto(url);
    await webAgain.waitFor(`document.body.innerText.length > 200`);
    const width = await webAgain.evaluate('document.documentElement.scrollWidth');
    check(`${name} has no horizontal overflow at 390px`, width <= 390, String(width));
    await save(webAgain, name);
  }
  if (holdMs) await sleep(holdMs);
  }
} catch (error) {
  exitCode = 1;
  checks.push({ name: 'run', result: 'FAIL', detail: error instanceof Error ? error.message : String(error) });
} finally {
  if (browser) await browser.close();
  dev.kill('SIGTERM');
  await new Promise(resolveExit => dev.once('exit', resolveExit));
  const report = { headless, mode: submitLocal ? 'submit_local_self_form' : 'stop_before_submit', checks, screenshots: shots };
  console.log(JSON.stringify(report, null, 2));
  if (exitCode) console.error(devLog.split('\n').slice(-30).join('\n'));
  if (!process.argv.includes('--keep')) rmSync(join(work, 'chrome-profile'), { recursive: true, force: true });
  process.exitCode = exitCode;
}
