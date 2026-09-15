/* Проверка шифрования пуша.

   node tools/crypto-check.mjs

   Зачем отдельная проверка. Отправку пуша проверяет телефон — показал
   уведомление, значит дошло. А вот **правильно ли собрано тело** так
   не проверить: телефон либо покажет, либо промолчит, и молчание одинаково
   выглядит при ошибке в одном байте и при мёртвой подписке.

   Поэтому здесь сверка с тем, кто умеет расшифровывать. Браузер расшифровывает
   ровно тем же кодом, что и телефон — тем самым, который зашит в Chrome.
   Если он прочитал наше тело — прочитает и телефон.

   Ключи для проверки — свои, одноразовые: настоящая подписка тут не нужна
   и не должна быть нужна. */

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './cdp.mjs';
import { encrypt } from '../server/push.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const b64u = (buf) => Buffer.from(buf).toString('base64url');

const tests = [
  'Зашифрованный пуш дошёл',
  'Купить сыр галанский',
  'Позвонить маме — 15:00',
  JSON.stringify({ title: 'Напоминалка', body: 'Записаться к стоматологу' }),
  '',                                     // пустая нагрузка — тоже законная
  'ы'.repeat(500),                        // и длинная: проверить, что проходит
];

const b = await open({ port: 8190, out: path.join(HERE, 'out'), width: 400, height: 300 });

/* Открываем настоящую страницу, а не пустую.

   На `about:blank` нет `crypto.subtle`: браузер выдаёт его только доверенным
   источникам, а пустая страница таким не считается. Ошибка при этом выглядит
   как «Cannot read properties of undefined» — то есть как наша, хотя наша
   тут ни при чём. */
await b.navigate(b.url);

/* Пару ключей заводит браузер, а не node, и это не прихоть.

   Расшифровать может только владелец закрытой половины. Сгенерируй мы пару
   в node — браузеру было бы нечем расшифровывать, и проверка превратилась бы
   в «сам с собой»: мы бы шифровали своим ключом и им же проверяли.
   Здесь всё как на телефоне: ключ родился там, наружу отдал только открытую
   половину, а закрытую не покажет никому и никогда. */
const uaPublicB64 = await b.evalIn(`(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  window.__phone = pair.privateKey;
  crypto.getRandomValues(window.__auth = new Uint8Array(16));
  window.__uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return btoa(String.fromCharCode(...window.__uaPublic));
})()`);

if (typeof uaPublicB64 !== 'string') {
  console.log('браузер не завёл ключ:', uaPublicB64, b.problems.join(' | '));
  await b.close();
  process.exit(1);
}

const uaPublic = Buffer.from(uaPublicB64, 'base64');
const authSecret = Buffer.from(await b.evalIn(
  `btoa(String.fromCharCode(...window.__auth))`), 'base64');

let wrong = 0;
for (const text of tests) {
  const body = encrypt(text, uaPublic, authSecret);
  const got = await decryptInBrowser(b, body);
  const ok = got === text;
  if (!ok) wrong++;
  console.log(
    ok ? 'ок  ' : 'НЕТ ',
    JSON.stringify(text.slice(0, 38)) + (text.length > 38 ? `… (${text.length} знаков)` : ''),
    ok ? '' : '→ прочитано: ' + JSON.stringify(String(got).slice(0, 70)),
  );
}

/* Сверка с эталоном из стандарта.

   Браузер проверяет, что тело читается, — но не что оно собрано **точно
   так, как положено**. Мелкая вольность в порядке байтов или в соли пройдёт
   незамеченной: свой шифр свой же и прочтёт.

   Поэтому второй проверкой — готовый пример из RFC 8291, приложение A:
   там заданы и ключи, и соль, и точный ответ. Совпало побайтово — значит
   собрано по стандарту, а не просто «само с собой согласно». */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  expected: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml'
    + 'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT'
    + 'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const got = encrypt(
  RFC.plaintext,
  Buffer.from(RFC.uaPublic, 'base64url'),
  Buffer.from(RFC.authSecret, 'base64url'),
  { privateKey: Buffer.from(RFC.asPrivate, 'base64url'), salt: Buffer.from(RFC.salt, 'base64url') },
).toString('base64url');

const rfcOk = got === RFC.expected;
console.log(rfcOk
  ? 'ок   эталон RFC 8291 сошёлся побайтово'
  : 'НЕТ  эталон RFC 8291 не сошёлся\n     ждали: ' + RFC.expected.slice(0, 60)
    + '\n     вышло: ' + got.slice(0, 60));
if (!rfcOk) wrong++;

console.log(wrong
  ? `\nНЕ ПРОШЛО: ${wrong}`
  : `\nвсё сошлось — ${tests.length} нагрузок и эталон стандарта`);
if (b.problems.length) console.log('ошибки в браузере:', b.problems.join(' | '));

await b.close();
process.exit(wrong ? 1 : 0);

/** Расшифровывает тело в браузере ровно так, как это делал бы телефон. */
function decryptInBrowser(browser, body) {
  return browser.evalIn(`(async () => { try {
    /* atob понимает только обычный base64, а тело приходит в base64url:
       в нём вместо «+» и «/» стоят «-» и «_». Без перевода он отказывается
       разбирать строку — с сообщением, из которого этого не видно. */
    const un = (s) => Uint8Array.from(
      atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

    const body = un(${JSON.stringify(b64u(body))});

    // заголовок записи: соль, длина ключа, сам одноразовый ключ, дальше шифротекст
    const salt = body.slice(0, 16);
    const asPublic = body.slice(21, 21 + body[20]);
    const data = body.slice(21 + body[20]);

    const asKey = await crypto.subtle.importKey('raw', asPublic,
      { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const secret = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'ECDH', public: asKey }, window.__phone, 256));

    const info = new Uint8Array([...new TextEncoder().encode('WebPush: info'), 0,
      ...window.__uaPublic, ...asPublic]);
    const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
    const ikm = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: window.__auth, info }, base, 256));

    const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const cek = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt,
        info: new TextEncoder().encode('Content-Encoding: aes128gcm\\u0000') }, ikmKey, 128);
    const nonce = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt,
        info: new TextEncoder().encode('Content-Encoding: nonce\\u0000') }, ikmKey, 96);

    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, data));

    // 0x02 в конце — признак последней записи, в самый текст он не входит
    return new TextDecoder().decode(plain.slice(0, -1));
  } catch (e) { return 'ОШИБКА РАСШИФРОВКИ: ' + (e && e.message ? e.message : e); } })()`);
}
