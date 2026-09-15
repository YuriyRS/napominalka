/* ============================================================
   Отправка пуша — с полезной нагрузкой, то есть с шифрованием.

   До сих пор пуш летел пустым: текста нет — шифровать нечего, и ломаться
   нечему. Но серверу нужно сказать телефону, какое дело напомнить, а класть
   название в открытом виде нельзя: тогда ровно то, от чего мы уходили,
   поехало бы через чужую службу — «Купить сыр галанский» крупным шрифтом
   в логах Google.

   Шифрование здесь по стандарту (RFC 8291 поверх RFC 8188, «aes128gcm»),
   и оно не наше изобретение: то же самое делает любая библиотека веб-пушей.
   Нам оно нужно затем, что зависимостей в проекте нет и не будет.

   Ключи берутся из самой подписки: телефон при оформлении отдал открытую
   половину (p256dh) и общий секрет (auth). Расшифровать может только он —
   закрытая половина никогда не покидала телефон.

   Проверяется это не рассуждением, а вызовом: отправили — телефон показал.
   ============================================================ */

import crypto from 'node:crypto';
import https from 'node:https';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (str) => Buffer.from(str, 'base64url');

/** Подпись VAPID: обычный JWT, подписанный ES256.

    Тонкость, на которой легко ошибиться, — `dsaEncoding: 'ieee-p1363'`:
    служба ждёт подпись сырыми r||s, а node по умолчанию отдаёт DER,
    и на этом служба отвечает 401 без объяснений. */
function vapidJwt(endpoint, keys, contact) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: contact,
  }));
  const key = crypto.createPrivateKey({ key: keys.private, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), {
    key, dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${claims}.${b64u(sig)}`;
}

/** Тело запроса: заголовок записи плюс шифротекст.

    Вынесено наружу не для красоты: это единственная часть, которую стоит
    проверять отдельно. Отправку проверяет телефон, а вот правильно ли
    собрано тело — видно только сверкой с тем, кто умеет расшифровывать.
    Такой есть у стенда: браузер расшифровывает ровно тем же кодом, что
    и телефон. См. tools/crypto-check.mjs. */
export function encrypt(payload, uaPublic, authSecret) {
  /* Одноразовая пара сервера живёт ровно один пуш и никуда не записывается.
     Переиспользовать её нельзя: ключ перестанет быть одноразовым, и это
     уже не мелочь, а дыра. */
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);

  /* Два прохода выработки ключа, и порядок здесь не наш.

     Первый связывает общий секрет с секретом подписки — чтобы знание одной
     лишь открытой половины ничего не давало. Второй, уже внутри записи,
     добавляет соль: одна и та же полезная нагрузка при одних и тех же ключах
     обязана шифроваться каждый раз по-новому. */
  const ikm = crypto.hkdfSync('sha256', secret, authSecret,
    Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);

  const salt = crypto.randomBytes(16);
  const cek = crypto.hkdfSync('sha256', ikm, salt,
    Buffer.from('Content-Encoding: aes128gcm\0\x01'), 16);
  const nonce = crypto.hkdfSync('sha256', ikm, salt,
    Buffer.from('Content-Encoding: nonce\0\x01'), 12);

  /* 0x02 в конце — признак последней записи. Без него телефон прочитает
     сообщение как незаконченное и отбросит — молча.

     Здесь я однажды написал этот комментарий и забыл сам байт. Ошибка тихая
     и издевательская: расшифровка проходила, текст доходил почти целиком —
     терялся ровно один байт в конце. На «Купить сыр галанский» пропадала
     половина последней буквы, на коротких строках было незаметно вовсе.
     Поймала это tools/crypto-check.mjs, а не глаз. */
  const plain = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', Buffer.from(cek), Buffer.from(nonce));
  const encrypted = Buffer.concat([
    cipher.update(plain),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  // заголовок записи: соль, размер записи, длина ключа и сам одноразовый ключ
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);

  return Buffer.concat([header, asPublic, encrypted]);
}

/** Отправить пуш. Возвращает ответ службы; бросает только на сетевой беде. */
export function sendPush({ subscription, keys, contact, payload, ttl = 3600, urgency = 'high' }) {
  const url = new URL(subscription.endpoint);
  const body = encrypt(payload, unb64u(subscription.keys.p256dh), unb64u(subscription.keys.auth));

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        Authorization: `vapid t=${vapidJwt(subscription.endpoint, keys, contact)}, k=${keys.publicKey}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'Content-Length': body.length,
        TTL: String(ttl),
        Urgency: urgency,
      },
      timeout: 30_000,
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: text.trim().slice(0, 300) }));
    });
    req.on('timeout', () => req.destroy(new Error('таймаут')));
    req.on('error', reject);
    req.end(body);
  });
}
