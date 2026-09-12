/* ============================================================
   Стенд для проверки приложения глазами.

   В проекте нет сборки и зависимостей, и здесь их тоже нет:
   статику отдаёт node:http, браузером управляем по CDP через
   голый WebSocket — он есть в Node начиная с 22.

   Зачем вообще: вёрстку и поведение нужно видеть, а не угадывать.
   Один раз поднятый стенд позволяет снимать экран в любом
   состоянии и кликать по нему.
   ============================================================ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(HERE, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/* Chrome ставится в разные места; берём первый, который нашёлся */
const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.CHROME_PATH,
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const hit = CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('Chrome не найден. Укажи путь в CHROME_PATH.');
  return hit;
}

/**
 * Поднимает статику, Chrome без окна и соединение с ним.
 * Возвращает инструменты для сценария.
 */
export async function open({ port, out, width = 400, height = 880, scale = 2, base = '/' }) {
  fs.mkdirSync(out, { recursive: true });

  // BASE=/имя/ повторяет GitHub Pages, где приложение лежит не в корне.
  // Сервис-воркер и пути к иконкам ведут себя в подкаталоге иначе, и
  // проверять это лучше до выкладки, а не после.
  const prefix = ('/' + base.replace(/^\/|\/$/g, '') + '/').replace('//', '/');

  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith(prefix)) { res.writeHead(404); res.end('404'); return; }
    p = p.slice(prefix.length - 1);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    fs.readFile(file, (e, d) => {
      if (e) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(d);
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));

  // профиль каждый раз новый: иначе service worker и IndexedDB
  // переживут запуск и следующий снимок покажет прошлую версию
  const chrome = spawn(findChrome(), [
    '--headless=new', `--remote-debugging-port=${port + 1}`,
    `--user-data-dir=${path.join(out, 'profile-' + Date.now())}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', `--force-device-scale-factor=${scale}`, 'about:blank',
  ], { stdio: 'ignore' });

  async function browserWs() {
    for (let i = 0; i < 80; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port + 1}/json/version`);
        return (await r.json()).webSocketDebuggerUrl;
      } catch { await sleep(250); }
    }
    throw new Error('Chrome не поднялся за 20 секунд');
  }

  const ws = new WebSocket(await browserWs());
  await new Promise((r) => { ws.onopen = r; });

  let seq = 0;
  const waiters = new Map();
  const problems = [];

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) {
      const { res, rej } = waiters.get(m.id);
      waiters.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      problems.push('ИСКЛЮЧЕНИЕ: ' + (d?.exception?.description || d?.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      problems.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  };

  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++seq;
    waiters.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile: true,
  });

  const api = {
    problems,
    S,

    /** Выполнить выражение на странице и вернуть значение. */
    async evalIn(expression) {
      const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) problems.push('EVAL: ' + r.exceptionDetails.text);
      return r.result?.value;
    },

    /** Ждёт, пока выражение станет истинным.
        Фиксированные паузы врут: холодный запуск браузера с новым профилем
        иногда занимает больше секунды, и снимок выходит пустым. */
    async waitFor(expression, { timeout = 10_000, step = 100 } = {}) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        if (await api.evalIn(expression)) return true;
        await sleep(step);
      }
      return false;
    },

    async shot(name) {
      const { data } = await S('Page.captureScreenshot', { format: 'png' });
      const file = path.join(out, name + '.png');
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    },

    navigate: (url) => S('Page.navigate', { url }),

    /** Светлая или тёмная системная тема. */
    setSystemTheme: (value) =>
      S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] }),

    async close() {
      ws.close();
      chrome.kill();
      server.close();
    },
  };

  api.url = `http://127.0.0.1:${port}${prefix}`;
  return api;
}

/**
 * Кладёт задачи в IndexedDB до загрузки приложения.
 * Время считается от сегодняшнего дня, чтобы снимок был осмысленным.
 */
export function seedExpr(tasks) {
  return `(async () => {
    const d = new Date();
    const D = (h, m, daysAgo = 0) => {
      const x = new Date(d);
      x.setDate(x.getDate() - daysAgo);
      x.setHours(h, m, 0, 0);
      return x.getTime();
    };
    const tasks = (${JSON.stringify(tasks)}).map(({ h, m, daysAgo, ...rest }) =>
      ({ ...rest, at: D(h, m, daysAgo) }));
    await new Promise((res, rej) => {
      const rq = indexedDB.open('napominalka', 1);
      rq.onupgradeneeded = () => {
        const s = rq.result.createObjectStore('tasks', { keyPath: 'id' });
        s.createIndex('at', 'at');
      };
      rq.onsuccess = () => {
        const tx = rq.result.transaction('tasks', 'readwrite');
        tx.objectStore('tasks').clear();
        for (const t of tasks) tx.objectStore('tasks').put(t);
        tx.oncomplete = () => res('ok');
        tx.onerror = () => rej(tx.error);
      };
      rq.onerror = () => rej(rq.error);
    });
    return 'seeded';
  })()`;
}

/** Обычный день: два дела закрыто, четыре впереди, разрывы разной длины */
export const DEMO_DAY = [
  { id: 'a1', title: 'Забрать посылку', note: 'пункт выдачи у метро', h: 8, m: 20, done: true },
  { id: 'a2', title: 'Позвонить маме', note: '', h: 9, m: 40, done: true },
  { id: 'a3', title: 'Записаться к стоматологу', note: '', h: 12, m: 10, done: false },
  { id: 'a4', title: 'Купить сыр галанский', note: 'в Пятёрочке у дома', h: 15, m: 0, done: false },
  { id: 'a5', title: 'Забрать велосипед из ремонта', note: '', h: 18, m: 30, done: false },
  { id: 'a6', title: 'Оплатить электричество', note: 'до 25-го', h: 20, m: 15, done: false },
];

/** То же, но два дела остались с прошлых дней */
export const DEMO_LATE = [
  { id: 'b1', title: 'Сдать анализы', note: '', h: 9, m: 0, daysAgo: 1, done: false },
  { id: 'b2', title: 'Записаться на приём к врачу', note: '', h: 16, m: 30, daysAgo: 3, done: false },
  ...DEMO_DAY,
];
