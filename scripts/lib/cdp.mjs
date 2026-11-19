import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 개발 검증 전용: 설치된 Google Chrome을 임시 프로필로 띄우고 CDP(--remote-debugging-pipe)로 조작한다.
// 사용자 기본 프로필은 쓰지 않는다. 확장은 CDP Extensions.loadUnpacked로 올린다(--enable-unsafe-extension-debugging).

export const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launchChrome({ profile = mkdtempSync(join(tmpdir(), 'ce-chrome-')), headless = true } = {}) {
  const args = [`--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', '--disable-features=Translate'];
  if (headless) args.push('--headless=new');
  const child = spawn(CHROME, [...args, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const write = child.stdio[3];
  const read = child.stdio[4];
  let buffer = '';
  let nextId = 0;
  const waits = new Map();
  const listeners = new Set();
  read.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      if (message.id && waits.has(message.id)) { waits.get(message.id)(message); waits.delete(message.id); }
      else for (const listener of listeners) listener(message);
    }
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    waits.set(id, message => message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result));
    write.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const browser = {
    profile, child, send,
    on: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    async loadExtension(path) { return (await send('Extensions.loadUnpacked', { path })).id; },
    async attach(targetId) {
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      return session(browser, sessionId);
    },
    async waitTarget(predicate, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const { targetInfos } = await send('Target.getTargets');
        const found = targetInfos.find(predicate);
        if (found) return found;
        await sleep(200);
      }
      throw new Error('TARGET_NOT_FOUND');
    },
    async newPage(url) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const page = await browser.attach(targetId);
      await page.send('Page.enable');
      await page.goto(url);
      return Object.assign(page, { targetId });
    },
    async kill() { child.kill('SIGKILL'); await exited; },
    async close() { try { await send('Browser.close'); } catch { /* 이미 닫힘 */ } await Promise.race([exited, sleep(3000)]); if (child.exitCode === null) child.kill('SIGKILL'); },
    removeProfile() { rmSync(profile, { recursive: true, force: true }); },
  };
  return browser;
}

function session(browser, sessionId) {
  const send = (method, params) => browser.send(method, params, sessionId);
  return {
    sessionId, send,
    async evaluate(expression, { userGesture = false } = {}) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture });
      if (result.exceptionDetails) throw new Error(`EVALUATE_FAILED: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
      return result.result.value;
    },
    async goto(url) {
      await send('Page.navigate', { url });
      await this.waitFor('document.readyState === "complete"');
    },
    async waitFor(expression, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try { if (await this.evaluate(`Boolean(${expression})`)) return; } catch { /* 페이지 이동 중 */ }
        await sleep(150);
      }
      throw new Error(`WAIT_TIMEOUT: ${expression}`);
    },
    async screenshot() {
      const metrics = await send('Page.getLayoutMetrics');
      const { width, height } = metrics.cssContentSize ?? metrics.contentSize;
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(width), height: Math.min(Math.ceil(height), 6000), scale: 1 } });
      return Buffer.from(shot.data, 'base64');
    },
  };
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
