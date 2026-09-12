/* Проверка поведения: кликаем по галочке, закрываем день, ходим по вкладкам,
   открываем оба листа, следим за цветом статус-бара и ловим ошибки консоли.

   node tools/check.mjs

   Печатает по строке на проверку и «консоль чистая» в конце.
   Снимки спорных моментов — в tools/out/. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, seedExpr, DEMO_DAY, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');

const b = await open({ port: 8096, out: OUT, width: 400, height: 900 });
const say = (label, v) => console.log(label.padEnd(15), v);

await b.navigate(b.url);
await sleep(1000);
await b.evalIn(seedExpr(DEMO_DAY));
await b.navigate(b.url);
await sleep(1500);

const snap = () => b.evalIn(`JSON.stringify({
  всего: document.querySelectorAll('.task').length,
  сделано: document.querySelectorAll('.task--done').length,
  подсвечено: document.querySelector('.task--flash')?.dataset.id || null,
  шапка: document.querySelector('.hero__sub')?.textContent.trim(),
  полоса: document.querySelector('.hero__bar i')?.style.width,
  сейчас: document.querySelector('.now__label')?.textContent || null,
})`);

say('до отметки', await snap());

await b.evalIn(`document.querySelector('[data-id="a3"] .task__check').click()`);
await sleep(500);
await b.shot('после-отметки');
say('после отметки', await snap());

// закрываем день целиком — проверяем, что зелёный появляется один раз
for (const id of ['a4', 'a5', 'a6']) {
  await b.evalIn(`document.querySelector('[data-id="${id}"] .task__check').click()`);
  await sleep(250);
}
await sleep(400);
await b.shot('день-закрыт');
say('день закрыт', await b.evalIn(`JSON.stringify({
  сделано: document.querySelectorAll('.task--done').length,
  лента_дня_осталась: !!document.querySelector('.list:not(.list--done)'),
  зелёная_строка: !!document.querySelector('.hero__sub--done'),
  полоса: document.querySelector('.hero__bar i')?.style.width,
})`));

await b.evalIn(`document.querySelector('[data-id="a3"] .task__check').click()`);
await sleep(400);

await b.evalIn(`document.querySelector('[data-tab="month"]').click()`);
await sleep(400);
say('вкладка «Месяц»', await b.evalIn(`JSON.stringify({
  заголовок: document.querySelector('.top__title')?.textContent,
  заглушка: !!document.querySelector('.soon'),
})`));

await b.evalIn(`document.querySelector('[data-tab="today"]').click()`);
await sleep(600);
say('возврат', await b.evalIn(`JSON.stringify({
  дата: document.querySelector('.hero__date')?.textContent,
  вкладка: document.querySelector('.nav__item--active')?.dataset.tab,
})`));

// цвет статус-бара должен следовать за выбранной темой, а не за системой
await b.evalIn(`document.querySelector('[data-act="settings"]').click()`);
await sleep(400);
const tcLight = await b.evalIn(`document.querySelector('#theme-color').getAttribute('content')`);
await b.setSystemTheme('dark');
await sleep(400);
const tcAuto = await b.evalIn(`document.querySelector('#theme-color').getAttribute('content')`);
await b.evalIn(`document.querySelector('[data-theme-set="light"]').click()`);
await sleep(400);
const tcForced = await b.evalIn(`document.querySelector('#theme-color').getAttribute('content')`);
say('цвет бара', JSON.stringify({
  светлая_система: tcLight,
  система_тёмная: tcAuto,
  светлая_вопреки_системе: tcForced,
}));

await b.evalIn(`document.querySelector('[data-theme-set="auto"]').click()`);
await b.setSystemTheme('light');
await sleep(300);
await b.evalIn(`document.querySelector('[data-act="close"]').click()`);
await sleep(400);

await b.evalIn(`document.querySelector('[data-act="add"]').click()`);
await sleep(600);
await b.shot('лист-добавления');
say('лист добавления', await b.evalIn(`JSON.stringify({
  открыт: document.querySelector('#sheet').classList.contains('sheet--on'),
  время: document.querySelector('#f-time').value,
})`));

console.log(b.problems.length ? '\nПРОБЛЕМЫ:\n' + b.problems.join('\n') : '\nконсоль чистая');

await b.close();
process.exit(0);
