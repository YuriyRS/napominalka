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
    // Микрофона у headless Chrome нет, но есть поддельный — без него
    // запись голоса нечем проверить, а разрешение выдаётся сразу, иначе
    // окно браузера ждало бы нажатия, которого в стенде некому сделать.
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
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
  const dialogs = [];   // то, что приложение сказало через alert/confirm

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
    /* Окна alert/confirm закрываем сами.

       В headless-браузере такое окно останавливает страницу насмерть:
       Runtime.evaluate не отвечает никогда, и стенд висит без единой
       строчки в выводе — выглядит как «скрипт сломался», хотя сломался
       не он. Приложение показывает alert, например, после загрузки копии,
       и это нормально; ненормально, что стенд на нём замирает. */
    if (m.method === 'Page.javascriptDialogOpening') {
      dialogs.push(m.params.message);
      send('Page.handleJavaScriptDialog', { accept: true }, m.sessionId);
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
    dialogs,
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
export function seedExpr(tasks, subs = []) {
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
    /* Настоящий звук для демо-записей.

       Кнопку проигрывания надо чем-то проверить, а пустышка на месте звука
       проверкой не будет. Собираем короткий WAV прямо здесь: заголовок
       в сорок четыре байта и синусоида с огибающей, чтобы волна на экране
       была похожа на речь, а не на ровную полосу. */
    const wav = (seconds) => {
      const rate = 8000, n = rate * seconds;
      const buf = new ArrayBuffer(44 + n);
      const v = new DataView(buf);
      const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
      str(12, 'fmt '); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate, true);
      v.setUint16(32, 1, true); v.setUint16(34, 8, true);
      str(36, 'data'); v.setUint32(40, n, true);
      for (let i = 0; i < n; i++) {
        const env = 0.35 + 0.65 * Math.abs(Math.sin(i / 900));
        v.setUint8(44 + i, 128 + Math.round(70 * env * Math.sin(i / 26)));
      }
      return new Blob([buf], { type: 'audio/wav' });
    };

    await new Promise((res, rej) => {
      // Версия обязана совпадать с db.js. Разойдутся — стенд получит
      // VersionError на любом профиле, где приложение успело создать
      // базу новее. См. ПЛАН.md §7.
      const rq = indexedDB.open('napominalka', 3);
      rq.onupgradeneeded = () => {
        const s = rq.result.createObjectStore('tasks', { keyPath: 'id' });
        s.createIndex('at', 'at');
        // отдельным if, как и в db.js: у уже созданной базы первая
        // проверка истинна, и вложенное создание не выполнилось бы
        if (!rq.result.objectStoreNames.contains('voice')) rq.result.createObjectStore('voice');
        if (!rq.result.objectStoreNames.contains('subs')) {
          rq.result.createObjectStore('subs', { keyPath: 'id' });
        }
      };
      rq.onsuccess = () => {
        const tx = rq.result.transaction(['tasks', 'voice', 'subs'], 'readwrite');
        tx.objectStore('tasks').clear();
        const vs = tx.objectStore('voice');
        vs.clear();
        for (const t of tasks) {
          tx.objectStore('tasks').put(t);
          // длительность в описании должна совпадать со звуком, иначе
          // проигрыватель покажет одно, а сыграет другое
          if (t.voice) vs.put(wav(Math.round(t.voice.ms / 1000)), t.voice.id);
        }
        const ss = tx.objectStore('subs');
        ss.clear();
        // inDays — «через сколько дней спишут»; в базе лежит дата и день
        // месяца, из которого считается следующее списание (см. nextCharge)
        for (const { inDays, ...x } of (${JSON.stringify(subs)})) {
          const at = D(0, 0, -inDays);
          ss.put({ ...x, nextAt: at, day: new Date(at).getDate() });
        }
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

/** День с голосовыми заметками: у двух дел из шести заметка записана голосом.

    Волна здесь нарисована, а не снята с записи: у настоящей она снимается
    анализатором по ходу записи. Похожа на речь — с паузами и всплесками,
    чтобы отличать её от ровной полосы было чем. */
const demoWave = (seed) => Array.from({ length: 40 }, (_, i) =>
  Math.round((0.18 + 0.82 * Math.abs(Math.sin((i + seed) / 4.7))) * 100) / 100);

export const DEMO_VOICE = DEMO_DAY.map((t, i) => (i === 2 || i === 4
  ? { ...t, note: '', voice: { id: 'v' + i, ms: 12000, wave: demoWave(i), type: 'audio/wav' } }
  : t));

/** Подписки: разные периоды, ближайшее списание и две отменённые.

    Суммы в копейках — как и в базе. Дробь в деньгах рано или поздно
    показывает «9 587.999999999998 ₽» на ровном месте, и лучше это
    не заводить вовсе. */
export const DEMO_SUBS = [
  { id: 's1', title: 'Нетфликс',       amount: 79900,  period: 'month', inDays: 2,  color: 'rose',   state: 'on' },
  { id: 's2', title: 'Клод',           amount: 200000, period: 'month', inDays: 5,  color: 'orange', state: 'on' },
  { id: 's3', title: 'Иви',            amount: 39900,  period: 'month', inDays: 12, color: 'violet', state: 'on' },
  { id: 's4', title: 'Яндекс Плюс',    amount: 39900,  period: 'month', inDays: 20, color: 'amber',  state: 'on' },
  { id: 's5', title: 'Окко',           amount: 29900,  period: 'month', inDays: 27, color: 'sky',    state: 'on' },
  { id: 's6', title: 'Хранилище фото', amount: 299000, period: 'year',  inDays: 44, color: 'teal',   state: 'on' },
  { id: 's7', title: 'Спортзал',       amount: 250000, period: 'month', inDays: 8,  color: 'green',  state: 'off' },
  { id: 's8', title: 'Музыка',         amount: 16900,  period: 'month', inDays: 9,  color: 'blue',   state: 'off' },
];

/** Время «сегодня, h:m, минус daysAgo дней».

    Нужно ровно затем же, зачем D() внутри seedExpr: якорь серии обязан
    совпадать со временем её первого вхождения. Считать его надо так же —
    местным временем, а не UTC. */
const dayAt = (h, m, daysAgo = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

/** Серия повторов: зарядка каждое утро.

    Якорь — три дня назад, поэтому в наборе есть и прошлые вхождения, и
    сегодняшнее, и завтрашнее. Одно вчерашнее намеренно не закрыто: на нём
    проверяется, что повтор не всплывает в «Просрочено». Последняя запись —
    зарубка на месте удалённого вхождения.

    Остальные вхождения до горизонта досоздаст syncSeries при запуске —
    это и есть проверка размножения. */
const SPORT_ON = { kind: 'daily', days: [], anchor: dayAt(7, 0, 3) };

/** Год: разброс по всем месяцам, чтобы «Год» было на что смотреть.

    Прошлое заполнено одиночными делами намеренно: серии назад не
    размножаются, у них есть якорь и будущее. Поэтому прошлое года — это
    то, что человек записал руками, и густота там неровная. Ровный ритм
    вперёд дают две серии ниже. */
export const DEMO_YEAR = (() => {
  // [сколько дней назад, сколько дел в тот день]
  const plan = [
    [0, 3], [1, 2], [3, 1], [6, 2], [11, 1], [16, 5], [23, 1], [29, 2],
    [36, 1], [42, 3], [50, 2], [58, 4], [66, 1], [74, 2], [83, 6], [92, 1],
    [101, 2], [112, 1], [124, 3], [137, 2], [149, 1], [162, 2], [176, 4],
    [190, 1], [205, 2], [219, 1], [234, 3], [248, 2], [262, 1], [277, 2],
    [293, 1], [312, 2], [331, 1],
  ];
  const titles = ['Позвонить маме', 'Купить хлеб', 'Забрать посылку', 'Записаться к врачу',
    'Полить цветы', 'Сдать анализы', 'Оплатить электричество', 'Съездить к родителям'];

  let n = 0;
  const out = [];
  for (const [daysAgo, count] of plan) {
    for (let i = 0; i < count; i++) {
      n++;
      out.push({
        id: 'y' + n,
        title: titles[n % titles.length],
        note: '',
        h: 9 + (n % 10),
        m: (n * 7) % 60,
        daysAgo,
        done: daysAgo > 0,
      });
    }
  }

  // Вторая половина года — серии. Одиночные дела вперёд никто не пишет,
  // а «в мае будет жарко» — это как раз про будущее: без серий правая
  // половина экрана осталась бы пустой и опыт ничего бы не показал.
  // Якорь обязан совпадать со временем первого вхождения — см. README.
  out.push({
    id: 'y-Зарядка', title: 'Зарядка', note: '', h: 7, m: 30, daysAgo: 0,
    seriesId: 'ysport', repeat: { kind: 'weekly', days: [1, 3, 5], anchor: dayAt(7, 30, 0) },
    done: false,
  });
  out.push({
    id: 'y-Квартира', title: 'Оплатить квартиру', note: '', h: 12, m: 0, daysAgo: 0,
    seriesId: 'yrent', repeat: { kind: 'monthly', days: [], anchor: dayAt(12, 0, 0) },
    done: false,
  });

  return out;
})();

export const DEMO_REPEAT = [
  { id: 'r1', title: 'Зарядка', note: 'десять минут', h: 7, m: 0, daysAgo: 3, seriesId: 'sport', repeat: SPORT_ON, done: true },
  { id: 'r2', title: 'Зарядка', note: 'десять минут', h: 7, m: 0, daysAgo: 2, seriesId: 'sport', repeat: SPORT_ON, done: true },
  { id: 'r3', title: 'Зарядка', note: 'десять минут', h: 7, m: 0, daysAgo: 1, seriesId: 'sport', repeat: SPORT_ON, done: false },
  { id: 'r4', title: 'Зарядка', note: 'десять минут', h: 7, m: 0, daysAgo: 0, seriesId: 'sport', repeat: SPORT_ON, done: false },
  { id: 'r5', title: 'Зарядка', note: 'десять минут', h: 7, m: 0, daysAgo: -1, seriesId: 'sport', repeat: SPORT_ON, done: false },
  { id: 'r6', title: 'Зарядка', note: 'десять минут', h: 7, m: 0, daysAgo: -2, seriesId: 'sport', repeat: SPORT_ON, skipped: true },
  { id: 'r7', title: 'Купить хлеб', note: '', h: 18, m: 30, daysAgo: 0, done: false },
];

/** Разброс по месяцу — чтобы в календаре были видны все четыре уровня
    плотности. Отрицательный daysAgo — будущие дни: seedExpr считает дату
    как «сегодня минус daysAgo дней». */
export const DEMO_MONTH = [
  { id: 'm01', title: 'Продлить страховку', note: '', h: 11, m: 0, daysAgo: 18, done: true },
  { id: 'm02', title: 'Сдать анализы', note: '', h: 9, m: 0, daysAgo: 12, done: true },
  { id: 'm03', title: 'Записаться к стоматологу', note: '', h: 12, m: 10, daysAgo: 12, done: true },
  { id: 'm04', title: 'Оплатить интернет', note: '', h: 19, m: 0, daysAgo: 12, done: true },
  { id: 'm05', title: 'Забрать посылку', note: '', h: 18, m: 0, daysAgo: 7, done: false },
  { id: 'm06', title: 'Позвонить маме', note: '', h: 20, m: 0, daysAgo: 3, done: true },
  { id: 'm07', title: 'Купить корм коту', note: '', h: 16, m: 0, daysAgo: 3, done: false },
  ...DEMO_DAY,
  { id: 'm08', title: 'Забрать велосипед из ремонта', note: '', h: 18, m: 30, daysAgo: -2, done: false },
  { id: 'm09', title: 'Встреча с врачом', note: '', h: 10, m: 0, daysAgo: -2, done: false },
  { id: 'm10', title: 'Оплатить квартиру', note: 'до 25-го', h: 12, m: 0, daysAgo: -2, done: false },
  { id: 'm11', title: 'Записаться на приём', note: '', h: 15, m: 0, daysAgo: -2, done: false },
  { id: 'm12', title: 'Продлить домен', note: '', h: 13, m: 0, daysAgo: -5, done: false },
  { id: 'm13', title: 'День рождения Сергея', note: 'подарок', h: 10, m: 0, daysAgo: -9, done: false },
  { id: 'm14', title: 'Купить продукты на неделю', note: '', h: 11, m: 0, daysAgo: -9, done: false },
  { id: 'm15', title: 'Отвезти документы', note: '', h: 12, m: 0, daysAgo: -9, done: false },
  { id: 'm16', title: 'Записаться в бассейн', note: '', h: 14, m: 0, daysAgo: -9, done: false },
  { id: 'm17', title: 'Съездить на дачу', note: '', h: 16, m: 0, daysAgo: -9, done: false },
  { id: 'm18', title: 'Починить кран', note: '', h: 17, m: 30, daysAgo: -9, done: false },
  { id: 'm19', title: 'Оплатить электричество', note: '', h: 20, m: 15, daysAgo: -9, done: false },
];
