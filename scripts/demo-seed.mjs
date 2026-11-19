import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 화면 시연용 데이터 준비(개발용): 실행 중인 개발 서버(npm run dev)에 합성 이력서로
// 확정 경력 → mock 검색 → 맞춤 이력서 확정·PDF → 지원 건(답변) → 실행기 연결·폼 확인(readback)까지 만들고 제출 직전에 멈춘다.
// --submit-local을 줄 때만 승인·제출을 이어서 로컬 자체 테스트 폼(127.0.0.1)에 접수시킨다(실행기 프로토콜을 HTTP로 수행).
// 사용: node scripts/demo-seed.mjs [profile] [--submit-local]   — 합성 자료만 쓴다. 실제 Chrome 확장 검증은 scripts/chrome-apply-e2e.mjs.

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const APP = 'http://127.0.0.1:4310';
const API = 'http://127.0.0.1:4311';
const EXT = `chrome-extension://${'a'.repeat(32)}`;
const profile = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'demo';
const submitLocal = process.argv.includes('--submit-local');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const LABELS = { applicant_name: '이름', applicant_email: '이메일', motivation: '지원 동기', privacy_consent: '개인정보 수집·이용 동의' };
const ANSWERS = { applicant_name: '김가상 (합성)', applicant_email: 'synthetic.applicant@example.com', motivation: 'React·TypeScript 운영 화면 개발 경험을 살려 지원합니다.', privacy_consent: '동의' };

