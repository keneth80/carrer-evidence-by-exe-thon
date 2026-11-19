// 자체 테스트 폼(self-form.v1) site adapter의 페이지 함수. chrome.scripting.executeScript의 func로 전달되므로
// 각 함수는 외부 변수·import 없이 스스로 완결되어야 한다(직렬화되어 페이지의 격리된 world에서 실행된다).
// 실행 채널(Chrome 확장)은 executor.mjs가 맡고, 이 파일은 이 사이트의 폼 구조만 안다.

const FORM = 'form[data-ce-form="self-form.v1"]';

// 폼 구조 관측: 공고 정보와 문항(이름·표시 문구·종류·필수·길이 제한), 파일 입력. 값은 읽지 않는다.
export function inspectPage() {
  const form = document.querySelector('form[data-ce-form="self-form.v1"]');
  const header = document.querySelector('[data-ce-posting-id]');
  if (window !== window.top || !form || !header) return { ok: false, code: 'FORM_MARKER_MISSING' };
  if (document.querySelector('[data-ce-receipt]') || form.dataset.ceSubmitted === 'true') return { ok: false, code: 'ALREADY_SUBMITTED_PAGE' };
  const questions = [];
  const unsupported = [];
  let file = null;
  for (const element of form.elements) {
    if (!element.name || element.type === 'submit' || element.type === 'hidden' || element.tagName === 'FIELDSET' || element.tagName === 'BUTTON') continue;
    if (element.type === 'file') { file = { field: element.name, accept: element.accept, required: element.required }; continue; }
    const label = element.closest('label')?.querySelector('[data-ce-label]')?.textContent?.trim() ?? '';
    const kind = element.tagName === 'TEXTAREA' ? 'textarea' : element.type === 'checkbox' ? 'checkbox' : element.type === 'email' ? 'email' : element.type === 'text' ? 'text' : null;
    if (!kind) { unsupported.push(label || element.name); continue; }
    questions.push({ question_id: element.name, label, kind, required: element.required, max_length: Number(element.getAttribute('maxlength') ?? -1) });
  }
  const snapshot = {
    site_id: 'self-form', adapter_version: 'self-form.v1',
    posting: { posting_id: header.dataset.cePostingId ?? '', company_name: header.querySelector('[data-ce-company]')?.textContent?.trim() ?? '', title: header.querySelector('[data-ce-title]')?.textContent?.trim() ?? '' },
    questions, file,
  };
  return { ok: true, snapshot, unsupported };
}

// 허용된 문항만 채운다. 이미 다른 값이 들어 있으면(사용자·사이트가 입력) 덮어쓰지 않고 멈춘다. 파일은 받은 bytes로 첨부한다.
export function fillPage(fill, file) {
  const form = document.querySelector('form[data-ce-form="self-form.v1"]');
  if (!form) return { ok: false, code: 'FORM_MARKER_MISSING' };
  if (document.querySelector('[data-ce-receipt]') || form.dataset.ceSubmitted === 'true') return { ok: false, code: 'ALREADY_SUBMITTED_PAGE' };
  const conflicts = [];
  for (const item of fill) {
    const element = form.elements.namedItem(item.question_id);
    if (!element || typeof element.value !== 'string') return { ok: false, code: 'FIELD_MISSING', field: item.question_id };
    const currentValue = item.kind === 'checkbox' ? (element.checked ? 'checked' : '') : element.value;
    if (currentValue !== '' && currentValue !== item.value) conflicts.push(item.question_id);
  }
  if (conflicts.length) return { ok: false, code: 'FIELD_HAS_OTHER_VALUE', fields: conflicts };
  for (const item of fill) {
    const element = form.elements.namedItem(item.question_id);
    if (item.kind === 'checkbox') {
      if (element.checked !== (item.value === 'checked')) element.click();
      continue;
    }
    element.focus();
    element.value = item.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
  }
  const input = form.elements.namedItem('resume_file');
  if (!input || input.type !== 'file') return { ok: false, code: 'FILE_INPUT_MISSING' };
  const binary = atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], file.name, { type: file.type }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
}

// 실제 페이지 값과 첨부 파일 bytes의 hash를 다시 읽는다. 서버가 승인할 내용과 대조한다.
export async function readbackPage() {
  const form = document.querySelector('form[data-ce-form="self-form.v1"]');
  if (!form) return { ok: false, code: 'FORM_MARKER_MISSING' };
  const answers = [];
  let file = null;
  for (const element of form.elements) {
    if (!element.name || element.type === 'submit' || element.type === 'hidden' || element.tagName === 'FIELDSET' || element.tagName === 'BUTTON') continue;
    if (element.type === 'file') {
      const selected = element.files?.[0];
      if (selected) {
        const digest = await crypto.subtle.digest('SHA-256', await selected.arrayBuffer());
        file = { name: selected.name, size: selected.size, type: selected.type, sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
      }
      continue;
    }
    answers.push({ question_id: element.name, value: element.type === 'checkbox' ? (element.checked ? 'checked' : '') : element.value });
  }
  return { ok: true, readback: { answers, file } };
}

// 서버가 dispatched로 기록한 뒤에만 호출한다. 접수 키(시도 ID)를 넣고 제출 버튼으로 한 번 제출한다.
export function submitPage(submissionKey) {
  const form = document.querySelector('form[data-ce-form="self-form.v1"]');
  if (!form) return { ok: false, code: 'FORM_MARKER_MISSING' };
  if (document.querySelector('[data-ce-receipt]') || form.dataset.ceSubmitted === 'true') return { ok: false, code: 'ALREADY_SUBMITTED_PAGE' };
  const key = form.elements.namedItem('submission_key');
  const button = form.querySelector('[data-ce-submit]');
  if (!key || !button) return { ok: false, code: 'FORM_MARKER_MISSING' };
  key.value = submissionKey;
  form.dataset.ceSubmitted = 'true';
  form.requestSubmit(button);
  return { ok: true };
}

// 제출 뒤 결과 화면 관측. 접수 화면(접수번호·접수 키)·오류 표시·전송 중을 구분한다.
export function observePage() {
  const receipt = document.querySelector('[data-ce-receipt]');
  if (receipt) return { state: 'confirmation', observed: { receipt_number: receipt.dataset.ceReceipt ?? '', posting_id: receipt.dataset.ceReceiptPosting ?? '', submission_key: receipt.dataset.ceReceiptKey ?? '', page_url: location.href } };
  const error = document.querySelector('[data-ce-error]');
  if (error) return { state: 'form_error', detail: (error.dataset.ceError ?? 'UNKNOWN').slice(0, 100) };
  if (document.querySelector('[data-ce-status="sending"]')) return { state: 'sending' };
  return { state: 'idle' };
}

export const FORM_SELECTOR = FORM;
