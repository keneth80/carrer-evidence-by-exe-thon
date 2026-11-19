import { isPanelRequest, isPanelSender } from './guard.mjs';
import { ExecutorError, openForm, pair, prepare, resumeObservations, runAttempt, setAutoRun, status, unpair, work } from './executor.mjs';

// 패널 메시지만 받는다. 메시지는 정해진 동작 이름과 ID만 담을 수 있고 URL·selector·script를 지정하지 못한다.
const handlers = {
  status: () => status(),
  pair: args => pair(args.code, args.label),
  unpair: () => unpair(),
  work: () => work(),
  open: args => openForm(args.application_id),
  prepare: args => prepare(args.application_id),
  run: args => runAttempt(args.attempt_id),
  set_auto_run: args => setAutoRun(args.enabled),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isPanelSender(sender, chrome.runtime.id)) return false;
  if (!isPanelRequest(message)) {
    sendResponse({ ok: false, request_id: null, error: { code: 'INVALID_PANEL_REQUEST', message: '허용되지 않은 요청입니다.' } });
    return false;
  }
  handlers[message.action](message.args).then(
    data => sendResponse({ ok: true, request_id: message.request_id, data }),
    error => sendResponse({
      ok: false, request_id: message.request_id,
      error: error instanceof ExecutorError ? { code: error.code, message: error.message, issues: error.issues } : { code: 'EXECUTOR_FAILED', message: '처리하지 못했습니다.' },
    }),
  );
  return true;
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => console.warn('CE_PANEL_SETUP_FAILED'));

// service worker가 다시 시작되면 전송 뒤 결과를 보고하지 못한 시도의 관측만 이어간다.
resumeObservations().catch(() => console.warn('CE_RESUME_OBSERVATION_FAILED'));

// 개발 검증(CDP로 띄운 임시 프로필 Chrome)에서 패널 없이 같은 실행 경로를 호출하기 위한 참조. 확장 내부에서만 보인다.
globalThis.ceExecutor = { status, pair, work, prepare, runAttempt, resumeObservations, setAutoRun };
