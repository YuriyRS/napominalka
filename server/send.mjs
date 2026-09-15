/* Отправить один пуш на телефон — проверить, что шифрование работает.

   node server/send.mjs '<вся подписка>' 'Текст, который должен прийти'

   Подписка берётся на телефоне: tools/push.html → «Скопировать целиком».
   Одного адреса здесь мало — нужны ещё p256dh и auth: ими шифруется текст.
   Телефон отдал их, когда оформлял подписку, и только он может расшифровать
   обратно: закрытая половина никогда его не покидала.

   Ключи VAPID — из ~/napominalka-vapid.json (tools/vapid.mjs). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendPush } from './push.mjs';

const KEY_FILE = path.join(os.homedir(), 'napominalka-vapid.json');
const CONTACT = 'mailto:328139209+YuriyRS@users.noreply.github.com';

const [raw, text = 'Зашифрованный пуш дошёл'] = process.argv.slice(2);

if (!raw) {
  console.error('Нужна вся подписка с телефона (tools/push.html → «Скопировать целиком»):');
  console.error("  node server/send.mjs '{ \"endpoint\": \"…\", \"keys\": {…} }' 'Текст'");
  process.exit(1);
}
if (!fs.existsSync(KEY_FILE)) {
  console.error('Нет ключей:', KEY_FILE, '— создайте их: node tools/vapid.mjs');
  process.exit(1);
}

let subscription;
try {
  subscription = JSON.parse(raw);
} catch {
  console.error('Подписка не разобралась. Скопируйте её целиком, одним куском.');
  process.exit(1);
}
if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
  console.error('В подписке не хватает частей: нужны endpoint, keys.p256dh и keys.auth.');
  console.error('Адрес без ключей годится только для пуша без текста — он уже проверен.');
  process.exit(1);
}

const keys = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
const payload = JSON.stringify({ title: 'Напоминалка', body: text });

console.log('Отправляем в', new Date().toLocaleTimeString('ru-RU'), '—', text.length, 'символов');

try {
  const res = await sendPush({ subscription, keys, contact: CONTACT, payload });
  if (res.status === 201 || res.status === 200) {
    console.log(`Служба приняла (${res.status}). Смотрите на телефон.`);
  } else if (res.status === 401 || res.status === 403) {
    console.log(`Отказ ${res.status}: подпись VAPID не принята.`, res.body);
  } else if (res.status === 404 || res.status === 410) {
    console.log(`Подписки больше нет (${res.status}): её отозвали на телефоне.`);
  } else {
    console.log(`Отказ ${res.status}.`, res.body);
  }
} catch (e) {
  console.log('Не достучались:', e.message);
}
