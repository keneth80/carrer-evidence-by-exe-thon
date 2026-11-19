// 확장의 고정 경계. 앱 origin·자체 폼 경로·패널 메시지 형식은 코드에 고정하고, 메시지가 URL·selector·script를 지정하지 못한다.

export const APP_ORIGIN = 'http://127.0.0.1:4310';
export const FORM_PATH_PREFIX = '/demo/apply/';
export const PANEL_REQUEST = 'CE_PANEL_REQUEST';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

// 패널이 요청할 수 있는 동작과 각 동작의 인자 형식. 목록에 없는 동작·인자는 거절한다.
const ACTIONS = {
  status: {},
  pair: { code: value => typeof value === 'string' && /^[A-Za-z0-9 -]{4,20}$/.test(value), label: value => typeof value === 'string' && value.trim().length > 0 && value.length <= 60 },
  unpair: {},
  work: {},
  open: { application_id: value => typeof value === 'string' && ID.test(value) },
  prepare: { application_id: value => typeof value === 'string' && ID.test(value) },
  run: { attempt_id: value => typeof value === 'string' && ID.test(value) },
  set_auto_run: { enabled: value => typeof value === 'boolean' },
};

// 자체 테스트 폼의 정확한 지원 주소에서 공고 ID를 꺼낸다. 다른 origin·query·fragment·계정 정보는 거절한다.
export function postingFromUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.origin !== APP_ORIGIN || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(FORM_PATH_PREFIX)) return null;
    const id = url.pathname.slice(FORM_PATH_PREFIX.length);
    return SLUG.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function isPanelSender(sender, extensionId) {
  return !!sender && sender.id === extensionId
    && sender.url === `chrome-extension://${extensionId}/sidepanel.html`
    && sender.tab === undefined
    && (sender.origin === undefined || sender.origin === `chrome-extension://${extensionId}`);
}

export function isPanelRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).sort().join() !== 'action,args,request_id,type' || value.type !== PANEL_REQUEST || typeof value.request_id !== 'string' || !UUID.test(value.request_id)) return false;
  const spec = Object.hasOwn(ACTIONS, value.action) ? ACTIONS[value.action] : null;
  const args = value.args;
  if (!spec || !args || typeof args !== 'object' || Array.isArray(args)) return false;
  const keys = Object.keys(args).sort();
  return keys.join() === Object.keys(spec).sort().join() && keys.every(key => spec[key](args[key]));
}

// 서버가 돌려준 지원 주소가 이 확장이 실행할 수 있는 주소인지 다시 확인한다(서버 응답도 그대로 믿지 않는다).
export const isExecutableTarget = value => postingFromUrl(value) !== null;
