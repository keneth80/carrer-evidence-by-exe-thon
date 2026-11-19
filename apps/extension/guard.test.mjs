import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PANEL_REQUEST, isExecutableTarget, isPanelRequest, isPanelSender, postingFromUrl } from './guard.mjs';

// 확장의 고정 경계: 실행 가능한 주소, 패널 발신자, 패널 메시지 형식, 매니페스트 권한.

test('executor accepts only exact self-form application URLs', () => {
  assert.equal(postingFromUrl('http://127.0.0.1:4310/demo/apply/lumino-frontend'), 'lumino-frontend');
  assert.equal(isExecutableTarget('http://127.0.0.1:4310/demo/apply/lumino-frontend'), true);
  for (const url of [
    undefined, 'not a URL', 'http://localhost:4310/demo/apply/lumino-frontend',
    'https://127.0.0.1:4310/demo/apply/lumino-frontend', 'http://127.0.0.1:4311/demo/apply/lumino-frontend',
    'http://127.0.0.1:4310/demo/apply', 'http://127.0.0.1:4310/demo/apply/', 'http://127.0.0.1:4310/demo/apply/Upper',
    'http://127.0.0.1:4310/demo/apply/lumino-frontend?url=https://example.com', 'http://127.0.0.1:4310/demo/apply/lumino-frontend#another',
    'http://user:pass@127.0.0.1:4310/demo/apply/lumino-frontend', 'http://127.0.0.1:4310/demo/apply/a/b', 'https://jobs.example.com/apply/lumino-frontend',
  ]) assert.equal(isExecutableTarget(url), false, String(url));
});

test('panel sender must be the exact extension side panel, not a content script or tab', () => {
  const sender = { id: 'testid', url: 'chrome-extension://testid/sidepanel.html', origin: 'chrome-extension://testid' };
  assert.equal(isPanelSender(sender, 'testid'), true);
  assert.equal(isPanelSender({ ...sender, id: 'other' }, 'testid'), false);
  assert.equal(isPanelSender({ ...sender, url: 'https://example.com' }, 'testid'), false);
  assert.equal(isPanelSender({ ...sender, origin: 'https://example.com' }, 'testid'), false);
  assert.equal(isPanelSender({ ...sender, tab: { id: 1 } }, 'testid'), false);
});

test('panel requests carry only a known action and its exact ID arguments', () => {
  const base = { type: PANEL_REQUEST, request_id: 'bf0a4246-35a0-4c31-b690-b5de247c3f74' };
  assert.equal(isPanelRequest({ ...base, action: 'status', args: {} }), true);
  assert.equal(isPanelRequest({ ...base, action: 'prepare', args: { application_id: 'application_1' } }), true);
  assert.equal(isPanelRequest({ ...base, action: 'run', args: { attempt_id: 'attempt_1' } }), true);
  assert.equal(isPanelRequest({ ...base, action: 'pair', args: { code: 'ABCD-EFGH', label: '내 Chrome' } }), true);
  for (const bad of [
    { ...base, action: 'submit', args: {} },
    { ...base, action: '__proto__', args: {} },
    { ...base, action: 'run', args: { attempt_id: 'a', url: 'https://example.com' } },
    { ...base, action: 'run', args: { attempt_id: '../x' } },
    { ...base, action: 'prepare', args: { application_id: 'x', selector: 'form' } },
    { ...base, action: 'status', args: { script: 'alert(1)' } },
    { ...base, action: 'pair', args: { code: '<script>', label: 'x' } },
    { ...base, action: 'status', args: {}, url: 'https://example.com' },
    { ...base, request_id: 'not-a-uuid', action: 'status', args: {} },
    { ...base, type: 'CE_STARTER_INSPECT', action: 'status', args: {} },
    { ...base, action: 'status', args: [] },
  ]) assert.equal(isPanelRequest(bad), false, JSON.stringify(bad));
});

test('manifest requests only the app origin host permission and no broad access', () => {
  const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:4310/*']);
  assert.deepEqual([...manifest.permissions].sort(), ['scripting', 'sidePanel', 'storage']);
  assert.equal(manifest.content_scripts, undefined, 'no content scripts injected on every page');
  assert.equal(manifest.externally_connectable, undefined, 'web pages cannot message the extension');
});
