#!/usr/bin/env node
/**
 * Z.ai CDP auth — без puppeteer, работает через проброс порта.
 *
 * Сценарий «сервер без GUI»:
 *   1. На ПК с GUI откройте Chrome с флагом --remote-debugging-port=9335
 *      (или просто запустите этот скрипт — он откроет Chrome сам, если найдёт его)
 *   2. Пробросьте порт на сервер:  ssh -R 9335:localhost:9335 user@server
 *   3. На сервере запустите:       node scripts/zai_browser_auth.js
 *
 * Сценарий «локальная машина с GUI»:
 *   node scripts/zai_browser_auth.js
 *   (Chrome запускается автоматически)
 *
 * ENV:
 *   AUTH_PATH            — куда сохранять auth.json (default: ./auth.json)
 *   ZAI_CHROME_PORT      — CDP-порт Chrome (default: 9335)
 *   ZAI_AUTH_TIMEOUT_MS  — таймаут ожидания логина (default: 300000)
 *   ZAI_ALLOW_GUEST_AUTH — разрешить гостевые токены (default: false)
 *   CHROME_PATH          — путь к Chrome-бинарю (auto-detect если не задан)
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const outPath = process.env.AUTH_PATH || path.join(ROOT, 'auth.json');
const port = Number(process.env.ZAI_CHROME_PORT || 9335);
const loginUrl = 'https://chat.z.ai';
const timeoutMs = Number(process.env.ZAI_AUTH_TIMEOUT_MS || 300_000);
const allowGuest = ['1', 'true', 'yes', 'on'].includes(String(process.env.ZAI_ALLOW_GUEST_AUTH || '').toLowerCase());

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function devtoolsReady() {
  try { return await fetchJson(`http://127.0.0.1:${port}/json/version`); }
  catch { return null; }
}

async function waitDevtools(maxMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const v = await devtoolsReady();
    if (v) return v;
    await sleep(300);
  }
  return null;
}

function resolveChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const p of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ]) { if (fs.existsSync(p)) return p; }
  return null;
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    this.ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    };
  }
  ready() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; }); }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch {} }
}

function decodeJwt(token) {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch { return {}; }
}

function isGuestToken(token) {
  const p = decodeJwt(token);
  const email = String(p.email || '').toLowerCase();
  const id = String(p.id || p.user_id || '').toLowerCase();
  return email.endsWith('@guest.com') || id.startsWith('guest-') || email.startsWith('guest-');
}

function isUsableToken(token) {
  if (!token || !token.startsWith('eyJ') || token.split('.').length !== 3) return false;
  if (!allowGuest && isGuestToken(token)) return false;
  return true;
}

function saveAuth(token, cookie = '') {
  const p = decodeJwt(token);
  const account = {
    id: p.email || p.id || `zai-${Date.now()}`,
    provider: 'glm',
    backend: 'zai',
    token,
    browser_fallback: true,
  };
  if (cookie) account.cookie = cookie;
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ accounts: [account] }, null, 2), { mode: 0o600 });
  console.log(`[auth] Сохранено: ${outPath}`);
  console.log(`[auth] email:  ${p.email || '—'}`);
  console.log(`[auth] userId: ${p.id || p.user_id || '—'}`);
}

async function main() {
  const alreadyRunning = !!(await devtoolsReady());

  if (!alreadyRunning) {
    const chromePath = resolveChrome();
    if (chromePath) {
      console.log(`[auth] Запускаю Chrome: ${chromePath}`);
      console.log(`[auth] CDP порт: ${port}`);
      const chrome = spawn(chromePath, [
        `--remote-debugging-port=${port}`,
        '--no-first-run', '--no-default-browser-check',
        '--disable-sync', '--use-mock-keychain',
        '--disable-extensions',
        '--disable-blink-features=AutomationControlled',
        loginUrl,
      ], { stdio: 'ignore', detached: true });
      chrome.unref();
      console.log('[auth] Жду запуск Chrome...');
      const v = await waitDevtools(15_000);
      if (!v) {
        console.error(`[auth] Chrome не ответил на порту ${port} за 15с.`);
        console.error(`[auth] Для проброса с ПК с GUI: ssh -R ${port}:localhost:${port} user@server`);
        process.exit(1);
      }
    } else {
      console.log(`[auth] Chrome не найден локально. Жду CDP на порту ${port}...`);
      console.log(`[auth] На ПК с GUI: откройте Chrome с флагом --remote-debugging-port=${port}`);
      console.log(`[auth] Проброс порта: ssh -R ${port}:localhost:${port} user@server`);
      const v = await waitDevtools(60_000);
      if (!v) {
        console.error(`[auth] Нет ответа CDP на порту ${port} за 60с. Прерываю.`);
        process.exit(1);
      }
    }
  } else {
    console.log(`[auth] Подключаюсь к Chrome на порту ${port}`);
  }

  const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
  const target = targets.find(t => t.type === 'page' && /chat\.z\.ai/.test(t.url))
    || targets.find(t => t.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('Не найдена страница Chrome');

  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  let networkToken = '';
  cdp.on(msg => {
    const headers = msg.params?.headers || msg.params?.request?.headers || {};
    const auth = headers.authorization || headers.Authorization || '';
    const m = String(auth).match(/^Bearer\s+(.+)$/i);
    if (m && isUsableToken(m[1])) networkToken = m[1];
  });

  console.log('\n[auth] Войдите в Z.ai в открытом окне Chrome.');
  console.log(`[auth] Таймаут: ${Math.round(timeoutMs / 1000)}с`);

  let warnedGuest = false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const localToken = await cdp.send('Runtime.evaluate', {
      expression: `(() => { try { return localStorage.getItem('token') || ''; } catch { return ''; } })()`,
      returnByValue: true,
    }).then(r => r.result?.value || '').catch(() => '');

    for (const token of [localToken, networkToken]) {
      if (!token) continue;
      if (!allowGuest && isGuestToken(token)) {
        if (!warnedGuest) {
          warnedGuest = true;
          console.log('[auth] Гостевой токен — продолжаю ждать входа с реального аккаунта...');
        }
        continue;
      }
      if (isUsableToken(token)) {
        const cookiesRes = await cdp.send('Network.getAllCookies').catch(() => ({ cookies: [] }));
        const cookie = (cookiesRes.cookies || [])
          .filter(c => /z\.ai$/.test(c.domain))
          .map(c => `${c.name}=${c.value}`).join('; ');
        saveAuth(token, cookie);
        cdp.close();
        return;
      }
    }
    await sleep(2000);
  }

  cdp.close();
  console.error('[auth] Таймаут. Войдите в Z.ai и повторите auth:browser.');
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('[auth] ОШИБКА:', e.message); process.exit(1); });
}
