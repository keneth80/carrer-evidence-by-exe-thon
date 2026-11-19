import { createHash, randomUUID } from 'node:crypto';
import { demoPosting } from '../../packages/apply/src/self-form.ts';
import { runObserveTask } from '../../apps/worker/src/observe-task.ts';
import { current, runRender, say, accept, startTailoring } from './s04-harness.mjs';

// S05 검사 공통: 확정 PDF 준비 → 지원 건 → 실행기(확장 역할)를 HTTP로 흉내 낸다.
// 실제 Chrome 확장 검증은 scripts/chrome-apply-e2e.mjs가 따로 한다. 여기서는 서버 계약·상태 전이를 검사한다.

export const EXTENSION_ORIGIN = `chrome-extension://${'a'.repeat(32)}`;
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const observeDeps = (api, overrides = {}) => ({ db: api.db, owner: `observe-${randomUUID()}`, leaseMs: 30_000, now: Date.now, ...overrides });
export const runObserve = (api, overrides) => runObserveTask(observeDeps(api, overrides));

export const ANSWERS = {
  applicant_name: '김지원',
  applicant_email: 'applicant@example.com',
  motivation: '공고의 React·TypeScript 업무와 제 경험이 맞아 지원합니다.\n운영 화면 개선 경험을 살리겠습니다.',
  privacy_consent: '동의',
};
const LABELS = { applicant_name: '이름', applicant_email: '이메일', motivation: '지원 동기', privacy_consent: '개인정보 수집·이용 동의' };

export function answers(values = ANSWERS) {
  return Object.entries(values).map(([id, answer]) => ({ question_id: id, question_text: LABELS[id], answer, source: 'user_answer', source_ids: [`ua_${id}`] }));
}

// 공고에 맞춰 수정한 이력서를 확정하고 PDF를 만든다.
export async function finalPdf(api, http, options = {}) {
  const start = options.start ?? await startTailoring(api, http, options.name ?? 'frontend', options.pickTitle);
  const { revision } = await current(http, start.session.id);
  const finalized = await http.post(`/api/v1/resume-revisions/${revision.id}/finalize`, { json: { expected_content_hash: revision.content_hash, reviewed: true } });
  if (finalized.status !== 200) throw new Error(`finalize failed ${finalized.status} ${JSON.stringify(finalized.body)}`);
  const render = await http.post('/api/v1/artifacts', { json: { resume_revision_id: revision.id } });
  if (render.status !== 202) throw new Error(`render failed ${render.status}`);
  await runRender(api);
  const artifacts = (await http.get(`/api/v1/resume-revisions/${revision.id}/artifacts`)).body.items;
  return { ...start, revision: finalized.body, artifact: artifacts[0] };
}

export async function createApplication(http, prepared, values) {
  return http.post('/api/v1/job-applications', { json: { job_snapshot_id: prepared.job.id, resume_revision_id: prepared.revision.id, artifact_id: prepared.artifact.id, answers: values === undefined ? answers() : values } });
}

// 확장 역할: 1회 코드로 기기 토큰을 받는다.
export async function pairDevice(api, http, label = '테스트 Chrome') {
  const pairing = await http.post('/api/v1/executor-pairings', { json: { executor: 'chrome' } });
  if (pairing.status !== 201) throw new Error(`pairing failed ${pairing.status} ${JSON.stringify(pairing.body)}`);
  const paired = await executorFetch(api, null, 'POST', '/api/executor/v1/pair', { code: pairing.body.code, label });
  if (paired.status !== 201) throw new Error(`pair failed ${paired.status} ${JSON.stringify(paired.body)}`);
  return executor(api, paired.body.token, paired.body);
}

