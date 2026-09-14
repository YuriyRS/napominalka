/* Проверка того, как приложение поведёт себя на GitHub Pages.

   Там оно лежит не в корне, а по пути /имя-репозитория/, и это классическое
   место, где всё молча ломается: иконки, манифест, область видимости
   сервис-воркера, офлайн-кэш. Проверять это до выкладки, а не после.

   node tools/deploy.mjs                 — как будто имя репозитория napominalka
   BASE=/другое-имя/ node tools/deploy.mjs
*/

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const BASE = process.env.BASE || '/napominalka/';

const b = await open({ port: 8108, out: OUT, width: 400, height: 880, base: BASE });
const say = (label, v) => console.log(label.padEnd(17), v);

const READY = `document.querySelectorAll('.nav__item').length === 4`;

/** Ждём отрисовки, а не фиксированную паузу, и отдельно отмечаем,
    если приложение так и не поднялось, — иначе пустой снимок уйдёт молча. */
async function load(label) {
  const ok = await b.waitFor(READY);
  await sleep(300);
  say(label, await b.evalIn(
    `document.querySelectorAll('.nav__item').length + ' вкладки, экран: '
     + (document.querySelector('.top__eyebrow')?.textContent || '—')`,
  ));
  if (!ok) b.problems.push('приложение не отрисовалось за 10 секунд');
}

await b.navigate(b.url);
await sleep(200);

say('адрес', b.url);
await load('страница');

// ресурсы запрашиваем ровно так, как их просит браузер, — относительными путями
say('манифест', await b.evalIn(
  `fetch('./manifest.json').then((r) => r.status + ' ' + (r.ok ? 'ок' : 'ОШИБКА'))`,
));

say('иконки', await b.evalIn(
  `fetch('./manifest.json').then((r) => r.json()).then((m) => Promise.all(
     m.icons.map((i) => fetch(i.src).then((r) => i.src + '→' + r.status))
   )).then((x) => x.join(', '))`,
));

/* Шрифт проверяется отдельно и с двух сторон.

   Сломайся путь к нему в подкаталоге — приложение не сломается: оно молча
   покажет системный шрифт, и заметить это можно только глазами, сравнивая
   с эталоном. Поэтому смотрим и на сам файл, и на то, подключился ли он. */
say('шрифт', await b.evalIn(
  `fetch('./fonts/golos-text-cyrillic.woff2')
     .then((r) => r.status + ' ' + (r.ok ? 'ок' : 'ОШИБКА'))
     .catch(() => 'НЕ ДОСТУЧАЛИСЬ')`,
));

say('шрифт в деле', await b.evalIn(
  `document.fonts.ready.then(() => {
     const mine = [...document.fonts].filter((f) => f.family.includes('Golos'));
     const on = mine.filter((f) => f.status === 'loaded').length;
     return on ? 'подключён, наборов: ' + on : 'НЕ ПОДКЛЮЧИЛСЯ (показывается системный)';
   })`,
));

await sleep(1500);
say('воркер', await b.evalIn(
  `navigator.serviceWorker.getRegistration().then((r) => r ? r.scope : 'НЕ ЗАРЕГИСТРИРОВАН')`,
));
say('контроль', await b.evalIn(
  `navigator.serviceWorker.controller ? 'страница под управлением воркера' : 'воркер ещё не взял управление'`,
));

// Самая ценная проверка: выключить сеть и открыть заново. Если кэш собран
// с относительными путями, приложение поднимется; если нет — белый экран.
await b.S('Network.enable');
await b.S('Network.emulateNetworkConditions', {
  offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});
await b.navigate(b.url);
await sleep(200);
await load('без сети');
// без сети шрифт обязан взяться из кэша — иначе приложение открывается
// системным, и это ровно то, чего не видно на снимке
say('шрифт офлайн', await b.evalIn(
  `document.fonts.ready.then(() => {
     const on = [...document.fonts].filter((f) => f.family.includes('Golos') && f.status === 'loaded').length;
     return on ? 'из кэша, наборов: ' + on : 'ПОТЕРЯЛСЯ (показывается системный)';
   })`,
));
await b.shot('выкладка-офлайн');

await b.S('Network.emulateNetworkConditions', {
  offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});

const bad = b.problems.filter((p) => !/favicon/i.test(p));
console.log(bad.length ? '\nПРОБЛЕМЫ:\n' + bad.join('\n') : '\nконсоль чистая');

await b.close();
process.exit(0);