const login = await fetch(`${API}/api/v1/local-dev/session`, { method: 'POST', headers: { Origin: APP, 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }) });
const session = await login.json();
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
async function call(method, path, json, raw) {
  const headers = { Cookie: cookie };
  if (method !== 'GET') Object.assign(headers, { Origin: APP, 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': `seed-${crypto.randomUUID()}` });
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(API + path, { method, headers, body: raw ?? (json === undefined ? undefined : JSON.stringify(json)) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} ${response.status} ${JSON.stringify(body)}`);
  return body;
}
async function device(method, path, token, json) {
  const response = await fetch(`${API}/api/executor/v1${path}`, { method, headers: { Origin: EXT, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) }, body: json ? JSON.stringify(json) : undefined });
  if (!response.ok) throw new Error(`executor ${path} ${response.status} ${await response.text()}`);
  return response.headers.get('content-type')?.startsWith('application/pdf') ? new Uint8Array(await response.arrayBuffer()) : response.json();
}
async function until(read, done, label) {
  for (let i = 0; i < 200; i++) { const value = await read(); if (done(value)) return value; await sleep(300); }
  throw new Error(`TIMEOUT ${label}`);
}

const form = new FormData();
form.append('file', new Blob([readFileSync(`${ROOT}/fixtures/resumes/frontend.synthetic.pdf`)], { type: 'application/pdf' }), 'frontend.synthetic.pdf');
const doc = (await call('POST', '/api/v1/resume-documents', undefined, form)).resource_id;
await until(() => call('GET', `/api/v1/resume-documents/${doc}`), body => body.extraction_status === 'review_required', 'extraction');
const draft = await call('GET', `/api/v1/resume-documents/${doc}/extraction`);
const facts = await call('POST', `/api/v1/resume-documents/${doc}/fact-revisions`, { extraction_id: draft.id, expected_parent_revision_id: null, facts: draft.facts });
const intent = await call('POST', '/api/v1/search-intents', { fact_revision_id: facts.id, conditions: [] });
const search = await call('POST', '/api/v1/resume-searches', { intent_id: intent.id, max_candidates: 10 });
const run = await until(() => call('GET', `/api/v1/resume-searches/${search.resource_id}`), body => body.state === 'succeeded', 'search');
const jobs = await Promise.all(run.job_snapshot_ids.map(id => call('GET', `/api/v1/job-snapshots/${id}`)));
const job = jobs.find(item => item.title === '프론트엔드 개발자') ?? jobs[0];
const tailoring = await call('POST', '/api/v1/tailoring-sessions', { job_snapshot_id: job.id, fact_revision_id: facts.id });
const r1 = await call('GET', `/api/v1/resume-revisions/${tailoring.current_resume_revision_id}`);
const final = await call('POST', `/api/v1/resume-revisions/${r1.id}/finalize`, { expected_content_hash: r1.content_hash, reviewed: true });
await call('POST', '/api/v1/artifacts', { resume_revision_id: final.id });
const artifact = (await until(() => call('GET', `/api/v1/resume-revisions/${final.id}/artifacts`), body => body.items.length > 0, 'render')).items[0];
const answers = Object.entries(ANSWERS).map(([id, answer]) => ({ question_id: id, question_text: LABELS[id], answer, source: 'user_answer', source_ids: [`ua_${id}`] }));
const app = await call('POST', '/api/v1/job-applications', { job_snapshot_id: job.id, resume_revision_id: final.id, artifact_id: artifact.id, answers });

// 실행기(확장 역할): 연결 → 폼 관측·readback → (--submit-local일 때만) 웹 승인 → claim·dispatch → 사이트 접수 → 결과 보고.
const code = (await call('POST', '/api/v1/executor-pairings', { executor: 'chrome' })).code;
const token = (await device('POST', '/pair', null, { code, label: '시연용 실행기(HTTP)' })).token;
const plan = await device('GET', `/applications/${app.id}/prepare`, token);
const bytes = await device('GET', `/applications/${app.id}/artifact?revision=${plan.application_revision}`, token);
const sha = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const posting = await (await fetch(`${API}/api/demo-site/postings/${plan.posting_id}`)).json();
const snapshot = { site_id: 'self-form', adapter_version: 'self-form.v1', posting: { posting_id: posting.posting_id, company_name: posting.company_name, title: posting.title }, questions: posting.questions, file: { field: 'resume_file', accept: 'application/pdf', required: true } };
const readback = { answers: plan.fill.map(item => ({ question_id: item.question_id, value: item.value })), file: { name: artifact.filename, size: bytes.length, type: 'application/pdf', sha256: sha } };
const observation = await device('POST', `/applications/${app.id}/observations`, token, { application_revision: plan.application_revision, payload_hash: plan.payload_hash, target_url: plan.target_url, document_id: 'demo-doc', snapshot, readback });
if (!submitLocal) {
  console.log(JSON.stringify({ profile, application_id: app.id, job: `${job.company_name} · ${job.title}`, observation: observation.state, submitted: false, note: '제출 직전에서 멈춤(승인·제출 없음)' }));
  process.exit(0);
}
const grant = await call('POST', `/api/v1/job-applications/${app.id}/manual-authorizations`, { expected_application_revision: app.current.revision, expected_payload_hash: app.current.payload_hash, target: observation.target, reviewed: true });
const attempt = await call('POST', `/api/v1/job-applications/${app.id}/attempts`, { authorization_id: grant.id });
const claim = await device('POST', `/attempts/${attempt.id}/claim`, token);
await device('POST', `/attempts/${attempt.id}/dispatch`, token, { run_token: claim.run_token, target_url: claim.target_url, document_id: 'demo-doc', snapshot, readback });
const site = new FormData();
for (const item of claim.fill) site.append(item.question_id, item.kind === 'checkbox' ? (item.value === 'checked' ? 'on' : '') : item.value);
site.append('resume_file', new Blob([bytes], { type: 'application/pdf' }), artifact.filename);
site.append('submission_key', attempt.id);
const receipt = await (await fetch(`${API}/api/demo-site/postings/${plan.posting_id}/submissions`, { method: 'POST', headers: { Origin: APP }, body: site })).json();
const result = await device('POST', `/attempts/${attempt.id}/result`, token, { run_token: claim.run_token, outcome: 'confirmation', detail: '', observed: { receipt_number: receipt.receipt_number, posting_id: plan.posting_id, submission_key: attempt.id, page_url: plan.target_url } });
console.log(JSON.stringify({ profile, application_id: app.id, job: `${job.company_name} · ${job.title}`, attempt_state: result.state, receipt: receipt.receipt_number }));
