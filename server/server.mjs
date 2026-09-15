/* ============================================================
   Сервер-будильник.

   Работа одна: разбудить телефон в назначенную минуту. Всё, что он хранит, —
   адрес подписки и список времён пробуждения. **Ни одного названия, ни одной
   заметки, ни одной голосовой записи.**

   И это не только про 152-ФЗ. Пуш, который он отправляет, несёт не текст,
   а номер дела — случайную строку. Что за дело, знает только телефон: он
   находит его у себя и показывает. Сервер, который ничего не знает, нечего
   и терять: утечка из него не стоит ничего.

   Запуск:
     DATA=./test.json VAPID=~/napominalka-vapid.json node server/server.mjs

   Наружу в интернет его ставит обратный прокси (Caddy) — он же держит
   сертификат. Сам сервер слушает обычный http и считает, что стоит за ним:
   так проще и безопаснее, чем городить TLS внутри. См. server/README.md.
   ============================================================ */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { sendPush } from './push.mjs';

const PORT = Number(process.env.PORT || 8081);
const DATA_FILE = process.env.DATA || path.join(os.homedir(), 'napominalka-server.json');
const KEY_FILE = process.env.VAPID || path.join(os.homedir(), 'napominalka-vapid.json');
const CONTACT = 'mailto:328139209+YuriyRS@users.noreply.github.com';

/* Насколько опоздавшее напоминание ещё имеет смысл слать.

   Если сервер лежал полчаса, после подъёма он увидит десяток просроченных
   времён и выпалит их все разом — телефон получит очередь уведомлений
   ни о чём. Напоминание, опоздавшее на десять минут, будить уже не должно:
   это уже не напоминание, а шум. */
const STALE_MS = 10 * 60_000;

/* Сколько держать времена, которые уже прошли. Нужно, чтобы повторная
   выгрузка с телефона не оживила отправленное заново. */
const KEEP_MS = 6 * 3600_000;

const MAX_BODY = 64 * 1024;      // больше телефона не пришлёт; больше — уже наглость
const RATE_LIMIT = 120;          // запросов в минуту с одного адреса

const keys = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));

/* ---------- Хранилище ----------

   Обычный файл. Устройств будут единицы, а не тысячи: это напоминалка
   для семьи и друзей, и база данных тут была бы позой, а не решением.
   Файл лежит вне репозитория — в репозитории ему делать нечего. */

let db = { devices: {} };

function load() {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!db.devices) db.devices = {};
  } catch {
    db = { devices: {} };                // первого раза файла ещё нет — и это нормально
  }
}

let saveTimer = null;
function saveSoon() {
  // Много устройств выгружают времена вразнобой — писать файл на каждое
  // было бы сотней записей на диск в минуту на ровном месте.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), () => {});
  }, 500);
}

/* ---------- Приём ---------- */

const seen = new Map();   // адрес → { count, until }

function rateOk(ip) {
  const now = Date.now();
  const r = seen.get(ip);
  if (!r || r.until < now) { seen.set(ip, { count: 1, until: now + 60_000 }); return true; }
  r.count++;
  return r.count <= RATE_LIMIT;
}

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    /* Разрешаем обращаться откуда угодно.

       Приложение живёт на GitHub Pages, сервер — на своём адресе, и без
       этого заголовка браузер запрос не пропустит. Пропускать «кого угодно»
       здесь можно: доступа к данным это не даёт. Чужой сайт может записать
       времена только на подписку, которой у него нет, — а подписка
       и есть пропуск. */
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('слишком большое тело')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('не разобрался JSON')); }
    });
    req.on('error', reject);
  });
}

/** Подписка приходит с телефона и служит ему же пропуском.

    Отдельного пароля нет намеренно: адрес подписки — уже секрет, длинная
    случайная строка, известная только телефону. Потерять её значит потерять
    только напоминания, а не данные: данных на сервере и нет. */
function validSubscription(s) {
  return s && typeof s.endpoint === 'string' && s.endpoint.startsWith('https://')
    && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
}