export async function executorFetch(api, token, method, path, json) {
  const headers = { Origin: EXTENSION_ORIGIN };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(api.base + path, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const raw = response.headers.get('content-type')?.startsWith('application/pdf');
  return { status: response.status, body: raw ? Buffer.from(await response.arrayBuffer()) : await response.json(), headers: response.headers };
}

export function executor(api, token, info = {}) {
  const call = (method, path, json) => executorFetch(api, token, method, `/api/executor/v1${path}`, json);
  return { token, info, call, get: path => call('GET', path), post: (path, json) => call('POST', path, json) };
}

// 페이지에서 관측한 폼 구조(확장 adapter가 만드는 것과 같은 모양).
export function snapshotFor(postingId, mutate = s => s) {
  const posting = demoPosting(postingId);
  return mutate({ site_id: 'self-form', adapter_version: 'self-form.v1', posting: { posting_id: posting.posting_id, company_name: posting.company_name, title: posting.title }, questions: posting.questions.map(q => ({ ...q })), file: { field: 'resume_file', accept: 'application/pdf', required: true } });
}

export function readbackFor(fill, bytes, overrides = {}) {
  return { answers: fill.map(item => ({ question_id: item.question_id, value: item.value })), file: { name: 'resume.pdf', size: bytes.length, type: 'application/pdf', sha256: sha(bytes) }, ...overrides };
}

// 확장 역할: 준비 → 관측(입력 전) → 파일 받기 → 입력 뒤 readback 보고. 검증된 관측 본문을 돌려준다.
export async function prepareForm(device, applicationId, { readback, snapshot, documentId = 'doc-1' } = {}) {
  const plan = await device.get(`/applications/${applicationId}/prepare`);
  if (plan.status !== 200) return { plan };
  const file = await device.get(`/applications/${applicationId}/artifact?revision=${plan.body.application_revision}`);
  const snap = snapshot ?? snapshotFor(plan.body.posting_id);
  const base = { application_revision: plan.body.application_revision, payload_hash: plan.body.payload_hash, target_url: plan.body.target_url, document_id: documentId, snapshot: snap };
  const inspected = await device.post(`/applications/${applicationId}/observations`, { ...base, readback: null });
  const verified = await device.post(`/applications/${applicationId}/observations`, { ...base, readback: readback ?? readbackFor(plan.body.fill, file.body) });
  return { plan, file, inspected, verified, snapshot: snap };
}

export async function authorize(http, application, observation, overrides = {}) {
  return http.post(`/api/v1/job-applications/${application.id}/manual-authorizations`, { json: {
    expected_application_revision: application.current.revision, expected_payload_hash: application.current.payload_hash, target: observation.target, reviewed: true, ...overrides,
  } });
}

// 자체 테스트 폼 페이지가 보내는 것과 같은 multipart 접수.
export async function siteSubmit(api, postingId, fill, bytes, submissionKey) {
  const form = new FormData();
  for (const item of fill) form.append(item.question_id, item.kind === 'checkbox' ? (item.value === 'checked' ? 'on' : '') : item.value);
  form.append('resume_file', new Blob([bytes], { type: 'application/pdf' }), 'resume.pdf');
  if (submissionKey) form.append('submission_key', submissionKey);
  const response = await fetch(`${api.base}/api/demo-site/postings/${postingId}/submissions`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:4310' }, body: form });
  return { status: response.status, body: await response.json().catch(() => null) };
}

// 승인 → 시도 → claim → dispatch까지. 실행기가 실제로 제출 버튼을 누르기 직전 상태를 돌려준다.
export async function approveAndDispatch(api, http, device, application, prepared) {
  const auth = await authorize(http, application, prepared.verified.body);
  if (auth.status !== 201) throw new Error(`authorize failed ${auth.status} ${JSON.stringify(auth.body)}`);
  const attempt = await http.post(`/api/v1/job-applications/${application.id}/attempts`, { json: { authorization_id: auth.body.id } });
  if (attempt.status !== 201) throw new Error(`attempt failed ${attempt.status} ${JSON.stringify(attempt.body)}`);
  const claim = await device.post(`/attempts/${attempt.body.id}/claim`);
  if (claim.status !== 200) throw new Error(`claim failed ${claim.status} ${JSON.stringify(claim.body)}`);
  const dispatch = await device.post(`/attempts/${attempt.body.id}/dispatch`, { run_token: claim.body.run_token, target_url: claim.body.target_url, document_id: 'doc-2', snapshot: prepared.snapshot, readback: readbackFor(claim.body.fill, prepared.file.body) });
  return { auth, attempt, claim, dispatch };
}

export { current, say, accept };
