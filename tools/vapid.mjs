/* Ключи VAPID — пара, которой подписывается push-запрос.

   Публичный ключ секретом не является: он уезжает в tools/push.html
   и в саму подписку телефона. Закрытый — секрет: кто его знает, тот может
   слать пуши на подписку. Поэтому он лежит ВНЕ репозитория, рядом с бэкапом
   истории, а не в tools/: репозиторий публичный, и ключ в нём — открытая
   дверь. По той же причине он не кладётся и в tools/out/ — та папка хоть
   и в .gitignore, но называется «снимки», и искать секрет в ней не станут.

   node tools/vapid.mjs          — создать пару, если её ещё нет
   node tools/vapid.mjs заново   — пересоздать. Все прежние подписки умрут,
                                   на телефоне надо будет подписаться снова. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = path.join(os.homedir(), 'napominalka-vapid.json');
const force = process.argv[2] === 'заново';

if (fs.existsSync(FILE) && !force) {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  console.log('Пара уже есть:', FILE);
  console.log('\nПубличный ключ — в tools/push.html:\n');
  console.log(saved.publicKey);
  process.exit(0);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

/* Точка на кривой без сжатия: байт 0x04, затем x и y по 32 байта.
   Ровно в таком виде ключ ждёт applicationServerKey в браузере. */
const raw = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pub.x, 'base64url'),
  Buffer.from(pub.y, 'base64url'),
]);

const data = {
  publicKey: raw.toString('base64url'),
  private: { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d },
};

/* Проверяем сразу, что ключ читается обратно и подписывает. Иначе это
   выяснится на телефоне, где отлаживать дороже: телефон один, а шишек
   на нём не видно. */
const key = crypto.createPrivateKey({ key: data.private, format: 'jwk' });
crypto.sign('sha256', Buffer.from('проверка'), { key, dsaEncoding: 'ieee-p1363' });

fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
console.log('Создано:', FILE);
console.log('Закрытый ключ лежит только здесь и в репозиторий не попадает.');
console.log('\nПубличный ключ — вставить в tools/push.html:\n');
console.log(data.publicKey);
