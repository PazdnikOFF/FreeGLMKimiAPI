#!/usr/bin/env node
/**
 * Z.ai browser auth — HTTP-сервер + SSH-туннель.
 *
 * Запустите на сервере:
 *   node scripts/zai_browser_auth.js
 *
 * Скрипт выведет:
 *   1. Команду для SSH-туннеля (выполнить на своём ПК)
 *   2. Ссылку для открытия в браузере
 *
 * ENV:
 *   AUTH_PATH         — путь к auth.json (default: ./auth.json)
 *   ZAI_AUTH_PORT     — порт HTTP-сервера (default: 9335)
 *   ZAI_AUTH_TIMEOUT  — таймаут в секундах (default: 300)
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const outPath = process.env.AUTH_PATH || path.join(ROOT, 'auth.json');
const port = Number(process.env.ZAI_AUTH_PORT || 9335);
const timeoutSec = Number(process.env.ZAI_AUTH_TIMEOUT || 300);

const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Z.ai Auth</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 32px; max-width: 520px; width: 100%; }
  h1 { font-size: 1.3rem; margin-bottom: 6px; color: #fff; }
  .sub { color: #888; font-size: 0.85rem; margin-bottom: 24px; }
  .step { display: flex; gap: 12px; margin-bottom: 18px; }
  .num { background: #2a2a2a; border: 1px solid #444; border-radius: 50%; width: 28px; height: 28px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; color: #aaa; margin-top: 2px; }
  .step-body p { font-size: 0.9rem; margin-bottom: 6px; }
  .step-body code { background: #111; border: 1px solid #333; border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; color: #7dd3fc; }
  a.btn { display: inline-block; background: #1d4ed8; color: #fff; text-decoration: none; border-radius: 6px; padding: 8px 16px; font-size: 0.85rem; margin-top: 4px; }
  a.btn:hover { background: #2563eb; }
  textarea { width: 100%; background: #111; border: 1px solid #444; border-radius: 6px; color: #e0e0e0; padding: 10px; font-size: 0.8rem; font-family: monospace; resize: vertical; min-height: 70px; margin-top: 8px; }
  textarea:focus { outline: none; border-color: #1d4ed8; }
  button { background: #16a34a; color: #fff; border: none; border-radius: 6px; padding: 10px 24px; font-size: 0.9rem; cursor: pointer; width: 100%; margin-top: 12px; }
  button:hover { background: #15803d; }
  .msg { margin-top: 14px; padding: 10px 14px; border-radius: 6px; font-size: 0.85rem; display: none; }
  .msg.ok { background: #14532d; border: 1px solid #16a34a; color: #86efac; display: block; }
  .msg.err { background: #450a0a; border: 1px solid #dc2626; color: #fca5a5; display: block; }
  .divider { border: none; border-top: 1px solid #2a2a2a; margin: 20px 0; }
</style>
</head>
<body>
<div class="card">
  <h1>Z.ai — авторизация</h1>
  <p class="sub">FreeGLMKimiAPI · t.me/forgetmeai</p>

  <div class="step">
    <div class="num">1</div>
    <div class="step-body">
      <p>Откройте Z.ai и войдите в аккаунт</p>
      <a class="btn" href="https://chat.z.ai" target="_blank">Открыть chat.z.ai ↗</a>
    </div>
  </div>

  <div class="step">
    <div class="num">2</div>
    <div class="step-body">
      <p>На вкладке Z.ai нажмите <strong>F12</strong> → <strong>Console</strong> и выполните:</p>
      <code>copy(localStorage.getItem('token'))</code>
      <p style="margin-top:6px;color:#888;font-size:0.8rem">Токен скопируется в буфер обмена.</p>
    </div>
  </div>

  <div class="step">
    <div class="num">3</div>
    <div class="step-body">
      <p>Вставьте токен сюда и нажмите Сохранить:</p>
      <textarea id="token" placeholder="eyJhbGciOi..."></textarea>
    </div>
  </div>

  <button onclick="submit()">Сохранить токен</button>
  <div class="msg" id="msg"></div>
</div>
<script>
async function submit() {
  const token = document.getElementById('token').value.trim();
  const msg = document.getElementById('msg');
  msg.className = 'msg';
  if (!token.startsWith('eyJ') || token.split('.').length !== 3) {
    msg.className = 'msg err';
    msg.textContent = 'Токен должен быть JWT (начинается с eyJ и содержит 3 части через точку)';
    return;
  }
  try {
    const r = await fetch('/save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ token }) });
    const data = await r.json();
    if (data.ok) {
      msg.className = 'msg ok';
      msg.textContent = '✅ Токен сохранён! ' + (data.id ? 'Аккаунт: ' + data.id : '') + ' Можно закрыть вкладку.';
    } else {
      msg.className = 'msg err';
      msg.textContent = 'Ошибка: ' + (data.error || 'неизвестная');
    }
  } catch(e) {
    msg.className = 'msg err';
    msg.textContent = 'Сетевая ошибка: ' + e.message;
  }
}
document.getElementById('token').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
});
</script>
</body>
</html>`;

function decodeJwt(token) {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch { return {}; }
}

function saveAuth(token) {
  const p = decodeJwt(token);
  const account = {
    id: p.email || p.id || `zai-${Date.now()}`,
    provider: 'glm',
    backend: 'zai',
    token,
    browser_fallback: true,
  };
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ accounts: [account] }, null, 2), { mode: 0o600 });
  return account;
}

function getServerHostname() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
  } catch {}
  return os.hostname();
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

async function main() {
  let done = false;

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
      return;
    }
    if (req.method === 'POST' && req.url === '/save') {
      const body = await readBody(req);
      const token = String(body.token || '').trim();
      if (!token.startsWith('eyJ') || token.split('.').length !== 3) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid JWT' }));
        return;
      }
      try {
        const account = saveAuth(token);
        console.log(`\n[auth] ✅ Токен сохранён: ${outPath}`);
        console.log(`[auth] Аккаунт: ${account.id}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: account.id }));
        done = true;
        setTimeout(() => { server.close(); process.exit(0); }, 1500);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }
    res.writeHead(404); res.end();
  });

  server.listen(port, '127.0.0.1', () => {
    const hostname = getServerHostname();
    const sshUser = process.env.USER || 'user';
    console.log('\n======================================================');
    console.log('FreeGLMKimiAPI — Z.ai авторизация');
    console.log('======================================================');
    console.log('\n1. Выполните на своём ПК (SSH-туннель):');
    console.log(`\n   ssh -L ${port}:localhost:${port} ${sshUser}@${hostname}\n`);
    console.log('2. Откройте в браузере на своём ПК:');
    console.log(`\n   http://localhost:${port}\n`);
    console.log('3. Войдите в Z.ai и вставьте токен на странице.');
    console.log('======================================================');
    console.log(`Таймаут: ${timeoutSec}с. Ожидаю токен...\n`);
  });

  // Таймаут
  setTimeout(() => {
    if (!done) {
      console.error(`[auth] Таймаут ${timeoutSec}с. Токен не получен.`);
      server.close();
      process.exit(2);
    }
  }, timeoutSec * 1000);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('[auth] ОШИБКА:', e.message); process.exit(1); });
}
