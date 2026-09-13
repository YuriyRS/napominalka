/* Проверка поведения: кликаем по галочке, закрываем день, ходим по вкладкам,
   открываем оба листа, следим за цветом статус-бара и ловим ошибки консоли.

   node tools/check.mjs

   Печатает по строке на проверку и «консоль чистая» в конце.
   Снимки спорных моментов — в tools/out/. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, seedExpr, DEMO_DAY, DEMO_LATE, DEMO_MONTH, DEMO_REPEAT, sleep } from './cdp.mjs';

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
say('календарь', await b.evalIn(`JSON.stringify({
  месяц: document.querySelector('.cal__title')?.textContent,
  клеток: document.querySelectorAll('.cal__cell').length,
  дней_недели: [...document.querySelectorAll('.cal__week span')].map((e) => e.textContent).join(''),
  первая_клетка: document.querySelector('.cal__cell .cal__num')?.textContent,
  сегодня: document.querySelector('.cal__cell--today .cal__num')?.textContent,
  // в этом наборе дела есть только у сегодняшнего дня, и их шесть
  сегодня_уровень: document.querySelector('.cal__cell--today .cal__dot')?.dataset.level,
  у_пустого_дня: [...document.querySelectorAll('.cal__cell')]
    .map((c) => c.querySelector('.cal__dot').dataset.level).filter((l) => l === '0').length,
})`));

// зона нажатия по дню: план требует не меньше 48 px
say('зона дня', await b.evalIn(`(() => {
  const r = document.querySelector('.cal__cell').getBoundingClientRect();
  return JSON.stringify({ ширина: Math.round(r.width), высота: Math.round(r.height) });
})()`));

// тап по сегодняшнему дню обязан дать ровно тот же экран, что вкладка
// «Сегодня»: линия «сейчас», раздел «Просрочено» и кнопка «Добавить»
await b.evalIn(`document.querySelector('.cal__cell--today').click()`);
await sleep(500);
await b.shot('день-из-календаря');
say('сегодня из календаря', await b.evalIn(`JSON.stringify({
  дата: document.querySelector('.hero__date')?.textContent,
  дел_в_ленте: document.querySelectorAll('.task').length,
  линия_сейчас: !!document.querySelector('.now'),
  кнопка_добавить: !!document.querySelector('.add-btn'),
})`));

// Чужой день: линии «сейчас» и «Просрочено» быть не должно, а кнопка
// «Добавить» должна быть — и приводить на этот же день, а не на сегодня.
await b.evalIn(`document.querySelector('[data-act="back"]').click()`);
await sleep(400);
const foreignMs = await b.evalIn(`(() => {
  const cell = [...document.querySelectorAll('.cal__cell')]
    .find((c) => !c.classList.contains('cal__cell--today')
              && !c.classList.contains('cal__cell--off'));
  cell.click();
  return cell.dataset.day;
})()`);
await sleep(500);
say('чужой день', await b.evalIn(`JSON.stringify({
  дата: document.querySelector('.hero__date')?.textContent,
  линия_сейчас: !!document.querySelector('.now'),
  кнопка_добавить: !!document.querySelector('.add-btn'),
})`));

// форма, открытая с чужого дня, обязана подставиться на него
await b.evalIn(`document.querySelector('[data-act="add"]').click()`);
await sleep(600);
const wantDate = (() => {
  const d = new Date(Number(foreignMs));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();
const gotDate = await b.evalIn(`document.querySelector('#f-date').value`);
say('дата в форме', JSON.stringify({ ждём: wantDate, в_поле: gotDate, совпало: wantDate === gotDate }));

// и записанное дело остаётся на этом дне
await b.evalIn(`document.querySelector('#f-title').value = 'Дело не на сегодня'`);
await b.evalIn(`document.querySelector('#f-time').value = '11:00'`);
await b.evalIn(`document.querySelector('#task-form [type="submit"]').click()`);
await sleep(800);
await b.shot('дело-на-чужой-день');
say('запись на чужой день', await b.evalIn(`JSON.stringify({
  остались_в_том_же_дне: document.querySelector('.hero__date')?.textContent,
  дело_на_месте: [...document.querySelectorAll('.task__title')]
    .some((e) => e.textContent === 'Дело не на сегодня'),
})`));

// и возврат обратно
await b.evalIn(`document.querySelector('[data-act="back"]').click()`);
await sleep(400);
say('возврат в календарь', await b.evalIn(`JSON.stringify({
  календарь_снова: !!document.querySelector('.cal__grid'),
  месяц: document.querySelector('.cal__title')?.textContent,
})`));

// Дело, записанное на чужой день, возвращаем поток к исходному набору:
// иначе оно тянется через все следующие проверки и сдвигает счётчики.
await b.evalIn(seedExpr(DEMO_DAY));
await b.navigate(b.url);
await sleep(1200);
await b.evalIn(`document.querySelector('[data-tab="month"]').click()`);
await sleep(400);

// листание месяца
await b.evalIn(`document.querySelector('[data-act="month-prev"]').click()`);
await sleep(400);
say('месяц назад', await b.evalIn(`document.querySelector('.cal__title')?.textContent`));
await b.evalIn(`document.querySelector('[data-act="month-next"]').click()`);
await sleep(400);
say('месяц вперёд', await b.evalIn(`document.querySelector('.cal__title')?.textContent`));

await b.evalIn(`document.querySelector('[data-tab="today"]').click()`);
await sleep(600);
say('возврат', await b.evalIn(`JSON.stringify({
  дата: document.querySelector('.hero__date')?.textContent,
  вкладка: document.querySelector('.nav__item--active')?.dataset.tab,
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
   приложение установимо, и приложение его ловит. Значит, проверяем обе
   стороны: и что с приглашением появляется кнопка, и что после отказа
   строка не начинает врать про неспособный браузер.

   Событие подсовываем своё, а не полагаемся на настоящее: настоящее
   одноразовое и уже потрачено приложением при загрузке, а нам нужно
   ещё и нажать кнопку. */
