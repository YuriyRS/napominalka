/* Проверка поведения: кликаем по галочке, закрываем день, ходим по вкладкам,
   открываем оба листа, следим за цветом статус-бара и ловим ошибки консоли.

   node tools/check.mjs

   Печатает по строке на проверку и «консоль чистая» в конце.
   Снимки спорных моментов — в tools/out/. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, seedExpr, DEMO_DAY, DEMO_LATE, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');

const b = await open({ port: 8104, out: OUT, width: 400, height: 900, base: process.env.BASE });
const say = (label, v) => console.log(label.padEnd(15), v);

await b.navigate(b.url);
await sleep(1000);
await b.evalIn(seedExpr(DEMO_DAY));
await b.navigate(b.url);
await sleep(1500);

/** Настоящее долгое нажатие: держим кнопку мыши 650 мс и отпускаем. */
async function longPress(sel) {
  await b.evalIn(`document.querySelector('${sel}').scrollIntoView({ block: 'center' })`);
  await sleep(350);
  const p = JSON.parse(await b.evalIn(`JSON.stringify((() => {
    const r = document.querySelector('${sel}').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })())`));
  const base = { x: p.x, y: p.y, button: 'left', clickCount: 1 };
  await b.S('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, buttons: 0 });
  await b.S('Input.dispatchMouseEvent', { type: 'mousePressed', ...base, buttons: 1 });
  await sleep(650);
  await b.S('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 });
  await sleep(450);
}

const snap = () => b.evalIn(`JSON.stringify({
  всего: document.querySelectorAll('.task').length,
  сделано: document.querySelectorAll('.task--done').length,
  подсвечено: document.querySelector('.task--flash')?.dataset.id || null,
  шапка: document.querySelector('.hero__sub')?.textContent.trim(),
  полоса: document.querySelector('.hero__bar i')?.style.width,
  сейчас: document.querySelector('.now__label')?.textContent || null,
})`);

// Зону нажатия меряем, пока никакой лист не открыт: затемнение перекрывает
// экран и elementFromPoint вернул бы его, а не галочку.
say('зона нажатия', await b.evalIn(`JSON.stringify((() => {
  const el = document.querySelector('.task__check');
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el, '::after');
  const hit = (dy) => {
    const t = document.elementFromPoint(r.left + r.width / 2, r.top - dy);
    return t?.closest('.task__check') ? 'да' : 'нет';
  };
  // ширина псевдоэлемента и есть зона нажатия: план требует не меньше 48
  return {
    кружок: Math.round(r.height) + 'px',
    зона: cs.width,
    в_8px_над: hit(8),
    в_14px_над: hit(14),
  };
})())`));

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

/* Строка установки.

   Chrome — в том числе headless — сам выдаёт beforeinstallprompt, раз
   приложение установимо, и приложение его ловит. Значит, проверять надо
   обе стороны: что без приглашения строка спрятана и что с приглашением
   она видна и работает.

   Событие подсовываем своё, а не полагаемся на настоящее: настоящее
   одноразовое и уже потрачено приложением при загрузке, а нам нужно
   ещё и нажать кнопку. */
await b.evalIn(`window.dispatchEvent(new Event('appinstalled'))`);
await sleep(200);
const installHidden = await b.evalIn(
  `document.getElementById('install-row').hidden
   && getComputedStyle(document.getElementById('install-row')).display === 'none'`);

await b.evalIn(`(() => {
  window.__prompted = 0;
  const e = new Event('beforeinstallprompt');
  e.prompt = () => { window.__prompted++; return Promise.resolve(); };
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
})()`);
await sleep(200);
const installShown = await b.evalIn(
  `!document.getElementById('install-row').hidden
   && getComputedStyle(document.getElementById('install-row')).display !== 'none'`);

await b.shot('настройки');

await b.evalIn(`document.querySelector('[data-act="install"]').click()`);
await sleep(300);
const prompted = await b.evalIn(`window.__prompted`);
const installGoneAgain = await b.evalIn(`document.getElementById('install-row').hidden`);

say('установка', JSON.stringify({
  без_приглашения_скрыта: installHidden,
  с_приглашением_видна: installShown,
  prompt_вызван: prompted,
  после_нажатия_скрыта: installGoneAgain,
}));

await b.evalIn(`document.querySelector('[data-act="close"]').click()`);
await sleep(400);

await b.evalIn(`document.querySelector('[data-act="add"]').click()`);
await sleep(600);
await b.shot('лист-добавления');
say('лист добавления', await b.evalIn(`JSON.stringify({
  открыт: document.querySelector('#sheet').classList.contains('sheet--on'),
  время: document.querySelector('#f-time').value,
})`));

// ---------- действия над делом ----------

await b.evalIn(`document.querySelector('#sheet-cancel').click()`);
await sleep(400);

await longPress('[data-id="a4"]');
await b.shot('лист-действий');
say('долгое нажатие', await b.evalIn(`JSON.stringify({
  лист: document.querySelector('#task-sheet').classList.contains('sheet--on'),
  дело: document.querySelector('#task-sheet-title')?.textContent,
  перенос: document.querySelector('#move-label')?.textContent,
  // план требует зону нажатия не меньше 48 px
  высоты: [...document.querySelectorAll('#task-sheet .act')].map((e) => Math.round(e.getBoundingClientRect().height)),
})`));

/** Контраст текста к фону листа — план требует читаемости в обеих темах. */
const CONTRAST = `(() => {
  const lum = (c) => {
    const [r, g, bl] = c.match(/[0-9.]+/g).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const ratio = (a, z) => {
    const [hi, lo] = [lum(a), lum(z)].sort((p, q) => q - p);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  const bg = getComputedStyle(document.querySelector('#task-sheet')).backgroundColor;
  const pick = (sel) => getComputedStyle(document.querySelector(sel)).color;
  return {
    удалить: ratio(pick('.act--danger'), bg),
    изменить: ratio(pick('.act'), bg),
    название_дела: ratio(pick('#task-sheet-title'), bg),
  };
})()`;

say('контраст, светлая', await b.evalIn(CONTRAST));
await b.setSystemTheme('dark');
await sleep(400);
say('контраст, тёмная', await b.evalIn(CONTRAST));
await b.setSystemTheme('light');
await sleep(300);

await b.evalIn(`document.querySelector('[data-act="edit"]').click()`);
await sleep(600);
say('изменение', await b.evalIn(`JSON.stringify({
  заголовок_листа: document.querySelector('#sheet-title')?.textContent,
  название: document.querySelector('#f-title')?.value,
  заметка: document.querySelector('#f-note')?.value,
  время: document.querySelector('#f-time')?.value,
  кнопка: document.querySelector('#task-form [type="submit"]')?.textContent,
})`));

await b.evalIn(`document.querySelector('#f-title').value = 'Купить сыр и хлеб'`);
await b.evalIn(`document.querySelector('#task-form [type="submit"]').click()`);
await sleep(700);
say('после правки', await b.evalIn(`JSON.stringify({
  название: document.querySelector('[data-id="a4"] .task__title')?.textContent,
  заметка: document.querySelector('[data-id="a4"] .task__note')?.textContent,
  всего: document.querySelectorAll('.task').length,
})`));

await longPress('[data-id="a4"]');
await b.evalIn(`document.querySelector('[data-act="move"]').click()`);
await sleep(700);
say('перенос', await b.evalIn(`JSON.stringify({
  на_сегодня_остался: !!document.querySelector('.list:not(.list--done) [data-id="a4"]'),
  всего: document.querySelectorAll('.task').length,
})`));

await longPress('[data-id="a3"]');
await b.evalIn(`document.querySelector('[data-act="delete"]').click()`);
await sleep(600);
await b.shot('удалено');
say('удаление', await b.evalIn(`JSON.stringify({
  дело_на_месте: !!document.querySelector('[data-id="a3"]'),
  полоска: document.querySelector('#undo').classList.contains('undo--on'),
  всего: document.querySelectorAll('.task').length,
})`));

await b.evalIn(`document.querySelector('[data-act="undo"]').click()`);
await sleep(600);
say('возврат', await b.evalIn(`JSON.stringify({
  дело_вернулось: !!document.querySelector('[data-id="a3"]'),
  полоска: document.querySelector('#undo').classList.contains('undo--on'),
  всего: document.querySelectorAll('.task').length,
})`));

// ---------- просроченные ----------

await b.evalIn(seedExpr(DEMO_LATE));
await b.navigate(b.url);
await sleep(1500);
await b.shot('просрочено');
say('просрочено', await b.evalIn(`JSON.stringify({
  раздел: document.querySelector('.section__name--late')?.textContent,
  в_разделе: document.querySelectorAll('.list--late .task').length,
  подписи: [...document.querySelectorAll('.list--late .task__time')].map((e) => e.textContent),
  шапка: document.querySelector('.hero__sub')?.textContent.trim(),
})`));

await longPress('.list--late [data-id="b1"]');
say('действия для старого', await b.evalIn(`JSON.stringify({
  перенос: document.querySelector('#move-label')?.textContent,
})`));

await b.evalIn(`document.querySelector('[data-act="move"]').click()`);
await sleep(700);
say('возврат на сегодня', await b.evalIn(`JSON.stringify({
  в_просроченных: document.querySelectorAll('.list--late .task').length,
  на_сегодня: !!document.querySelector('.list:not(.list--done) [data-id="b1"]'),
})`));

console.log(b.problems.length ? '\nПРОБЛЕМЫ:\n' + b.problems.join('\n') : '\nконсоль чистая');

await b.close();
process.exit(0);
