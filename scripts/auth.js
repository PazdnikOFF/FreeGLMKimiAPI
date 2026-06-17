#!/usr/bin/env node
/**
 * FreeGLMKimiAPI — управление Z.ai/GLM авторизацией
 * Использование: node scripts/auth.js [--login|--status|--remove|--help]
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUTH_PATH = process.env.AUTH_PATH || path.join(ROOT, 'auth.json');
const WATERMARK = 't.me/forgetmeai';

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans); }));
}
function divider() { console.log('======================================================'); }

function loadAuth() {
  try { return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8')); }
  catch { return null; }
}

function status() {
  const auth = loadAuth();
  console.log('\nZ.ai / GLM аккаунт:');
  if (!auth || !auth.accounts?.length) {
    console.log('  ❌ auth.json не найден или пуст');
  } else {
    console.log(`  ✅ ${AUTH_PATH}`);
    for (const a of auth.accounts) {
      const tok = a.token ? `OK (${String(a.token).length} chars)` : 'MISSING';
      console.log(`  • [${a.provider}/${a.backend || '—'}] id=${a.id}  token=${tok}`);
    }
  }
}

function runBrowserAuth() {
  const script = path.join(__dirname, 'zai_browser_auth.js');
  return spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env }).status === 0;
}

function removeAuth() {
  if (fs.existsSync(AUTH_PATH)) {
    fs.rmSync(AUTH_PATH, { force: true });
    console.log('Удалён auth.json.');
  } else {
    console.log('auth.json не найден.');
  }
}

function printHelp() {
  divider();
  console.log(`FreeGLMKimiAPI — управление Z.ai/GLM login  (${WATERMARK})`);
  divider();
  console.log('  --login     Браузерная авторизация через CDP');
  console.log('  --status    Показать статус auth');
  console.log('  --remove    Удалить auth.json');
  console.log('  --help      Справка');
  console.log('Без опций — интерактивное меню.');
  divider();
}

async function menu() {
  while (true) {
    divider();
    console.log(`ForgetMeAI: ${WATERMARK}`);
    status();
    divider();
    console.log('1 - Авторизоваться / обновить Z.ai login');
    console.log('2 - Показать статус');
    console.log('3 - Удалить auth.json');
    console.log('4 - Выход');
    const choice = (await ask('Ваш выбор (Enter = 4): ')) || '4';
    if (choice === '1') runBrowserAuth();
    else if (choice === '2') { status(); await ask('\nНажмите Enter...'); }
    else if (choice === '3') removeAuth();
    else break;
  }
}

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) printHelp();
else if (args.has('--login') || args.has('--relogin') || args.has('--add')) runBrowserAuth();
else if (args.has('--status') || args.has('--list')) status();
else if (args.has('--remove')) removeAuth();
else await menu();
