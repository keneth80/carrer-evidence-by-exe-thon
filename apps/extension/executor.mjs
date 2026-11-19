import { APP_ORIGIN, isExecutableTarget } from './guard.mjs';
import { fillPage, inspectPage, observePage, readbackPage, submitPage } from './self-form-adapter.mjs';

// Chrome 실행 채널. 서버(/api/executor/v1)가 허용한 지원 건·파일·동작만 실행한다.
// 승인·접수 상태는 서버가 보존한다. 확장에는 기기 토큰(storage.local)과, 전송 뒤 결과 관측에 필요한
// 실행 토큰(storage.session: 브라우저를 닫으면 사라짐)만 둔다. 전송한 시도를 다시 제출하는 경로는 없다.

const API = `${APP_ORIGIN}/api/executor/v1`;
const SUPPORTED_KINDS = ['text', 'email', 'textarea', 'checkbox'];
const OBSERVE_TIMEOUT_MS = 20_000;
const running = new Set();

export class ExecutorError extends Error {
  constructor(code, message, issues = []) { super(message); this.code = code; this.issues = issues; }
}

async function device() {
  const { device: value } = await chrome.storage.local.get('device');
  return value && typeof value.token === 'string' ? value : null;
}

async function call(method, path, body, { raw = false, auth = true } = {}) {
  const headers = {};
  if (auth) {
    const current = await device();
    if (!current) throw new ExecutorError('NOT_PAIRED', '먼저 확장을 연결해 주세요.');
    headers.Authorization = `Bearer ${current.token}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new ExecutorError('SERVER_UNREACHABLE', 'Career Evidence 서버에 연결할 수 없습니다. 개발 서버가 켜져 있는지 확인해 주세요.');
  }
  if (raw && response.ok) return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    // 기기 토큰 자체가 무효일 때만 연결 정보를 지운다(실행 토큰 불일치 등은 연결과 무관).
    if (response.status === 401 && auth && /^DEVICE_/.test(payload?.code ?? '')) await chrome.storage.local.remove('device');
    throw new ExecutorError(payload?.code ?? `HTTP_${response.status}`, payload?.message ?? '요청을 처리하지 못했습니다.', payload?.details?.issues ?? []);
  }
  return payload;
}

const toHex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
function toBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

// 정확한 지원 주소의 탭을 찾는다(현재 창의 활성 탭 우선). 주소가 확장 허용 범위가 아니면 실행하지 않는다.
async function findTab(targetUrl) {
  if (!isExecutableTarget(targetUrl)) throw new ExecutorError('TARGET_NOT_ALLOWED', '확장이 실행할 수 없는 주소입니다.');
  const tabs = (await chrome.tabs.query({ url: targetUrl })).filter(tab => tab.url === targetUrl && Number.isInteger(tab.id));
  const tab = tabs.find(item => item.active) ?? tabs[0];
  if (!tab) throw new ExecutorError('TAB_NOT_FOUND', '지원 폼 탭이 열려 있지 않습니다. 패널의 "지원 폼 열기"로 연 뒤 다시 시도해 주세요.');
  return tab;
}

// 특정 문서(documentId)에서만 실행한다. 탭이 새 문서로 바뀌었으면 실패한다(탭 교체·새로고침 감지).
async function inPage(tabId, documentId, func, args = []) {
  const target = documentId ? { tabId, documentIds: [documentId] } : { tabId, frameIds: [0] };
  let results;
  try {
    results = await chrome.scripting.executeScript({ target, world: 'ISOLATED', func, args });
  } catch {
    throw new ExecutorError('DOCUMENT_CHANGED', '지원 폼 페이지가 바뀌었거나 닫혔습니다.');
  }
  const result = results.find(item => item.frameId === 0) ?? results[0];
  if (!result || typeof result.documentId !== 'string') throw new ExecutorError('DOCUMENT_CHANGED', '지원 폼 페이지를 확인할 수 없습니다.');
  return { value: result.result, documentId: result.documentId };
}

async function inspect(tabId, documentId) {
  const { value, documentId: observedDocument } = await inPage(tabId, documentId, inspectPage);
  if (!value?.ok) throw new ExecutorError(value?.code ?? 'FORM_MARKER_MISSING', value?.code === 'ALREADY_SUBMITTED_PAGE' ? '이미 제출을 마친 화면입니다. 새로 열어 주세요.' : '자체 테스트 폼을 찾지 못했습니다.');
  if (value.unsupported.length || value.snapshot.questions.some(question => !SUPPORTED_KINDS.includes(question.kind))) {
    throw new ExecutorError('UNSUPPORTED_FIELD', `처리할 수 없는 입력란이 있습니다: ${value.unsupported.join(', ')}. 직접 확인이 필요합니다.`);
  }
  return { snapshot: value.snapshot, documentId: observedDocument };
}

// 서버에서 허용된 파일만 받아 bytes hash를 대조한다.
async function fetchArtifact(applicationId, revision, expectedSha256) {
  const { bytes } = await call('GET', `/applications/${applicationId}/artifact?revision=${revision}`, undefined, { raw: true });
  const actual = toHex(await crypto.subtle.digest('SHA-256', bytes));
  if (actual !== expectedSha256) throw new ExecutorError('ARTIFACT_HASH_MISMATCH', '받은 PDF가 확정한 파일과 다릅니다. 첨부하지 않았습니다.');
  return bytes;
}

async function fillAndRead(tabId, documentId, fill, artifact, bytes) {
  const filled = await inPage(tabId, documentId, fillPage, [fill, { base64: toBase64(bytes), name: artifact.filename, type: 'application/pdf' }]);
  if (!filled.value?.ok) {
    const conflict = filled.value?.code === 'FIELD_HAS_OTHER_VALUE';
    throw new ExecutorError(filled.value?.code ?? 'FILL_FAILED', conflict ? '폼에 이미 다른 값이 입력되어 있어 덮어쓰지 않았습니다. 확인 후 지우고 다시 시도해 주세요.' : '폼에 입력하지 못했습니다.');
  }
  const read = await inPage(tabId, documentId, readbackPage);
  if (!read.value?.ok) throw new ExecutorError('READBACK_FAILED', '입력한 값을 다시 읽지 못했습니다.');
  return read.value.readback;
}

export async function pair(code, label) {
  const result = await call('POST', '/pair', { code, label: label.trim() }, { auth: false });
  await chrome.storage.local.set({ device: { token: result.token, device_id: result.device_id, label: result.label } });
  return { device_id: result.device_id, label: result.label };
}

export async function unpair() {
  await chrome.storage.local.remove('device');
  return { paired: false };
}

export async function status() {
  const current = await device();
  const { autoRun = true } = await chrome.storage.local.get('autoRun');
  if (!current) return { paired: false, autoRun };
  try {
    const session = await call('GET', '/session');
    return { paired: true, label: session.label, device_id: session.device_id, autoRun };
  } catch (error) {
    return { paired: (await device()) !== null, label: current.label, autoRun, error: { code: error.code, message: error.message } };
  }
}

export async function setAutoRun(enabled) {
  await chrome.storage.local.set({ autoRun: enabled });
  return { autoRun: enabled };
}

export async function work() {
  const [applications, attempts] = await Promise.all([call('GET', '/applications'), call('GET', '/attempts')]);
  return { applications: applications.items, attempts: attempts.items, running: [...running] };
}

export async function openForm(applicationId) {
  const list = await call('GET', '/applications');
  const item = list.items.find(entry => entry.application_id === applicationId);
  if (!item || !isExecutableTarget(item.target_url)) throw new ExecutorError('TARGET_NOT_ALLOWED', '열 수 없는 지원 주소입니다.');
  const existing = (await chrome.tabs.query({ url: item.target_url })).find(tab => tab.url === item.target_url);
  if (existing) { await chrome.tabs.update(existing.id, { active: true }); return { tab_id: existing.id }; }
  const tab = await chrome.tabs.create({ url: item.target_url, active: true });
  return { tab_id: tab.id };
}

// 폼 확인·입력: 관측(입력 전) → 파일 확인 → 입력·첨부 → 다시 읽기 → 서버 대조. 제출하지 않는다.
export async function prepare(applicationId) {
  const plan = await call('GET', `/applications/${applicationId}/prepare`);
  const tab = await findTab(plan.target_url);
  const { snapshot, documentId } = await inspect(tab.id);
  const base = { application_revision: plan.application_revision, payload_hash: plan.payload_hash, target_url: tab.url, document_id: documentId, snapshot };
  const inspected = await call('POST', `/applications/${applicationId}/observations`, { ...base, readback: null });
  if (inspected.state === 'mismatch') return { ok: false, observation: inspected };
  const bytes = await fetchArtifact(applicationId, plan.application_revision, plan.artifact.sha256);
  const readback = await fillAndRead(tab.id, documentId, plan.fill, plan.artifact, bytes);
  const verified = await call('POST', `/applications/${applicationId}/observations`, { ...base, readback });
  return { ok: verified.state === 'verified', observation: verified };
}

async function report(attemptId, runToken, outcome, observed, detail) {
  const result = await call('POST', `/attempts/${attemptId}/result`, { run_token: runToken, outcome, observed, detail: String(detail ?? '').slice(0, 200) });
  await chrome.storage.session.remove(`run:${attemptId}`);
  return result;
}

async function watchResult(attemptId, runToken, tabId, documentId) {
  const deadline = Date.now() + OBSERVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let seen;
    try { seen = (await inPage(tabId, documentId, observePage)).value; } catch { return report(attemptId, runToken, 'no_confirmation', null, 'document_gone_after_submit'); }
    if (seen?.state === 'confirmation') return report(attemptId, runToken, 'confirmation', seen.observed, '');
    if (seen?.state === 'form_error') return report(attemptId, runToken, 'form_error', null, seen.detail);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return report(attemptId, runToken, 'no_confirmation', null, 'timeout');
}

// 승인된 시도 실행: claim → 같은 문서에서 다시 입력·확인 → 서버 dispatch(전송 직전 검증) → 제출 1회 → 결과 관측·보고.
export async function runAttempt(attemptId) {
  if (running.has(attemptId)) return { skipped: 'already_running' };
  running.add(attemptId);
  try {
    const claim = await call('POST', `/attempts/${attemptId}/claim`);
    const tab = await findTab(claim.target_url);
    const { snapshot, documentId } = await inspect(tab.id);
    const bytes = await fetchArtifact(claim.application_id, claim.application_revision, claim.artifact.sha256);
    const readback = await fillAndRead(tab.id, documentId, claim.fill, claim.artifact, bytes);
    const dispatched = await call('POST', `/attempts/${attemptId}/dispatch`, { run_token: claim.run_token, target_url: tab.url, document_id: documentId, snapshot, readback });
    // 여기부터 전송 이후다. 실행 토큰을 남겨 확장이 재시작돼도 결과 관측만 이어간다(재제출 없음).
    await chrome.storage.session.set({ [`run:${attemptId}`]: { run_token: claim.run_token, tab_id: tab.id, document_id: documentId, dispatched_at: dispatched.dispatched_at } });
    let submitted;
    try { submitted = (await inPage(tab.id, documentId, submitPage, [dispatched.submission_key])).value; } catch { submitted = null; }
    // 이미 제출된 화면이면(사용자가 직접 눌렀을 수 있음) 보내지 않았다고 단정하지 않는다: 불명으로 보고해 사이트 기록 확인으로 넘긴다.
    if (submitted?.code === 'ALREADY_SUBMITTED_PAGE') return report(attemptId, claim.run_token, 'no_confirmation', null, 'page_already_submitted');
    if (!submitted?.ok) return report(attemptId, claim.run_token, 'not_started', null, submitted?.code ?? 'document_gone_before_submit');
    return await watchResult(attemptId, claim.run_token, tab.id, documentId);
  } finally {
    running.delete(attemptId);
  }
}

// 확장(service worker) 재시작 뒤: 전송한 시도의 결과만 관측해 보고한다. 제출 버튼은 다시 누르지 않는다.
export async function resumeObservations() {
  const stored = await chrome.storage.session.get(null);
  const resumed = [];
  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith('run:') || running.has(key.slice(4))) continue;
    const attemptId = key.slice(4);
    running.add(attemptId);
    try {
      resumed.push(await watchResult(attemptId, value.run_token, value.tab_id, value.document_id));
    } catch {
      await chrome.storage.session.remove(key);
    } finally {
      running.delete(attemptId);
    }
  }
  return resumed;
}