const rowState = () => b.evalIn(`JSON.stringify({
  строка: document.getElementById('install-row').hidden
    || getComputedStyle(document.getElementById('install-row')).display === 'none'
    ? 'скрыта' : 'видна',
  кнопка: document.getElementById('install-btn').hidden ? 'скрыта' : 'видна',
  подсказка: document.getElementById('install-hint').textContent.slice(0, 40),
})`);

await b.evalIn(`(() => {
  window.__prompted = 0;
  const e = new Event('beforeinstallprompt');
  e.prompt = () => { window.__prompted++; return Promise.resolve(); };
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
})()`);
await sleep(200);
say('установка: с приглашением', await rowState());

await b.shot('настройки');

await b.evalIn(`document.querySelector('[data-act="install"]').click()`);
await sleep(300);
say('установка: после нажатия', await rowState());
say('установка: prompt', JSON.stringify({ вызовов: await b.evalIn(`window.__prompted`) }));

await b.evalIn(`document.querySelector('[data-act="close"]').click()`);
await sleep(400);

await b.evalIn(`document.querySelector('[data-act="add"]').click()`);
await sleep(600);
await b.shot('лист-добавления');
say('лист добавления', await b.evalIn(`JSON.stringify({
  открыт: document.querySelector('#sheet').classList.contains('sheet--on'),
  // по умолчанию — сегодня и время на час вперёд, округлённое до пяти минут
  дата: document.querySelector('#f-date').value,
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

// ---------- браузер, который не умеет ставить приложения ----------

/* Такой, как Яндекс.Браузер на Android: сторонние PWA он не ставит и
   beforeinstallprompt не выдаёт. Chrome тут всегда событие выдаёт, поэтому
   подделываем среду: подсовываем свой слушатель раньше приложения и глушим
   событие. Приложение должно не спрятать строку, а объяснить, что делать. */
await b.S('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.addEventListener('beforeinstallprompt', (e) => e.stopImmediatePropagation());`,
});
await b.navigate(b.url);
await sleep(1500);
await b.evalIn(`document.querySelector('[data-act="settings"]').click()`);
await sleep(400);
say('установка: браузер не умеет', await rowState());
await b.shot('установка-не-умеет');
await b.evalIn(`document.querySelector('[data-act="close"]').click()`);
await sleep(300);

// ---------- плотность в календаре ----------

/* Проверять её на DEMO_DAY бессмысленно: там дела есть только у сегодня,
   и все точки либо пустые, либо максимальные. Нужен разброс по месяцу. */
await b.evalIn(seedExpr(DEMO_MONTH));
await b.navigate(b.url);
await sleep(1500);
await b.evalIn(`document.querySelector('[data-tab="month"]').click()`);
await sleep(600);
await b.shot('месяц');
say('плотность', await b.evalIn(`(() => {
  const dots = [...document.querySelectorAll('.cal__cell .cal__dot')];
  const по_уровням = {};
  for (const d of dots) {
    const l = d.dataset.level;
    по_уровням[l] = (по_уровням[l] || 0) + 1;
  }
  // цвет и размер должны расти вместе: на цвет полагаться нельзя
  const ширина = (l) => {
    const d = dots.find((x) => x.dataset.level === l);
    return d ? parseFloat(getComputedStyle(d).width) : null;
  };
  return JSON.stringify({
    по_уровням,
    ширина_1: ширина('1'),
    ширина_2: ширина('2'),
    ширина_3: ширина('3'),
    растёт: ширина('1') < ширина('2') && ширина('2') < ширина('3'),
  });
})()`));

// ---------- повторы ----------

/* Тоже в конце и на своём наборе: серия размножается на год вперёд,
   и все счётчики выше поехали бы. */

