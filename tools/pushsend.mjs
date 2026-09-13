/* Отправка тестового пуша на телефон — без сервера и без зависимостей.

   Смысл: до всякой покупки VPS выяснить, доходит ли push до конкретного
   телефона. Если не доходит — VPS не поможет, и путь другой (§2 плана).

   Что нужно: адрес подписки с телефона (tools/push.html → «Скопировать
   адрес») и ключи от tools/vapid.mjs. Телефон и компьютер интернетом
   друг о друге не знают — адрес переносится руками.

     node tools/pushsend.mjs 'https://fcm.googleapis.com/fcm/send/...'
     node tools/pushsend.mjs '{ "endpoint": "...", "keys": {...} }'

   Второй вид — вся подписка из того же окна: скрипт сам достанет endpoint.
   Понадобится на следующем шаге, когда в пуше пойдёт текст.

   Пуш уходит БЕЗ полезной нагрузки, намеренно. У пуша без текста нет
   шифрования (RFC 8291) — только подпись VAPID, то есть один JWT и один
   заголовок. Проверяем самое главное: доходит ли вообще. Если да,
   шифрование добавляется следующим шагом, и ломаться в нём уже нечему. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';

const KEY_FILE = path.join(os.homedir(), 'napominalka-vapid.json');

/* sub в VAPID — контакт того, кто шлёт. Push-служба использует его,
   если ей надо связаться по поводу рассылки. Адрес уже публичный:
   им же подписаны коммиты в этом репозитории. */
const CONTACT = 'mailto:328139209+YuriyRS@users.noreply.github.com';

const arg = process.argv.slice(2).join(' ').trim();

if (!arg) {
  console.error('Нужен адрес подписки с телефона (tools/push.html):');
  console.error("  node tools/pushsend.mjs 'https://fcm.googleapis.com/fcm/send/...'");
  process.exit(1);
}

if (!fs.existsSync(KEY_FILE)) {
  console.error('Нет ключей:', KEY_FILE, '— создайте их: node tools/vapid.mjs');
  process.exit(1);
}

let endpoint = arg;

if (arg.startsWith('{')) {
  try {
    endpoint = JSON.parse(arg).endpoint;
  } catch {
    console.error('Это похоже на JSON, но разобрать его не вышло. Скопируйте ещё раз целиком.');
    process.exit(1);
  }
}

if (!/^https:\/\/\S+$/.test(endpoint)) {
  console.error('Это не похоже на адрес подписки:', endpoint.slice(0, 80));
  console.error('Ждём строку вида https://fcm.googleapis.com/fcm/send/…');
  process.exit(1);
}

const keys = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
const url = new URL(endpoint);
const b64u = (b) => Buffer.from(b).toString('base64url');

/* Подпись VAPID — обычный JWT, подписанный ES256.

   Две тонкости, на которых легко ошибиться:
   - dsaEncoding: 'ieee-p1363' — подпись должна быть сырыми r||s.
     По умолчанию node отдаёт DER, и служба такой JWT не принимает
     с невнятной ошибкой 401.
   - aud — начало адреса подписки (схема и хост, без пути). Не тот aud —
     тоже 401, и снова без объяснений. */
const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
const claims = b64u(JSON.stringify({
  aud: url.origin,
  exp: Math.floor(Date.now() / 1000) + 12 * 3600,
  sub: CONTACT,
}));
const key = crypto.createPrivateKey({ key: keys.private, format: 'jwk' });
const sig = crypto.sign('sha256', Buffer.from(header + '.' + claims), { key, dsaEncoding: 'ieee-p1363' });
const jwt = `${header}.${claims}.${b64u(sig)}`;

const hhmmss = (d) => d.toLocaleTimeString('ru-RU');

console.log('Служба доставки:', url.host);
console.log('Отправляем в', hhmmss(new Date()), '…');

const started = Date.now();

const req = https.request({
  hostname: url.hostname,
  path: url.pathname + url.search,
  method: 'POST',
  headers: {
    Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
    TTL: '300',           // если телефон сейчас офлайн, служба подержит пуш 5 минут
    Urgency: 'high',      // уведомление просит разбудить, а не ждать удобного момента
    'Content-Length': 0,
  },
  timeout: 30000,
}, (res) => {
  let body = '';
  res.on('data', (c) => { body += c; });
  res.on('end', () => {
    const ms = Date.now() - started;

    if (res.statusCode === 201 || res.statusCode === 200) {
      console.log(`Служба приняла за ${ms} мс (${res.statusCode}).`);
      console.log('Теперь смотреть на телефон: уведомление покажет время, во сколько оно дошло.');
      if (body.trim()) console.log('Ответ:', body.trim().slice(0, 300));
      return;
    }

    console.log(`Отказ: ${res.statusCode} за ${ms} мс`);
    if (body.trim()) console.log('Ответ:', body.trim().slice(0, 500));

    /* Разбор частого, чтобы не гадать по коду. */
    if (res.statusCode === 401 || res.statusCode === 403) {
      console.log('Подпись VAPID не принята: проверьте, что ключи — из того же tools/vapid.mjs.');
    } else if (res.statusCode === 404 || res.statusCode === 410) {
      console.log('Подписки больше нет: на телефоне её отозвали (например, «Отписаться»).');
      console.log('Возьмите свежий адрес на странице подписки.');
    } else if (res.statusCode === 413) {
      console.log('Служба не приняла пуш такого размера.');
    }
  });
});

req.on('timeout', () => {
  console.log('Таймаут 30 с: до службы доставки не достучались.');
  req.destroy();
});

req.on('error', (e) => {
  console.log('Ошибка сети:', e.code || e.message);
});

req.end();
