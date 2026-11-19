import { PANEL_REQUEST } from './guard.mjs';

// 패널 화면. 서비스 워커에 정해진 동작만 요청하고, 서버 상태를 3초마다 다시 읽어 보여준다.
// 서버가 돌려준 문자열은 textContent로만 넣는다.

const $ = selector => document.querySelector(selector);
const statusLine = $('#status');
const STATE_LABELS = {
  // not_submitted: 다시 '폼 확인·입력' 후 웹에서 새로 승인할 수 있다.
  draft: '답변·폼 확인 전', prepared: '입력 확인됨 · 웹에서 최종 확인 대기', queued: '승인됨 · 실행 대기', running: '전송 중 · 결과 확인 중',
  waiting_user: '확인 필요', submitted: '접수 확인됨', submission_unknown: '접수 여부 불명 · 웹에서 결과 확인', not_submitted: '미접수로 확정', canceled: '중지됨',
};
const autoRunStarted = new Set();
let autoRun = true;
let busy = false;

function show(message, tone = 'neutral') {
  statusLine.textContent = message;
  statusLine.dataset.tone = tone;
}

async function request(action, args = {}) {
  const requestId = crypto.randomUUID();
  const response = await chrome.runtime.sendMessage({ type: PANEL_REQUEST, request_id: requestId, action, args });
  if (response?.request_id !== requestId) throw Object.assign(new Error('응답이 올바르지 않습니다.'), { code: 'INVALID_RESPONSE' });
  if (!response.ok) throw Object.assign(new Error(response.error?.message ?? '처리하지 못했습니다.'), { code: response.error?.code, issues: response.error?.issues ?? [] });
  return response.data;
}

function element(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

function issuesText(issues) {
  return issues?.length ? ` ${issues.map(issue => issue.message).join(' ')}` : '';
}

async function runAction(label, work) {
  if (busy) return;
  busy = true;
  show(`${label} 진행 중입니다.`);
  try {
    const result = await work();
    return result;
  } catch (error) {
    show(`${error.message}${issuesText(error.issues)}`, 'error');
    return null;
  } finally {
    busy = false;
  }
}

function renderApplications(items) {
  const list = $('#applications');
  list.replaceChildren();
  // 미접수로 확정된 건도 다시 확인·승인해 진행할 수 있으므로 보여준다.
  const open = items.filter(item => item.submission_state !== 'submitted');
  if (!open.length) { list.append(element('li', { className: 'empty', textContent: '준비 중인 지원 건이 없습니다. 웹의 최종 제출본 화면에서 지원을 준비하세요.' })); return; }
  for (const item of open) {
    const prepareButton = element('button', { type: 'button', textContent: '폼 확인·입력', disabled: !item.answers_complete || ['running', 'submission_unknown', 'queued'].includes(item.submission_state) });
    prepareButton.addEventListener('click', async () => {
      const result = await runAction('폼 확인·입력', () => request('prepare', { application_id: item.application_id }));
      if (!result) return;
      if (result.ok) show('입력·첨부한 값과 PDF 파일 hash를 다시 읽어 확인했습니다. 웹에서 최종 확인 후 제출을 승인하세요.', 'success');
      else show(`폼을 확인했지만 그대로 진행할 수 없습니다.${issuesText(result.observation?.issues)}`, 'error');
      await refresh();
    });
    const openButton = element('button', { type: 'button', className: 'secondary', textContent: '지원 폼 열기' });
    openButton.addEventListener('click', () => runAction('지원 폼 열기', () => request('open', { application_id: item.application_id })).then(() => show('지원 폼을 열었습니다. 페이지가 열리면 "폼 확인·입력"을 누르세요.')));
    list.append(element('li', { className: 'item' }, [
      element('strong', { textContent: `${item.company_name} · ${item.title}` }),
      element('span', { className: `state state-${item.submission_state}`, textContent: STATE_LABELS[item.submission_state] ?? item.submission_state }),
      item.answers_complete ? '' : element('span', { className: 'hint', textContent: '웹에서 답변을 먼저 저장하세요.' }),
      element('div', { className: 'actions' }, [openButton, prepareButton]),
    ]));
  }
}

function renderAttempts(items, running) {
  const list = $('#attempts');
  list.replaceChildren();
  if (!items.length) { list.append(element('li', { className: 'empty', textContent: '실행을 기다리는 승인된 제출이 없습니다.' })); return; }
  for (const item of items) {
    const runButton = element('button', { type: 'button', textContent: running.includes(item.attempt_id) ? '실행 중' : '지금 제출 실행', disabled: running.includes(item.attempt_id) });
    runButton.addEventListener('click', () => execute(item));
    list.append(element('li', { className: 'item' }, [
      element('strong', { textContent: `${item.company_name} · ${item.title}` }),
      element('span', { className: 'hint', textContent: `승인 만료: ${new Date(item.authorization_expires_at).toLocaleTimeString('ko-KR')}` }),
      element('div', { className: 'actions' }, [runButton]),
    ]));
  }
}

async function execute(item) {
  autoRunStarted.add(item.attempt_id);
  const result = await runAction('승인된 제출 실행', () => request('run', { attempt_id: item.attempt_id }));
  if (result?.state === 'submitted') show(`${item.company_name}: 접수가 확인되었습니다. 지원 이력에서 접수 근거를 볼 수 있습니다.`, 'success');
  else if (result?.state) show(`${item.company_name}: ${STATE_LABELS[result.state] ?? result.state}. 웹의 지원 이력에서 확인하세요.`, result.state === 'submission_unknown' ? 'error' : 'neutral');
  await refresh();
}

async function refresh() {
  let state;
  try { state = await request('status'); } catch (error) { show(error.message, 'error'); return; }
  autoRun = state.autoRun;
  $('#auto-run').checked = autoRun;
  $('#pair-view').hidden = state.paired;
  $('#main-view').hidden = !state.paired;
  if (!state.paired) return;
  $('#device-label').textContent = `연결됨 · ${state.label ?? ''}`;
  if (state.error) { show(state.error.message, 'error'); return; }
  let data;
  try { data = await request('work'); } catch (error) { show(error.message, 'error'); return; }
  renderApplications(data.applications);
  renderAttempts(data.attempts, data.running);
  // 승인된 제출은 패널이 열려 있을 때 한 번만 자동 실행한다. 이미 전송한 시도는 서버가 다시 내주지 않는다.
  const next = data.attempts.find(item => !autoRunStarted.has(item.attempt_id) && !data.running.includes(item.attempt_id));
  if (autoRun && next && !busy) execute(next);
}

$('#pair-form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await runAction('연결', () => request('pair', { code: $('#pair-code').value.trim(), label: $('#pair-label').value.trim() }));
  if (result) { show(`${result.label}(으)로 연결했습니다.`, 'success'); $('#pair-code').value = ''; await refresh(); }
});
$('#unpair').addEventListener('click', async () => {
  await runAction('연결 해제', () => request('unpair'));
  show('이 브라우저의 연결 정보를 지웠습니다. 웹의 지원 이력에서 기기 연결도 해제할 수 있습니다.');
  await refresh();
});
$('#auto-run').addEventListener('change', event => request('set_auto_run', { enabled: event.target.checked }).catch(() => undefined));

refresh();
setInterval(() => { if (!busy) refresh(); }, 3000);