const seedRepeat = async () => {
  await b.evalIn(seedExpr(DEMO_REPEAT));
  await b.navigate(b.url);
  await sleep(1800);
};
const dayCell = (ms) => `document.querySelector('.cal__cell[data-day="${ms}"]')`;
const midnight = (plus) => { const d = new Date(); d.setDate(d.getDate() + plus); d.setHours(0, 0, 0, 0); return d.getTime(); };
const todayMs = midnight(0);
const tomorrowMs = midnight(1);
const repeatRowId = `[...document.querySelectorAll('.task')].find((r) => r.querySelector('.task__repeat'))?.dataset.id`;
const hasRow = (id) => `[...document.querySelectorAll('.task')].some((r) => r.dataset.id === ${JSON.stringify(String(id))})`;

await seedRepeat();
await b.shot('повтор');
say('повтор в ленте', await b.evalIn(`JSON.stringify({
  значков_повтора: document.querySelectorAll('.task__repeat').length,
  просрочено: document.querySelectorAll('.list--late .task').length,
})`));

// размножение: зарядка каждый день, значит в сетке месяца занят каждый день
await b.evalIn(`document.querySelector('[data-tab="month"]').click()`);
await sleep(500);
say('размножение', await b.evalIn(`(() => {
  const dots = [...document.querySelectorAll('.cal__cell .cal__dot')];
  return JSON.stringify({
    занятых_дней: dots.filter((d) => d.dataset.level !== '0').length,
    клеток: dots.length,
  });
})()`));

// удаляем ОДНО вхождение — сегодняшнее
await b.evalIn(`document.querySelector('[data-tab="today"]').click()`);
await sleep(500);
const oneId = await b.evalIn(repeatRowId);
await longPress(`[data-id="${oneId}"]`);
await b.evalIn(`document.querySelector('[data-act="delete"]').click()`);
await sleep(500);
await b.shot('вопрос-о-серии');
say('вопрос о серии', await b.evalIn(`JSON.stringify({
  лист: document.querySelector('#scope-sheet').classList.contains('sheet--on'),
  одна: document.querySelector('#scope-one-label').textContent,
  все: document.querySelector('#scope-all-label').textContent,
})`));

await b.evalIn(`document.querySelector('[data-act="scope-one"]').click()`);
await sleep(600);
say('удалён один день', await b.evalIn(`JSON.stringify({
  в_ленте: ${hasRow(oneId)},
  всего: document.querySelectorAll('.task').length,
  полоска_вернуть: document.querySelector('#undo').classList.contains('undo--on'),
})`));

/* Главная проверка: зарубка должна удержать место в расписании, иначе
   syncSeries при следующем запуске создаст удалённое заново. */
await b.navigate(b.url);
await sleep(1800);
say('после перезагрузки', await b.evalIn(`JSON.stringify({
  вернулось: [...document.querySelectorAll('.task')].some((r) => r.dataset.id === '${oneId}'),
  всего: document.querySelectorAll('.task').length,
})`));

// а теперь отменяем серию целиком от завтрашнего дня
await seedRepeat();
await b.evalIn(`document.querySelector('[data-tab="month"]').click()`);
await sleep(500);
await b.evalIn(`${dayCell(tomorrowMs)}.click()`);
await sleep(600);
const tomorrowId = await b.evalIn(repeatRowId);
await longPress(`[data-id="${tomorrowId}"]`);
await b.evalIn(`document.querySelector('[data-act="delete"]').click()`);
await sleep(500);
await b.evalIn(`document.querySelector('[data-act="scope-all"]').click()`);
await sleep(700);
say('серия отменена', await b.evalIn(`JSON.stringify({
  завтра_осталось: ${hasRow(tomorrowId)},
  всего_в_дне: document.querySelectorAll('.task').length,
})`));

await b.navigate(b.url);
await sleep(1800);
await b.evalIn(`document.querySelector('[data-tab="month"]').click()`);
await sleep(500);
say('после перезагрузки', await b.evalIn(`(() => {
  const dots = [...document.querySelectorAll('.cal__cell .cal__dot')];
  return JSON.stringify({
    занятых_дней: dots.filter((d) => d.dataset.level !== '0').length,
    сегодня_уровень: ${dayCell(todayMs)}?.querySelector('.cal__dot')?.dataset.level,
  });
})()`));

/* И то же самое глазами в завтрашнем дне: отменённая серия не должна
   ожить на следующем запуске. Раньше оживала — предел repeatEnd был
   включающим, и вхождение ровно в этот момент создавалось заново. */
await b.evalIn(`${dayCell(tomorrowMs)}.click()`);
await sleep(600);
say('завтра после отмены', await b.evalIn(`JSON.stringify({
  дел: document.querySelectorAll('.task').length,
  линия_сейчас: !!document.querySelector('.now'),
})`));

console.log(b.problems.length ? '\nПРОБЛЕМЫ:\n' + b.problems.join('\n') : '\nконсоль чистая');

await b.close();
process.exit(0);