async function handle(req, res, ip) {
  if (!rateOk(ip)) return json(res, 429, { error: 'слишком часто' });

  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return json(res, 200, { ok: true, devices: Object.keys(db.devices).length });

  if (req.method !== 'POST') return json(res, 405, { error: 'только POST' });

  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, 400, { error: e.message }); }

  if (!validSubscription(body.subscription)) return json(res, 400, { error: 'подписка неполная' });
  const endpoint = body.subscription.endpoint;

  if (url.pathname === '/api/times') {
    const times = Array.isArray(body.times) ? body.times : [];
    const now = Date.now();

    /* Оставляем только то, что ещё впереди, и чистим то, что давно позади.

       Пришедшее из прошлого отбрасываем на входе: телефон мог выгрузить
       список, пока лежал без сети, и слать всё это разом не надо. */
    const fresh = times
      .filter((t) => t && typeof t.id === 'string' && Number.isFinite(t.at) && t.at > now - STALE_MS)
      .map((t) => ({ id: t.id, at: t.at, sent: false }));

    const kept = (db.devices[endpoint]?.times || [])
      .filter((t) => now - t.at < KEEP_MS)
      .filter((t) => t.sent)                       // отправленное помним, чтобы не слать дважды
      .filter((t) => !fresh.some((f) => f.id === t.id && f.at === t.at));

    db.devices[endpoint] = {
      subscription: body.subscription,
      updatedAt: now,
      times: [...kept, ...fresh],
    };
    saveSoon();
    return json(res, 200, { ok: true, принято: fresh.length });
  }

  if (url.pathname === '/api/later') {
    const dev = db.devices[endpoint];
    if (!dev) return json(res, 404, { error: 'устройство не знакомо' });
    const minutes = Math.min(Math.max(Number(body.minutes) || 10, 1), 24 * 60);
    const at = Date.now() + minutes * 60_000;
    dev.times.push({ id: String(body.id || ''), at, sent: false });
    saveSoon();
    return json(res, 200, { ok: true, at });
  }

  return json(res, 404, { error: 'не знаю такого' });
}

/* ---------- Побудка ----------

   Раз в полминуты. Минуты хватило бы, но неточность планировщика и неточность
   доставки складываются, а запас в тридцать секунд ничего не стоит. */

let firing = false;

async function tick() {
  if (firing) return;              // отправка — дело небыстрое, второй заход не нужен
  firing = true;
  const now = Date.now();

  try {
    for (const [endpoint, dev] of Object.entries(db.devices)) {
      for (const t of dev.times) {
        if (t.sent || t.at > now) continue;
        if (now - t.at > STALE_MS) { t.sent = true; continue; }

        // Номер дела. Ни названия, ни заметки — телефон найдёт их сам.
        const payload = JSON.stringify({ id: t.id, at: t.at });

        try {
          const r = await sendPush({
            subscription: dev.subscription, keys, contact: CONTACT, payload,
          });
          if (r.status === 201 || r.status === 200) {
            t.sent = true;
            console.log(new Date().toLocaleTimeString('ru-RU'), 'разбудили', endpoint.slice(-12), 'дело', t.id.slice(0, 8));
          } else if (r.status === 404 || r.status === 410) {
            // подписки больше нет — устройство отписалось, держать его незачем
            console.log('подписка отозвана, убираю устройство', endpoint.slice(-12));
            delete db.devices[endpoint];
            break;
          } else {
            t.sent = true;            // не мучаем службу повторами одного и того же
            console.log('отказ', r.status, r.body);
          }
        } catch (e) {
          console.log('не достучались:', e.message);   // попробуем в следующий заход
        }
      }
    }
    saveSoon();
  } finally {
    firing = false;
  }
}

/* ---------- Запуск ---------- */

load();
if (!fs.existsSync(KEY_FILE)) {
  console.error('Нет ключей VAPID:', KEY_FILE);
  console.error('Возьмите их из tools/vapid.mjs или положите файл рядом.');
  process.exit(1);
}

http.createServer((req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '?';
  handle(req, res, ip).catch((e) => {
    console.error('сбой обработки:', e.message);
    if (!res.headersSent) json(res, 500, { error: 'внутренняя беда' });
  });
}).listen(PORT, () => {
  console.log(`Сервер-будильник слушает ${PORT}, данные в ${DATA_FILE}`);
  console.log(`Устройств в памяти: ${Object.keys(db.devices).length}`);
});

setInterval(tick, 30_000);
console.log('Планировщик пошёл: проверка раз в полминуты');
