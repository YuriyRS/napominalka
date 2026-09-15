/* ============================================================
   Напоминалка — логика
   Этап 1: экран «Сегодня». Остальные вкладки — заглушки.
   ============================================================ */

import * as db from './db.js';

/* ---------- Иконки ---------- */

const ICON = {
  today:  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  month:  '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  year:   '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/>',
  subs:   '<rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M2.5 11h19M6 15.5h3"/>',
  plus:   '<path d="M12 5v14M5 12h14"/>',
  /* Галочка нарисована по центру квадрата 24×24.

     Было `M3 9l4.5 4.5L15 5` — фигура занимала x от 3 до 15, и её середина
     приходилась на 9 из 12: сдвиг влево почти на два пикселя. Этого довольно,
     чтобы глаз заподозрил неладное, но мало, чтобы понять, что именно.

     Теперь фигура занимает x от 6 до 18 — ровно по центру, — а по вертикали
     поднята на полшага: 7.25…15.75 вместо 7.75…16.25. Это не произвол, а
     общее место у наборов значков. У галочки вся масса внизу, у вершины,
     а вверх уходит тонкий длинный хвост; поставишь середину рамки на середину
     кружка — она читается низкой. Lucide, самый хоженый набор значков,
     сдвигает её вверх ровно так же. */
  check:  '<path d="M6 11.25l4.5 4.5L18 7.25"/>',
  spark:  '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8"/>',
  gear:   '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H2.8a2 2 0 1 1 0-4H3a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.2V4a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"/>',
  chevL:  '<path d="M14.5 6.5L9 12l5.5 5.5"/>',
  chevR:  '<path d="M9.5 6.5L15 12l-5.5 5.5"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
};

const svg = (d, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

/* ---------- Утилиты ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (ts) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/** Дата для <input type="date"> — местная, не UTC.

    Через toISOString() здесь нельзя: он переводит в UTC, и в Москве после
    трёх часов ночи вчерашний вечер уехал бы на день вперёд. Ошибка тихая —
    дело просто оказывается не в том дне, и ищут её потом неделю. */
const dateValue = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** «вчера, 15:00», «10 сент., 15:00» — для дел, которые остались с прошлых дней. */
function whenLabel(ts) {
  const days = Math.round((startOfToday() - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 1) return `вчера, ${hhmm(ts)}`;
  const d = new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return `${d}, ${hhmm(ts)}`;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

const deeds = (n) => `${n} ${plural(n, 'дело', 'дела', 'дел')}`;

/* Зарубка — это не дело, а место удалённого вхождения серии. Она остаётся
   в расписании и занимает своё место, чтобы досоздание не вернуло удалённое
   обратно, но показывать её негде. */
const shown = (t) => !t.skipped;

/* ---------- Состояние ---------- */

const state = {
  tab: 'today',
  tasks: [],
  theme: localStorage.getItem('theme') || 'auto',
  accent: localStorage.getItem('accent') || 'violet',
  editing: null,     // id дела, которое сейчас правят в форме
  sheetTask: null,   // id дела, для которого открыт лист действий
  removed: null,     // удалённое дело — живёт, пока видна полоска «Вернуть»
  flash: null,       // id строки, которую нужно подсветить один кадр
  installEvent: null, // отложенное приглашение установки от Chrome, см. ниже
  installOffered: false, // браузер вообще предлагал установку — см. syncInstallRow
  monthCursor: null,  // первое число показываемого месяца, см. renderMonth
  monthDay: null,     // полночь выбранного дня, null — показываем календарь
  yearCursor: null,   // номер показываемого года, см. renderYear
  currency: localStorage.getItem('currency') || 'rub',  // для сумм в подписках
  subs: [],           // подписки, см. renderSubs
  sheetSub: null,     // id подписки, для которой открыт лист действий
  editingSub: null,   // id подписки, которую правят в форме
  subColor: 'violet', // выбранный значок в форме подписки
};

/* ---------- Оформление ---------- */

const ACCENTS = ['violet', 'blue', 'teal', 'emerald'];

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function applyAppearance() {
  const el = document.documentElement;
  if (state.theme === 'auto') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', state.theme);
  if (state.accent === 'violet') el.removeAttribute('data-accent');
  else el.setAttribute('data-accent', state.accent);

  // статус-бар телефона должен совпадать с фоном приложения,
  // в том числе когда тему выбрали руками вопреки системе
  const dark = state.theme === 'dark' || (state.theme === 'auto' && darkQuery.matches);
  document.getElementById('theme-color')
    .setAttribute('content', dark ? '#08070C' : '#F4F2EE');
}

// система сменила тему, а мы в режиме «как в телефоне» — догоняем
darkQuery.addEventListener('change', () => { if (state.theme === 'auto') applyAppearance(); });

/* ---------- Отрисовка ---------- */

const root  = document.getElementById('screen');
const navEl = document.getElementById('nav');
const addBar = document.getElementById('add-bar');

/** Кнопка «Добавить» наполняется снаружи экрана — почему, написано
    в index.html рядом с ней самой. Здесь важно одно: экраны без кнопки
    обязаны её убрать, иначе на «Месяце» осталась бы кнопка от «Сегодня». */
function setAddButton(html) {
  addBar.innerHTML = html || '';
  addBar.hidden = !html;
}

/* Появление проигрывается только при входе на экран.
   Иначе любое обновление — отметка дела, смена минуты — заставляет
   карточки всплывать заново, и экран мигает. */
let fresh = true;

function render() {
  const f = fresh ? ' is-fresh' : '';
  fresh = false;
  setAddButton('');            // кнопку ставит тот экран, которому она нужна
  if (state.tab === 'today') {
    renderDay(f, startOfToday(), { withNow: true, withOverdue: true, withAdd: true });
  }
  if (state.tab === 'month') {
    if (state.monthDay) {
      // Сегодняшний день выглядит одинаково, откуда бы на него ни смотрели:
      // тап по «13» в календаре даёт ровно тот же экран, что вкладка
      // «Сегодня», только с возвратом. Иначе один и тот же день описывался
      // бы по-разному — «1 дело» здесь и «осталось 1 дело» там.
      //
      // «Добавить» есть у любого дня: форма спрашивает дату, и дело уходит
      // именно туда, откуда его записали, а не на сегодня.
      const today = state.monthDay === startOfToday();
      renderDay(f, state.monthDay, {
        back: true, withNow: today, withOverdue: today, withAdd: true,
      });
    } else {
      renderMonth(f);
    }
  }
  if (state.tab === 'year')  renderYear(f);
  if (state.tab === 'subs')  renderSubs(f);
  renderNav();
}

function renderNav() {
  const items = [
    ['today', 'Сегодня',  ICON.today],
    ['month', 'Месяц',    ICON.month],
    ['year',  'Год',      ICON.year],
    ['subs',  'Подписки', ICON.subs],
  ];
  navEl.innerHTML = items.map(([key, label, icon]) => `
    <button class="nav__item ${state.tab === key ? 'nav__item--active' : ''}"
            data-tab="${key}" aria-label="${esc(label)}"
            ${state.tab === key ? 'aria-current="page"' : ''}>
      ${svg(icon)}<span>${esc(label)}</span>
    </button>`).join('');
}

const TITLES = { month: 'Месяц', year: 'Год', subs: 'Подписки' };

const gear = `<button class="icon-btn" data-act="settings" aria-label="Настройки">${svg(ICON.gear)}</button>`;

/* На «Сегодня» имя экрана — мелкая надстрочная строка, а не заголовок:
   крупным шрифтом здесь пишется дата, иначе две доминанты спорят за глаз.
   По той же причине на экране выбранного дня в шапке стоит «Месяц»,
   а не дата: дата уже написана крупно в шапке дня. */
const topBar = (opts = {}) => (opts.back
  ? `<div class="top top--slim">
       <button class="icon-btn" data-act="back" aria-label="К календарю">${svg(ICON.chevL)}</button>
       <span class="top__eyebrow">Месяц</span>${gear}
     </div>`
  // У «Сегодня» ключа в TITLES нет намеренно — имя экрана там пишется
  // прямо здесь. «Месяц» идёт той же дорогой: крупным шрифтом на нём
  // пишется «сентябрь 2026», и второй заголовок того же веса спорил бы
  // с ним за глаз — ровно то, от чего ушли на «Сегодня».
  : state.tab === 'today'
    ? `<div class="top top--slim"><span class="top__eyebrow">Сегодня</span>${gear}</div>`
    // «Месяц» и «Год» идут одной дорогой: крупным шрифтом на них пишется
    // «сентябрь 2026» и «2026», и второй заголовок того же веса спорил бы
    // с ним за глаз — ровно то, от чего ушли на «Сегодня»
    : state.tab === 'month' || state.tab === 'year' || state.tab === 'subs'
      ? `<div class="top top--slim"><span class="top__eyebrow">${esc(TITLES[state.tab])}</span>${gear}</div>`
      : `<div class="top"><h1 class="top__title">${esc(TITLES[state.tab] || '')}</h1>${gear}</div>`);

/* ---------- Шкала дня ----------
   Дела стоят на своих часах, а не ровными строками: тогда у дня видно
   форму — где густо, а где окно.

   Разрыв сжимается по логарифму. Линейная шкала даёт только крайности:
   либо получасовые паузы неразличимы, либо перерыв с утра до вечера
   занимает три экрана. Логарифм сохраняет порядок («три часа больше,
   чем час») и при этом держит день в пределах разумной длины. */

const GAP_MIN = 10;
const GAP_K = 34;

const gapPx = (ms) => Math.round(GAP_MIN + GAP_K * Math.log2(1 + ms / 3_600_000));

/* Подпись честная. Раньше здесь стояло округление до целых часов: пауза
   в 2 ч 30 мин писалась как «3 ч», а всё, что короче 2,5 часов, не
   подписывалось вовсе — на экране оставалось пустое место без объяснения.
   Минуты показываем, только когда они есть: «3 ч» читается легче,
   чем «3 ч 0 мин». */
const gapLabel = (ms) => {
  const min = Math.round(ms / 60_000);
  if (min < 60) return '';
  const h = Math.floor(min / 60);
  const rest = min % 60;
  // минуты двумя разрядами: цифры табличные, и «2 ч 02 мин» стоит ровнее,
  // чем «2 ч 2 мин»
  return rest ? `${h} ч ${pad2(rest)} мин` : `${h} ч`;
};

/* Строка дела. Вынесена из рендера дня на уровень модуля: её показывают
   и «Сегодня», и раздел «Просрочено», и день, открытый из календаря.

   late — дело с прошлого дня: вместо часов пишем «вчера, 15:00», иначе
   непонятно, откуда оно взялось. */
function taskRow(t, { flashId = null, extra = '', late = false } = {}) {
  return `
    <li class="task ${t.done ? 'task--done' : ''} ${t.id === flashId ? 'task--flash' : ''} ${extra}" data-id="${esc(t.id)}">
      <button class="task__check" data-act="toggle" aria-pressed="${t.done}"
              aria-label="${t.done ? 'Отменить' : 'Отметить'} «${esc(t.title)}»">
        ${svg(ICON.check)}
      </button>
      <div class="task__body">
        <div class="task__time">${late ? esc(whenLabel(t.at)) : hhmm(t.at)}${isRepeat(t)
          ? `<svg class="task__repeat" viewBox="0 0 24 24" aria-hidden="true">${ICON.repeat}</svg>`
            + '<span class="visually-hidden">, повторяется</span>' : ''}</div>
        <div class="task__title">${esc(t.title)}</div>
        ${t.voice ? playerHtml(t.voice)
          : t.note ? `<div class="task__note">${esc(t.note)}</div>` : ''}
      </div>
    </li>`;
}

/* Лента дел.

   Обычная — с воздухом по фактическому разрыву между делами и, если
   передан `now`, с линией «сейчас» на её месте среди дел.

   flat — без разрывов и без линии: так идут «Сделано» и «Просрочено»,
   там дела стоят подряд, и воздух между ними ничего не значил бы. */
function timeline(tasks, { now = null, nextId = null, flashId = null, flat = false, late = false } = {}) {
  if (flat) return `<ul class="timeline timeline--flat">${
    tasks.map((t) => taskRow(t, { flashId, late })).join('')}</ul>`;

  let items = '';
  let prevAt = null;
  const push = (at, html) => {
    if (prevAt !== null) {
      const d = at - prevAt;
      const label = gapLabel(d);
      items += `<li class="gap" style="--h:${gapPx(d)}px" aria-hidden="true">${
        label ? `<span>${label}</span>` : ''}</li>`;
    }
    items += html;
    prevAt = at;
  };

  let placed = !now;
  for (const t of tasks) {
    if (!placed && t.at >= now.getTime()) { push(now.getTime(), nowLine(now)); placed = true; }
    push(t.at, taskRow(t, { flashId, extra: t.id === nextId ? 'task--next' : '' }));
  }
  if (tasks.length && !placed) push(now.getTime(), nowLine(now));

  return `<ul class="timeline">${items}</ul>`;
}

/* Один и тот же рендер на два экрана: «Сегодня» и день, выбранный
   в календаре. Отличия собраны во флагах, а не размножены копией.

   withNow     — линия «сейчас» на своём месте среди дел;
   withOverdue — раздел «Просрочено». Он бывает только у сегодняшнего дня:
                 незакрытое с прошлых дней относится к сегодня, а не к
                 произвольной дате, и показывать его на 10 сентября незачем;
   withAdd     — кнопка «Добавить». Она несёт с собой дату открытого дня,
                 и форма подставляется на неё, а не на сегодня;
   back        — шапка со стрелкой возврата к календарю. */
function renderDay(f, dayMs, {
  withNow = false, withOverdue = false, withAdd = false, back = false,
} = {}) {
  const now = new Date();
  const startOfDay = new Date(dayMs); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate() + 1);

  const dayTasks = state.tasks
    .filter((t) => shown(t) && t.at >= startOfDay.getTime() && t.at < endOfDay.getTime())
    .sort((a, b) => a.at - b.at);

  const active = dayTasks.filter((t) => !t.done);
  const done   = dayTasks.filter((t) => t.done);
  const nextId = withNow ? (active.find((t) => t.at >= now.getTime())?.id ?? null) : null;
  const closed = dayTasks.length > 0 && active.length === 0;

  // Незакрытое с прошлых дней. Раньше оно не показывалось нигде: человек
  // записал дело, не сделал, и оно молча исчезало — для напоминалки это
  // худшее, что может случиться.
  //
  // Повторы сюда не попадают намеренно. Не сделал вчерашнюю зарядку — сегодня
  // её тут нет: следующий раз всё равно наступит, а вечный долг — ровно то,
  // от чего в этом приложении уходили.
  const overdue = withOverdue
    ? state.tasks
        .filter((t) => shown(t) && !t.done && !t.seriesId && t.at < startOfDay.getTime())
        .sort((a, b) => a.at - b.at)
    : [];

  // флаг «только что отмечено» живёт ровно один кадр — он подсвечивает
  // строку, чтобы глаз проследил, куда она уехала
  const flashId = state.flash;
  state.flash = null;

  const date = new Date(startOfDay);
  const weekday = date.toLocaleDateString('ru-RU', { weekday: 'long' });
  const dateNum = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

  // «осталось» и «отдыхайте» — слова сегодняшнего дня. Про 10 сентября
  // так не скажешь, поэтому у чужого дня подпись просто называет число дел.
  const subText = dayTasks.length === 0
    ? (overdue.length ? 'на сегодня ничего' : 'свободный день')
    : closed
      ? (withNow ? 'всё сделано — отдыхайте' : 'всё сделано')
      : (withNow ? `осталось ${deeds(active.length)}` : deeds(active.length));

  const dayBlock = active.length ? `
    <div class="section"><h2 class="section__name">День</h2></div>
    <div class="list${f}">${timeline(active, { now: withNow ? now : null, nextId, flashId })}</div>` : '';

  const doneBlock = done.length ? `
    <div class="section">
      <h2 class="section__name">Сделано</h2>
      <span class="section__meta">${done.length}</span>
    </div>
    <div class="list list--done${f}">${timeline(done, { flashId, flat: true })}</div>` : '';

  const overdueBlock = overdue.length ? `
    <div class="section">
      <h2 class="section__name section__name--late">Просрочено</h2>
      <span class="section__meta">${overdue.length}</span>
    </div>
    <div class="list list--late${f}">${timeline(overdue, { flashId, flat: true, late: true })}</div>` : '';

  const body = (dayTasks.length || overdue.length)
    ? overdueBlock + dayBlock + doneBlock
    : emptyState(f);
  const pct = dayTasks.length ? Math.round((done.length / dayTasks.length) * 100) : 0;

  root.innerHTML = `
    ${topBar({ back })}
    <section class="hero${closed ? ' hero--closed' : ''}${f}">
      <h2 class="hero__date">${esc(dateNum)}</h2>
      <p class="hero__sub${closed ? ' hero__sub--done' : ''}">
        ${closed ? svg(ICON.check) : ''}${esc(weekday)} · ${esc(subText)}
      </p>
      ${dayTasks.length ? `<div class="hero__bar"><i style="width:${pct}%"></i></div>` : ''}
    </section>
    ${body}`;

  setAddButton(withAdd
    ? `<button class="add-btn" data-act="add" data-day="${startOfDay.getTime()}"
              aria-label="Добавить дело">${svg(ICON.plus)}</button>`
    : '');
}

function nowLine(now) {
  return `<li class="now" aria-hidden="true"><span class="now__label">${hhmm(now.getTime())}</span></li>`;
}

function emptyState(f) {
  return `
    <div class="empty${f}">
      <div class="empty__mark">${svg(ICON.spark)}</div>
      <h2 class="empty__title">Ничего не запланировано</h2>
      <p class="empty__text">Хороший день, чтобы просто выдохнуть. Или запишите что-нибудь, пока не забылось.</p>
    </div>`;
}

/* ---------- Календарь месяца ----------

   Смысл экрана — не данные, а спокойствие: видно, где день густой, а где
   пустой, и что ничего не забыто.

   Плотность показывается цветом И размером точки. На цвет полагаться
   нельзя — его различают не все, — поэтому уровни отличаются ещё и на
   глаз: точка растёт 5 → 6.5 → 8 px. Число дел при этом лежит в подписи
   клетки, её читает экранный диктор.

   Сетка всегда шесть строк. В одном месяце пять недель, в другом шесть,
   и при перелистывании экран прыгал бы по высоте. */

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const densityLevel = (n) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : 3);

/** Сколько дел в каждом дне — одним проходом по уже загруженному списку,
    а не сорока двумя запросами к базе. Общее для «Месяца» и «Года»: оба
    показывают одну и ту же плотность, и разойтись они не должны. */
function dayCounts() {
  const counts = new Map();
  for (const t of state.tasks) {
    if (!shown(t)) continue;
    const d = new Date(t.at); d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function renderMonth(f) {
  if (state.monthCursor === null) state.monthCursor = firstOfMonth(new Date());

  const cursor = new Date(state.monthCursor);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // неделя с понедельника: getDay() считает от воскресенья
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;

  const counts = dayCounts();

  const todayMs = startOfToday();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - lead + i);
    d.setHours(0, 0, 0, 0);
    const ms = d.getTime();
    const n = counts.get(ms) || 0;
    const cls = ['cal__cell',
      d.getMonth() !== month ? 'cal__cell--off' : '',
      ms === todayMs ? 'cal__cell--today' : ''].filter(Boolean).join(' ');
    const label = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      + (n ? `, ${deeds(n)}` : ', дел нет');
    cells += `<button class="${cls}" data-act="day" data-day="${ms}" aria-label="${esc(label)}">
      <span class="cal__num">${d.getDate()}</span>
      <span class="cal__dot" data-level="${densityLevel(n)}"></span>
    </button>`;
  }

  root.innerHTML = `
    ${topBar()}
    <div class="cal${f}">
      <div class="cal__head">
        <button class="icon-btn" data-act="month-prev" aria-label="Предыдущий месяц">${svg(ICON.chevL)}</button>
        <h2 class="cal__title">${esc(cursor.toLocaleDateString('ru-RU', { month: 'long' }))} ${year}</h2>
        <button class="icon-btn" data-act="month-next" aria-label="Следующий месяц">${svg(ICON.chevR)}</button>
      </div>
      <div class="cal__week" aria-hidden="true">${
        WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal__grid">${cells}</div>
    </div>`;
}

/** Полночь первого числа того месяца, в который попадает дата. */
function firstOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/* ---------- Год ----------

   Двенадцать строк, в каждой — все дни месяца подряд, по столбику на день.
   Смысл экрана — не данные, а спокойствие: видно, где густо, а где пусто,
   и что ничего не забыто.

   Дни идут в тридцать один столбец всегда, даже в феврале. Пятнадцатое
   число обязано стоять в одном и том же столбце во всех двенадцати
   строках: ради сравнения строк глазом экран и существует, а сравнить их
   можно, только если столбцы совпадают. Места, которых в месяце нет,
   остаются пустыми.

   **Столбик, а не кружок.** На «Месяце» плотность показывает кружок, и там
   он помещается в клетку шириной 52 px. Здесь на день приходится около
   девяти — и кружок 5 px против кружка 4 px не различают даже рядом, не то
   что через экран. Высота читается там, где размер уже не читается, поэтому
   метка вытянута вверх. Цвет при этом остаётся вторым признаком, как и
   требует §5: на цвет одного полагаться нельзя.

   Строка целиком — кнопка: тап открывает этот месяц в «Месяце». Дни
   по отдельности не нажимаются намеренно: клетка шириной около девяти
   пикселей всё равно меньше любой разумной зоны нажатия, а рассмотреть
   день можно в самом «Месяце». Высота строки при этом не меньше 48 px —
   требование плана к зоне нажатия выполняется строкой, а не клеткой. */

function renderYear(f) {
  if (state.yearCursor === null) state.yearCursor = new Date().getFullYear();

  const year = state.yearCursor;
  const counts = dayCounts();
  const todayMs = startOfToday();

  let rows = '';
  for (let m = 0; m < 12; m++) {
    const inMonth = new Date(year, m + 1, 0).getDate();
    const name = new Date(year, m, 1).toLocaleDateString('ru-RU', { month: 'long' });

    let total = 0;
    let days = '';
    for (let d = 1; d <= 31; d++) {
      // тридцать первое февраля не рисуем, но и столбец не занимаем
      if (d > inMonth) { days += '<span class="year__day"></span>'; continue; }

      const ms = new Date(year, m, d).getTime();
      const n = counts.get(ms) || 0;
      total += n;
      const cls = ms === todayMs ? 'year__day year__day--today' : 'year__day';
      days += `<span class="${cls}"><span class="year__mark" data-level="${densityLevel(n)}"></span></span>`;
    }

    rows += `<button class="year__row" data-act="year-month"
      data-month="${new Date(year, m, 1).getTime()}"
      aria-label="${esc(`${name} ${year}, ${total ? deeds(total) : 'дел нет'}`)}">
      <span class="year__name">${esc(name)}</span>
      <span class="year__days" aria-hidden="true">${days}</span>
    </button>`;
  }

  // Подсказка к кружкам. В «Месяце» её нет и не надо: там рядом с кружком
  // стоит число и всё понятно без слов. Здесь чисел нет, и уровень плотности
  // иначе пришлось бы угадывать.
  const key = [['0', 'нет'], ['1', '1–2'], ['2', '3–5'], ['3', '6 и больше']]
    .map(([lvl, text]) => `<span class="year__key"><i class="year__mark" data-level="${lvl}"></i>${text}</span>`)
    .join('');

  root.innerHTML = `
    ${topBar()}
    <div class="year${f}">
      <div class="cal__head">
        <button class="icon-btn" data-act="year-prev" aria-label="Предыдущий год">${svg(ICON.chevL)}</button>
        <h2 class="cal__title">${year}</h2>
        <button class="icon-btn" data-act="year-next" aria-label="Следующий год">${svg(ICON.chevR)}</button>
      </div>
      <div class="year__card">${rows}</div>
      <div class="year__legend" aria-hidden="true">${key}</div>
    </div>`;
}

/* ---------- Голосовая заметка ----------

   Заметка к делу: текстом или голосом. Голос — вместо заметки, а не вместо
   дела: у дела остаётся время, оно видно в ленте и календаре, и о нём
   придёт напоминание. Дело без названия, которое можно только послушать,
   не попало бы ни в сводку, ни в поиск, ни в напоминание.

   Звук лежит в отдельной таблице базы, дело хранит только ссылку и
   **описание волны**, снятое при записи. Описание — это те же столбики,
   что видны на экране, и лежит оно в деле намеренно: волну видно сразу,
   без доставания звука из базы и без его разбора. Шестьдесят четыре
   числа против секунд декодирования на каждый показ ленты.

   Размер ограничен двумя минутами. Не ради экономии места, а ради копии:
   звук уезжает в файл копии в base64, а это треть сверху. */

const VOICE_LIMIT_MS = 120_000;

/* Сорок столбиков, а не шестьдесят четыре. На ширине ленты в сто шестнадцать
   пикселей шестьдесят четыре столбика дают одних только промежутков больше,
   чем есть места, и волна превращается в серую пыль. Сорок читаются. */
const WAVE_BARS = 40;

const clock = (ms) => `${Math.floor(ms / 60000)}:${pad2(Math.round(ms / 1000) % 60)}`;

const canRecord = () => typeof MediaRecorder !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(window.AudioContext);

/** Столбики волны. Минимум 12% высоты, иначе тихие места выглядели бы
    дырами, а не тишиной. */
const waveBars = (wave) => (wave || [])
  .map((v) => `<i style="height:${Math.max(12, Math.round(v * 100))}%"></i>`).join('');

/** Проигрыватель — один и тот же в форме и в ленте. Разметка общая
    намеренно: это одно и то же действие, и выглядеть оно должно одинаково. */
const playerHtml = (voice) => `
  <span class="player" data-voice-box>
    <button class="note__play" type="button" data-act="play" data-voice="${esc(voice.id)}"
            aria-label="Прослушать заметку">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path class="note__play-i" d="M8.5 5.2v13.6L19 12z"/>
        <path class="note__play-i note__pause-i" d="M8.5 5.2h3.2v13.6H8.5zM13.3 5.2h3.2v13.6h-3.2z"/>
      </svg>
    </button>
    <span class="wave">${waveBars(voice.wave)}</span>
    <span class="note__clock">${clock(voice.ms)}</span>
  </span>`;

/* ---------- Воспроизведение ----------

   Играет всегда не больше одной записи. Звук достаётся из базы в момент
   нажатия: держать в памяти все записи дня незачем. */

let playing = null;

function stopPlaying() {
  if (!playing) return;
  playing.audio.pause();
  URL.revokeObjectURL(playing.url);
  playing.box?.removeAttribute('data-playing');
  paintWave(playing.box, 0);
  playing = null;
}

async function playVoice(id, box) {
  if (!id) return;
  if (playing?.id === id) { stopPlaying(); return; }
  stopPlaying();

  const blob = await db.getVoice(id);
  if (!blob) return;   // запись потерялась — молчим, но и не врём пустотой на месте кнопки

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  playing = { id, audio, url, box };

  audio.addEventListener('timeupdate', () => {
    if (playing?.audio !== audio || !audio.duration) return;
    paintWave(box, audio.currentTime / audio.duration);
  });
  audio.addEventListener('ended', () => { if (playing?.audio === audio) stopPlaying(); });

  box?.setAttribute('data-playing', '');
  try { await audio.play(); } catch { stopPlaying(); }
}

/** Закрашивает столбики до доли проигранного. */
function paintWave(box, progress) {
  const bars = box?.querySelectorAll('.wave i');
  if (!bars || !bars.length) return;
  const upto = Math.round(bars.length * progress);
  bars.forEach((b, i) => b.classList.toggle('is-on', i < upto));
}

/* ---------- Запись ----------

   MediaRecorder плюс анализатор. Анализатор здесь не для красоты: он снимает
   громкость по ходу записи, из неё получается описание волны, и оно уезжает
   в дело вместе со звуком. */

let rec = null;

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);

  const session = { recorder, stream, ctx, analyser, buf, chunks: [], wave: [], startedAt: Date.now(), tick: null };
  rec = session;

  /* Кусок складывается в session, а не в rec. К моменту остановки rec уже
     обнулён — и последний кусок, а в короткой записи и единственный,
     пропал бы: `rec?.chunks` не сработал бы, ошибки бы не было, а запись
     вышла бы пустой. */
  recorder.ondataavailable = (e) => { if (e.data.size) session.chunks.push(e.data); };
  recorder.start();

  rec.tick = setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
    rec.wave.push(Math.sqrt(sum / buf.length));

    const ms = Date.now() - rec.startedAt;
    noteClock.textContent = clock(ms);
    noteWaveLive.innerHTML = waveBars(shrinkWave(rec.wave));
    if (ms >= VOICE_LIMIT_MS) stopRecording();
  }, 50);
}

/** Останавливает запись и отдаёт готовое: { blob, ms, wave, type }.
    null — если записи не было. */
function stopRecording() {
  return new Promise((resolve) => {
    const r = rec;
    if (!r) { resolve(null); return; }
    rec = null;
    clearInterval(r.tick);

    r.recorder.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      r.ctx.close();
      resolve({
        blob: new Blob(r.chunks, { type: r.recorder.mimeType || 'audio/webm' }),
        type: r.recorder.mimeType || 'audio/webm',
        ms: Math.min(Date.now() - r.startedAt, VOICE_LIMIT_MS),
        wave: shrinkWave(r.wave),
      });
    };
    r.recorder.stop();
  });
}

/** Сжимает снятую громкость до WAVE_BARS столбиков и растягивает по самому
    громкому месту: без растяжки тихая запись вышла бы ровной пустой полосой,
    а тихая она не потому, что в ней ничего не сказано. */
function shrinkWave(wave) {
  if (!wave.length) return new Array(WAVE_BARS).fill(0.25);
  const out = [];
  const step = wave.length / WAVE_BARS;
  for (let i = 0; i < WAVE_BARS; i++) {
    let peak = 0;
    for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) peak = Math.max(peak, wave[j] || 0);
    out.push(peak);
  }
  const max = Math.max(...out, 0.0001);
  return out.map((v) => Math.min(1, v / max));
}

/* ---------- Заметка в форме ---------- */

const noteBox = document.getElementById('f-note-box');
const noteClock = document.getElementById('note-clock');
const noteWaveLive = document.getElementById('note-wave-live');
const noteWaveDone = document.getElementById('note-wave-done');
const noteLen = document.getElementById('note-len');
const notePlay = document.getElementById('note-play');
const noteRec = document.getElementById('note-rec');
const noteText = document.getElementById('f-note');

/* Запись, привязанная к открытой форме. У новой — blob в памяти, у той,
   что уже лежит в базе, blob не тянется: не тронули — не переписываем. */
let formVoice = null;

function setNoteState(state) {
  noteBox.dataset.state = state;
}

/** Показать записи в форме: и ту, что только что сделана, и ту, что была. */
function showVoice(voice) {
  formVoice = voice;
  setNoteState('done');
  noteWaveDone.innerHTML = waveBars(voice.wave);
  noteLen.textContent = clock(voice.ms);
  notePlay.dataset.voice = voice.id;
  if (voice.blob) writeVoice(voice);   // свежую кладём сразу, чтобы не держать в памяти
}

/** Кладёт звук в базу. Отдельно от сохранения дела намеренно: запись может
    остаться без дела, если форму закрыли, — такая запись сметётся при
    следующем запуске (db.sweepVoice). */
async function writeVoice(voice) {
  if (!voice.blob) return;
  try { await db.putVoice(voice.id, voice.blob); } catch { /* места нет — дело сохранится без звука */ }
}

function clearVoice() {
  formVoice = null;
  noteWaveDone.innerHTML = '';
  delete notePlay.dataset.voice;
  setNoteState('empty');
}

/* Кнопки записи привязаны к форме, а не к общему разбору нажатий: жить
   вне формы им негде, и переезжать они никуда не собираются. */

/* Что было записано до «Перезаписать». Если новую запись отменят, старая
   должна вернуться: правка существующего дела иначе сохранилась бы без
   голоса — а он у человека был. */
let redoBackup = null;

function syncNoteRow() {
  // Кнопка записи есть, только если браузер это умеет. Обещать и не
  // сделать хуже, чем не показывать вовсе.
  noteRec.hidden = !canRecord();
}

noteRec.addEventListener('click', async () => {
  if (!canRecord()) return;
  try {
    noteWaveLive.innerHTML = '';
    noteClock.textContent = '0:00';
    setNoteState('live');
    await startRecording();
  } catch {
    // В доступе к микрофону отказано (или его нет) — возвращаем форму как
    // была и говорим об этом в подсказке поля, а не всплывающим окном.
    noteText.placeholder = 'Микрофон недоступен — запишите текстом';
    if (redoBackup) { showVoice(redoBackup); redoBackup = null; }
    else clearVoice();
  }
});

document.getElementById('note-stop').addEventListener('click', async () => {
  const made = await stopRecording();
  redoBackup = null;
  if (!made || !made.blob.size) { clearVoice(); return; }
  showVoice({ id: db.newId(), ...made });
});

document.getElementById('note-cancel').addEventListener('click', async () => {
  await stopRecording();          // запись выбрасывается целиком
  if (redoBackup) { showVoice(redoBackup); redoBackup = null; }
  else clearVoice();
});

document.getElementById('note-redo').addEventListener('click', () => {
  redoBackup = formVoice;
  noteRec.click();
});

document.getElementById('note-drop').addEventListener('click', () => {
  redoBackup = null;
  clearVoice();
});

notePlay.addEventListener('click', () => {
  playVoice(notePlay.dataset.voice, notePlay.closest('.player'));
});

/* ---------- Подписки ----------

   Смысл экрана — две беды, а не одна. Первая: забыл оплатить, и подписка
   отвалилась. Вторая, и она дороже: платишь за то, чем не пользуешься, —
   полгода списывают деньги за сервис, открытый один раз.

   Поэтому у подписки две судьбы, а не одна: «оплачено» и «отменил».
   Отменённая не исчезает, а уходит вниз отдельным списком: через год это
   единственное место, где видно, сколько было и на чём сэкономил.

   Значок — буква в цветном кружке, не логотип сервиса. Чужие логотипы это
   товарные знаки, и магазины приложений требуют подтвердить права на всё
   содержимое; буква снимает вопрос целиком, работает для сервиса, о котором
   мы никогда не слышали, и не тянет ни одного запроса в сеть. */

const SOON_DAYS = 3;

/* Те же восемь, что в разметке формы: цвет значка хранится строкой, и разойтись
   списки не должны — иначе у подписки окажется цвет, которого нет. */
const SUB_COLORS = ['violet', 'blue', 'sky', 'teal', 'green', 'amber', 'orange', 'rose'];

/* Валюты. Ничего не пересчитывается: приложение не знает курсов и знать
   не хочет — иначе ему пришлось бы за ними ходить в сеть, а оно не ходит.
   Меняется значок и его место, а не число.

   У доллара значок стоит перед числом, у рубля и тенге — после: так принято
   писать, и «799 $» читается как ошибка, даже когда это не она. */
const CURRENCIES = {
  rub: { sign: '₽', name: 'рубль' },
  kzt: { sign: '₸', name: 'тенге' },
  usd: { sign: '$', name: 'доллар', before: true },
};

/** Копейки → «799 ₽». Копейки показываем, только если они есть. */
function money(cents) {
  const cur = CURRENCIES[state.currency] || CURRENCIES.rub;
  const rub = Math.floor(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  const n = rest
    ? `${rub.toLocaleString('ru-RU')},${pad2(rest)}`
    : rub.toLocaleString('ru-RU');
  return cur.before ? `${cur.sign}${n}` : `${n} ${cur.sign}`;
}

/** «799», «799,50», «1 299» → копейки. null — если это не число. */
function parseMoney(text) {
  const n = Number(String(text).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

const inMonth = (s) => (s.period === 'year' ? Math.round(s.amount / 12) : s.amount);
const inYear  = (s) => (s.period === 'year' ? s.amount : s.amount * 12);

const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

/** Следующее списание: тот же день следующего месяца или года.

    День берётся из sub.day, а не из прошлой даты. Иначе 31-е съезжало бы:
    в феврале списание 28-го, и следующее вышло бы 28 марта вместо 31-го.
    Ровно та же ловушка, что у месячного повтора (§4.7), и решается так же. */
function nextCharge(sub, from = sub.nextAt) {
  const d = new Date(from);
  const base = new Date(d.getFullYear(), d.getMonth() + (sub.period === 'year' ? 12 : 1), 1);
  const day = Math.min(sub.day || d.getDate(), daysIn(base.getFullYear(), base.getMonth()));
  return new Date(base.getFullYear(), base.getMonth(), day).getTime();
}

const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Сколько дней осталось: 0 — сегодня, 1 — завтра, −1 — вчера. */
const daysLeft = (ms) => Math.round((dayStart(ms) - startOfToday()) / 86_400_000);

/** Как это произносится. Дальше двух недель число уже не помогает —
    «через 47 дней» ничего не говорит, а «17 октября» говорит. */
function leftLabel(ms) {
  const n = daysLeft(ms);
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n < 0) return 'день прошёл';
  if (n <= 14) return `через ${n} ${plural(n, 'день', 'дня', 'дней')}`;
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

const subMark = (sub) => `<span class="sub__mark" data-color="${esc(sub.color || 'violet')}" aria-hidden="true">${
  esc((sub.title || '?').trim().charAt(0).toUpperCase())}</span>`;

function renderSubs(f) {
  const on  = state.subs.filter((s) => s.state !== 'off').sort((a, b) => a.nextAt - b.nextAt);
  const off = state.subs.filter((s) => s.state === 'off')
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'));

  // Месячный итог округляется до целых рублей намеренно: годовая подписка,
  // поделённая на двенадцать, даёт копейки, и «4 145,17 ₽» в заголовке
  // выглядят точностью, которой у оценки всё равно нет. Годовой итог
  // считается из самих сумм и точен.
  const month = Math.round(on.reduce((sum, s) => sum + inMonth(s), 0) / 100) * 100;
  const year  = on.reduce((sum, s) => sum + inYear(s), 0);

  const row = (sub, dropped = false) => {
    const soon = !dropped && daysLeft(sub.nextAt) <= SOON_DAYS;
    const cls = ['sub', dropped ? 'sub--dropped' : '', soon ? 'sub--soon' : ''].filter(Boolean).join(' ');
    const per = sub.period === 'year' ? 'в год' : 'в месяц';
    return `<button class="${cls}" data-act="sub" data-id="${esc(sub.id)}"
      aria-label="${esc(`${sub.title}, ${money(sub.amount)} ${per}`)}">
      ${subMark(sub)}
      <span class="sub__body">
        <span class="sub__name">${esc(sub.title)}</span>
        <span class="sub__when">${dropped ? 'отменена' : esc(leftLabel(sub.nextAt))}</span>
      </span>
      <span class="sub__money">
        <span class="sub__amount">${money(sub.amount)}</span>
        <span class="sub__per">${per}</span>
      </span>
    </button>`;
  };

  root.innerHTML = `
    ${topBar()}
    <div class="subs${f}">
      ${on.length ? `<div class="subs__total">
        <div class="subs__sum">${money(month)}<span> в месяц</span></div>
        <div class="subs__note">${on.length} ${plural(on.length, 'подписка', 'подписки', 'подписок')},
          за год это <b>${money(year)}</b></div>
      </div>` : ''}

      <div class="subs__list">${
        on.length ? on.map((s) => row(s)).join('')
          : `<p class="subs__empty">Пока ни одной подписки.<br>
             Запишите — и приложение покажет, сколько уходит в месяц и в год,
             и предупредит, прежде чем спишут деньги.</p>`}</div>

      ${off.length ? `<div class="subs__head">Отменённые</div>
        <div class="subs__list subs__list--off">${off.map((s) => row(s, true)).join('')}</div>` : ''}
    </div>`;

  setAddButton(`<button class="add-btn" data-act="sub-new" aria-label="Добавить подписку">${svg(ICON.plus)}</button>`);
}

/* ---------- Листы ---------- */

const sheets = {
  add:      document.getElementById('sheet'),
  settings: document.getElementById('settings'),
  task:     document.getElementById('task-sheet'),
  scope:    document.getElementById('scope-sheet'),
  sub:      document.getElementById('sub-sheet'),
  subActs:  document.getElementById('sub-acts'),
};
const scrim = document.getElementById('sheet-back');
const undoEl = document.getElementById('undo');
const form  = document.getElementById('task-form');

const sheetTitle  = document.getElementById('sheet-title');
const submitBtn   = form.querySelector('[type="submit"]');
const taskTitleEl = document.getElementById('task-sheet-title');
const moveLabel   = document.getElementById('move-label');

/** Открыт всегда ровно один лист — затемнение тоже одно. */
function openSheet(name) {
  closeSheets();
  scrim.classList.add('sheet-back--on');
  sheets[name].classList.add('sheet--on');
}

/* ---------- Форма подписки ---------- */

const currencyHint = document.getElementById('currency-hint');
const subForm      = document.getElementById('sub-form');
const subTitleEl   = document.getElementById('sub-title');
const subSubmit    = document.getElementById('sub-submit');
const subActsTitle = document.getElementById('sub-acts-title');
const subDropLabel = document.getElementById('sub-drop-label');

function setSubColor(color) {
  state.subColor = color;
  for (const b of document.querySelectorAll('#s-colors [data-color-set]')) {
    b.setAttribute('aria-pressed', String(b.dataset.colorSet === color));
  }
}

document.getElementById('s-colors').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color-set]');
  if (b) setSubColor(b.dataset.colorSet);
});

document.getElementById('sub-cancel').addEventListener('click', () => closeSheets());

/** Цвет по умолчанию — тот, которого в списке меньше всех: несколько
    подписок подряд одинакового цвета слились бы в один столбик. */
function freeColor() {
  const used = new Map(SUB_COLORS.map((c) => [c, 0]));
  for (const s of state.subs) if (used.has(s.color)) used.set(s.color, used.get(s.color) + 1);
  return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

function openSubNew() {
  state.editingSub = null;
  subForm.reset();
  // Дата по умолчанию — через месяц: подписку записывают, когда она уже есть,
  // и следующее списание почти всегда впереди.
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  subForm.elements.date.value = dateValue(d.getTime());
  setSubColor(freeColor());
  subTitleEl.textContent = 'Новая подписка';
  subSubmit.textContent = 'Добавить';
  openSheet('sub');
  setTimeout(() => subForm.elements.title.focus(), 360);
}

function openSubEdit(id) {
  const s = state.subs.find((x) => x.id === id);
  if (!s) return;
  state.editingSub = id;
  subForm.elements.title.value = s.title;
  subForm.elements.amount.value = String(s.amount / 100).replace('.', ',');
  subForm.elements.period.value = s.period;
  subForm.elements.date.value = dateValue(s.nextAt);
  setSubColor(s.color || SUB_COLORS[0]);
  subTitleEl.textContent = 'Изменить подписку';
  subSubmit.textContent = 'Сохранить';
  openSheet('sub');
}

function openSubActs(id) {
  const s = state.subs.find((x) => x.id === id);
  if (!s) return;
  state.sheetSub = id;
  subActsTitle.textContent = s.title;
  // у отменённой действие обратное — и подпись другая, иначе непонятно,
  // что будет
  subDropLabel.textContent = s.state === 'off' ? 'Вернуть в подписки' : 'Отменить подписку';
  openSheet('subActs');
}

subForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = subForm.elements.title.value.trim();
  const amount = parseMoney(subForm.elements.amount.value);
  if (!title || amount === null) {
    if (amount === null) subForm.elements.amount.focus();
    return;
  }

  const [y, mo, d] = subForm.elements.date.value.split('-').map(Number);
  const old = state.editingSub ? state.subs.find((x) => x.id === state.editingSub) : null;

  await db.putSub({
    id: old ? old.id : db.newId(),
    title,
    amount,
    period: subForm.elements.period.value,
    nextAt: new Date(y, mo - 1, d).getTime(),
    // день месяца хранится отдельно: из него считается следующее списание,
    // и 31-е не съезжает на 28-е навсегда (см. nextCharge)
    day: d,
    color: state.subColor,
    state: old ? old.state : 'on',
    createdAt: old ? old.createdAt : Date.now(),
  });

  state.editingSub = null;
  closeSheets();
  await refresh();
});

function closeSheets() {
  scrim.classList.remove('sheet-back--on');
  for (const el of Object.values(sheets)) el.classList.remove('sheet--on');
}

/* dayMs — день, на который открыта форма. С экрана дня приходит его дата,
   с «Сегодня» и из шапки календаря — сегодняшняя. */
function openAdd(dayMs = null) {
  state.editing = null;
  form.reset();
  form.elements.date.value = dateValue(dayMs ?? Date.now());
  form.elements.time.value = defaultTime();
  setWeekdays([]);            // чипсы — кнопки, form.reset() их не трогает
  syncRepeatFields();
  clearVoice();
  sheetTitle.textContent = 'Новое дело';
  submitBtn.textContent = 'Добавить';
  openSheet('add');
  setTimeout(() => form.elements.title.focus(), 360);
}

function openEdit(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  state.editing = id;
  form.elements.title.value = t.title;
  form.elements.note.value = t.note || '';
  // дата приходит из самого дела: поэтому просроченное при правке остаётся
  // на своём дне, а не прыгает на сегодня — без отдельной охраны
  form.elements.date.value = dateValue(t.at);
  form.elements.time.value = hhmm(t.at);
  repeatSelect.value = t.repeat ? t.repeat.kind : '';
  setWeekdays(t.repeat && t.repeat.days ? t.repeat.days : []);
  syncRepeatFields();
  // у записи из базы blob не тянется: не тронули — не переписываем
  if (t.voice) showVoice(t.voice); else clearVoice();
  sheetTitle.textContent = 'Изменить дело';
  submitBtn.textContent = 'Сохранить';
  openSheet('add');
  setTimeout(() => form.elements.title.focus(), 360);
}

function openSettings() {
  openSheet('settings');
  syncSettings();
}

function openTaskSheet(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  state.sheetTask = id;
  taskTitleEl.textContent = t.title;
  // просроченному делу «завтра» не поможет — его место сегодня
  moveLabel.textContent = t.at < startOfToday() ? 'Вернуть на сегодня' : 'Перенести на завтра';
  openSheet('task');
}

function defaultTime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function syncSettings() {
  for (const b of sheets.settings.querySelectorAll('[data-theme-set]')) {
    b.setAttribute('aria-pressed', String(b.dataset.themeSet === state.theme));
  }
  for (const b of sheets.settings.querySelectorAll('[data-accent-set]')) {
    b.setAttribute('aria-pressed', String(b.dataset.accentSet === state.accent));
  }
  for (const b of sheets.settings.querySelectorAll('[data-currency-set]')) {
    b.setAttribute('aria-pressed', String(b.dataset.currencySet === state.currency));
  }
  currencyHint.textContent = 'Сейчас — ' + (CURRENCIES[state.currency] || CURRENCIES.rub).name;
  // Строку установки настраиваем первой: её проверяет стенд, а строка
  // напоминаний спрашивает у браузера подписку — это ожидание, и оно
  // не должно задерживать соседей.
  syncInstallRow();
  syncRemindersRow();
}

/* ---------- Напоминания ----------

   Приложение не умеет будить телефон само: это умеет только служба push,
   а её просит кто-то со стороны. Поэтому есть сервер-будильник — и он
   **не знает ни одного названия**. Телефон выгружает ему список времён
   и номеров дел; номер — случайная строка, по которой понять нечего.
   Сервер в назначенную минуту шлёт этот номер обратно, а служба внутри
   приложения находит дело у себя и показывает. Содержимое задач не покидает
   телефон не потому, что мы его шифруем, а потому, что оно и не уходило.

   Сервер может быть недоступен, выключен, ещё не куплен — приложение от
   этого не ломается: всё остальное работает и без него. Просто не будет
   напоминаний, и строка в настройках скажет об этом прямо. */

const SERVER = '';   // адрес сервера-будильника; пусто — напоминаний нет

/* Публичный ключ VAPID. Секретом не является — его видит каждый, кто открыл
   приложение. Вторая копия лежит в tools/push.html: та страница самодостаточна
   и ничего из приложения не подтягивает. Меняются они только вместе,
   командой node tools/vapid.mjs заново. */
const VAPID_KEY = 'BHrtejqCcTkiERnKOzuPD9q-Ueh_8pNvYQ19h7Xyreuf0jSMA4HLUbRC_r8pYOtMHyijfM5A_RPUexbuCMruLm8';

const fromBase64 = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const canRemind = () => SERVER && 'serviceWorker' in navigator
  && 'PushManager' in window && 'Notification' in window;

const pushReady = async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch { return null; }
};

/** Подписка нужна и серверу, и нам: это пропуск, по которому он узнаёт,
    кому будить. Оформляется один раз и живёт, пока её не отзовут. */
async function enableReminders() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return null;

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64(VAPID_KEY),
    });
  }
  return sub;
}

/** Выгрузить времена на сервер.

    Только то, что впереди и в пределах суток: список дел на год вперёд
    серверу не нужен, а дел на год вперёд у человека и нет. Сделанное
    и удалённое не выгружаем — будить по ним не о чем. */
let timesAt = 0;   // когда выгружали в прошлый раз

async function syncTimes(force = false) {
  if (!canRemind()) return;
  const now = Date.now();
  if (!force && now - timesAt < 60_000) return;   // не чаще раза в минуту
  timesAt = now;

  try {
    const sub = await pushReady();
    if (!sub) return;
    const times = state.tasks
      .filter((t) => !t.done && !t.skipped && t.at > now && t.at < now + 86_400_000)
      .map((t) => ({ id: t.id, at: t.at }));

    await fetch(SERVER + '/api/times', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), times }),
    });
  } catch { /* сервер недоступен — молчим: напоминания не главное в приложении */ }
}

/** Что показать в настройках. Строка есть всегда: разрешение можно отозвать
    в любой момент, и человек должен увидеть, что делать, а не пустоту. */
async function syncRemindersRow() {
  const hint = document.getElementById('remind-hint');
  const btn = document.getElementById('remind-btn');

  if (!canRemind()) {
    hint.textContent = SERVER
      ? 'Этот браузер напоминать не умеет'
      : 'Сервер напоминаний ещё не поднят — всё остальное работает';
    btn.hidden = true;
    return;
  }

  const on = Notification.permission === 'granted' && Boolean(await pushReady().catch(() => null));
  btn.hidden = false;
  btn.textContent = on ? 'Выключить' : 'Включить';
  hint.textContent = on
    ? 'Пуш придёт, даже когда приложение закрыто'
    : 'Пока приложение закрыто — не напомнит';
}

/* ---------- Установка на телефон ----------

   Chrome сам предлагает поставить приложение, но приглашение уходит вниз
   экрана, живёт пару секунд и легко пропускается. Перехватываем событие
   (без preventDefault браузер покажет своё) и держим его, пока человек
   не откроет настройки и не нажмёт кнопку — то есть когда он сам об этом
   подумал. Событие одноразовое: после prompt() оно больше не сработает,
   поэтому после нажатия кнопку убираем.

   Событие выдаёт не всякий браузер, и это не поломка: Яндекс.Браузер
   на Android сторонние PWA не ставит вовсе (сам так и отвечает), Safari
   в принципе не умеет beforeinstallprompt. Поэтому строка не исчезает,
   а меняет содержимое: есть приглашение — кнопка, нет — подсказка, что
   сделать. Молча пропасть она не может: человек уже открыл настройки
   за этим, и пустое место ему ничего не объяснит. */

const installRow  = document.getElementById('install-row');
const installHint = document.getElementById('install-hint');
const installBtn  = document.getElementById('install-btn');

const INSTALL_HINT = {
  ready: 'Значок на главном экране, без адресной строки',
  ios:   'Откройте сайт в Safari и выберите «Поделиться» → «На экран „Домой“»',
  other: 'Этот браузер ставить приложения не умеет. Откройте сайт в Chrome '
       + 'и выберите «Установить приложение»',
};

/* iPad с недавних пор представляется как Mac, поэтому одной проверки
   по userAgent мало — у настоящего Mac нет сенсорного экрана */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function syncInstallRow() {
  if (!installRow) return;

  // уже стоит — предлагать нечего
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
    installRow.hidden = true;
    return;
  }

  const ready = Boolean(state.installEvent);
  installRow.hidden = false;
  installBtn.hidden = !ready;

  /* «Умеет, но не воспользовались» и «не умеет вовсе» — разные вещи.
     После отказа от приглашения браузер его больше не выдаст, и без этого
     флага строка начала бы врать: Chrome, который только что предлагал
     установку, объявлялся бы неспособным. */
  installHint.textContent = (ready || state.installOffered) ? INSTALL_HINT.ready
    : isIOS ? INSTALL_HINT.ios : INSTALL_HINT.other;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installEvent = e;
  state.installOffered = true;
  syncInstallRow();
});

window.addEventListener('appinstalled', () => {
  state.installEvent = null;
  syncInstallRow();
});

/* ---------- Повторы ----------

   Вхождения повтора — обычные дела в той же таблице, а не правило,
   вычисляемое на лету. Причина в одной строчке: открытие листа действий,
   правка, отметка, перенос и удаление ищут дело через
   `state.tasks.find((x) => x.id === id)`. Вхождение, которого там нет, они
   не найдут и молча ничего не сделают — а размножение даёт всё это даром.

   Плата — место: год ежедневного дела это 365 записей. */

const REPEAT_HORIZON_DAYS = 365;

const isRepeat = (t) => Boolean(t.seriesId);

/** Ключ потока досоздания.

    Правило у серии может смениться — когда правят «всё будущее», — и тогда
    это уже другой поток: свой якорь, свой хвост. Поэтому в ключе и якорь,
    и само правило, а не один seriesId. */
const streamKey = (t) => [
  t.seriesId, t.repeat.anchor, t.repeat.kind, (t.repeat.days || []).join('.'),
].join('|');

function makeRule(kind, weekdays, anchorAt) {
  return {
    kind,
    days: kind === 'weekly' ? [...weekdays].sort((a, b) => a - b) : [],
    anchor: anchorAt,
  };
}

/** Перебирает даты, когда серия должна случиться: от якоря до untilMs.
    `visit` получает время; вернуть false — остановиться.

    Предел **исключающий**: вхождение ровно в untilMs уже не создаётся.
    Так repeatEnd читается буквально — «дальше этого времени вхождений нет»,
    — и отменённая серия не оживает на следующий же день.

    Идём от якоря, а не от последнего вхождения: у месячного правила
    с 31-м числом последнее в феврале — 28-е, и шаг от него дал бы 28 марта
    вместо 31-го. Ходьба от якоря всегда даёт настоящий день месяца. */
function eachOccurrence(repeat, untilMs, visit) {
  const anchor = new Date(repeat.anchor);
  const h = anchor.getHours(), m = anchor.getMinutes();
  const at = (day) => { const x = new Date(day); x.setHours(h, m, 0, 0); return x.getTime(); };

  if (repeat.kind === 'monthly') {
    const day = anchor.getDate();
    const cur = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    for (;;) {
      // в коротком месяце берём последний день: 31-е в феврале — это 28-е
      const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
      const d = new Date(cur.getFullYear(), cur.getMonth(), Math.min(day, last));
      const ms = at(d);
      if (ms >= untilMs) return;
      if (visit(ms) === false) return;
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  const days = repeat.days || [];
  for (const d = new Date(anchor); ; d.setDate(d.getDate() + 1)) {
    const ms = at(d);
    if (ms >= untilMs) return;
    if (repeat.kind === 'weekly' && !days.includes(d.getDay())) continue;
    if (visit(ms) === false) return;
  }
}

/** Досоздать расписания серий до горизонта — года от сегодня.

    Идемпотентна: зарубки занимают свои места, поэтому повторный вызов ничего
    не создаёт, а удалённое не возвращается. На этом свойстве держится всё
    остальное, и в стенде оно проверяется отдельно — с перезагрузкой.

    Возвращает true, если что-то дописала: вызывающий тогда перерисует экран. */
async function syncSeries() {
  const streams = new Map();
  for (const t of state.tasks) {
    if (!t.seriesId || !t.repeat) continue;
    const key = streamKey(t);
    if (!streams.has(key)) {
      streams.set(key, { repeat: t.repeat, sample: t, taken: new Set(), end: Infinity });
    }
    const s = streams.get(key);
    s.taken.add(dateValue(t.at));
    if (typeof t.repeatEnd === 'number') s.end = Math.min(s.end, t.repeatEnd);
  }
  if (!streams.size) return false;

  const until = Date.now() + REPEAT_HORIZON_DAYS * 86_400_000;
  const fresh = [];

  for (const s of streams.values()) {
    eachOccurrence(s.repeat, Math.min(until, s.end), (at) => {
      if (s.taken.has(dateValue(at))) return true;
      fresh.push({
        id: db.newId(),
        title: s.sample.title,
        note: s.sample.note || '',
        at,
        done: false,
        doneAt: null,
        createdAt: Date.now(),
        seriesId: s.sample.seriesId,
        repeat: s.repeat,
      });
      return true;
    });
  }

  if (!fresh.length) return false;
  await db.putMany(fresh);
  return true;
}

/* ---------- Поле повтора в форме ---------- */

const repeatSelect = form.elements.repeat;
const repeatHint   = document.getElementById('f-repeat-hint');
const weekdaysRow  = document.getElementById('f-weekdays');

const dayOfField = () => new Date(`${form.elements.date.value}T00:00`).getDay();

const readWeekdays = () => [...weekdaysRow.querySelectorAll('[data-wd]')]
  .filter((b) => b.getAttribute('aria-pressed') === 'true')
  .map((b) => Number(b.dataset.wd));

function setWeekdays(days) {
  for (const b of weekdaysRow.querySelectorAll('[data-wd]')) {
    b.setAttribute('aria-pressed', String(days.includes(Number(b.dataset.wd))));
  }
}

/** Показывает только то, что нужно выбранному виду повтора.

    У месячного числа спрашивать нечего — оно берётся из поля даты, — но
    сказать об этом надо: иначе непонятно, какое число получилось. */
function syncRepeatFields() {
  const kind = repeatSelect.value;
  weekdaysRow.hidden = kind !== 'weekly';
  repeatHint.hidden = kind !== 'monthly';
  if (kind !== 'monthly') return;
  const day = new Date(`${form.elements.date.value}T00:00`).getDate();
  repeatHint.textContent = Number.isNaN(day) ? '' : `Каждое ${day}-е число`;
}

repeatSelect.addEventListener('change', () => {
  // по умолчанию — тот же день недели, что и у выбранной даты
  if (repeatSelect.value === 'weekly' && !readWeekdays().length) setWeekdays([dayOfField()]);
  syncRepeatFields();
});

form.elements.date.addEventListener('change', syncRepeatFields);

weekdaysRow.addEventListener('click', (e) => {
  const b = e.target.closest('[data-wd]');
  if (!b) return;
  b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
});

/* ---------- Вопрос «этот день или всё будущее» ---------- */

const scopeTitleEl  = document.getElementById('scope-title');
const scopeOneLabel = document.getElementById('scope-one-label');
const scopeAllLabel = document.getElementById('scope-all-label');

let scopeResolve = null;

function seriesLabel(repeat) {
  if (repeat.kind === 'daily') return 'Все следующие дни';
  if (repeat.kind === 'monthly') return `Все будущие ${new Date(repeat.anchor).getDate()}-е числа`;
  const names = ['воскресенья', 'понедельники', 'вторники', 'среды', 'четверги', 'пятницы', 'субботы'];
  return repeat.days.length === 1
    ? `Все будущие ${names[repeat.days[0]]}`
    : 'Все будущие дни недели';
}

/** Спрашивает и ждёт: 'one' | 'all' | null, если человек передумал. */
function askScope(task) {
  scopeTitleEl.textContent = task.title;
  const day = new Date(task.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  scopeOneLabel.textContent = `Только ${day}`;
  scopeAllLabel.textContent = seriesLabel(task.repeat);
  openSheet('scope');
  return new Promise((resolve) => { scopeResolve = resolve; });
}

function answerScope(value) {
  const waiter = scopeResolve;
  scopeResolve = null;
  closeSheets();
  if (waiter) waiter(value);
}

/** Закрыть лист вообще. Если висит вопрос — отвечаем «передумал»:
    иначе ожидающий код остался бы ждать навсегда. */
function dismiss() {
  if (scopeResolve) answerScope(null);
  else closeSheets();
}

/* ---------- Действия ---------- */

/* Новое дело и изменённое идут одним путём: форма одна, отличается только
   тем, есть ли state.editing. Дата и часы приходят двумя полями и здесь
   складываются в одно местное время.

   scope — 'one' или 'all', что именно меняем у повторяющегося дела. */
async function saveTask(fields, scope = 'one') {
  const { title, note, voice, date, time, repeatKind, weekdays } = fields;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  const at = new Date(y, mo - 1, d, h, m, 0, 0).getTime();

  /* voice: null пишется намеренно, а не пропускается. При правке запись
     собирается как { ...old, ...clean }, и пропущенное поле оставило бы
     голос, который человек только что убрал. */
  const clean = { title: title.trim(), note: note.trim(), voice: voice || null };

  const old = state.editing ? state.tasks.find((x) => x.id === state.editing) : null;

  /* Правка всей серии: хвост сносим и строим заново от этой же даты —
     новый якорь, новое правило. Прошлым вхождениям ставим repeatEnd,
     иначе их поток продолжит досоздавать по старому правилу.

     Отметки «сделано» на будущих вхождениях при этом теряются. Их обычно
     и нет, а переносить их ради редкого случая — лишняя машинерия. */
  if (old && scope === 'all' && old.seriesId) {
    const past   = state.tasks.filter((x) => x.seriesId === old.seriesId && x.at < old.at);
    const future = state.tasks.filter((x) => x.seriesId === old.seriesId && x.at >= old.at);
    for (const x of future) await db.remove(x.id);
    for (const x of past) await db.put({ ...x, repeatEnd: old.at });

    const rule = repeatKind ? makeRule(repeatKind, weekdays, at) : null;
    const rec = { ...old, ...clean, at, done: false, doneAt: null, skipped: false };
    delete rec.repeatEnd;
    if (!rec.voice) delete rec.voice;
    if (rule) { rec.seriesId = old.seriesId; rec.repeat = rule; }
    else { delete rec.seriesId; delete rec.repeat; }

    await db.put(rec);
    state.editing = null;
    await refresh();
    if (rule && await syncSeries()) await refresh();
    return;
  }

  /* Правка одного вхождения правило серии не трогает: сменить расписание
     можно только через «всё будущее», о чём и спрашивает лист. */
  const rule = !old && repeatKind ? makeRule(repeatKind, weekdays, at) : null;
  const rec = old
    ? { ...old, ...clean, at }
    : {
        id: db.newId(),
        ...clean,
        at,
        done: false,
        doneAt: null,
        createdAt: Date.now(),
        ...(rule ? { seriesId: db.newId(), repeat: rule } : {}),
      };
  if (!rec.voice) delete rec.voice;
  await db.put(rec);
  state.editing = null;
  await refresh();
  // у серии после создания или переноса якоря надо досоздать хвост
  if (rec.seriesId && await syncSeries()) await refresh();
}

/** Просроченное возвращается на сегодня, остальное уезжает на завтра.
    Условие то же, что и у подписи в листе действий — они не разойдутся. */
async function moveTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const d = new Date(t.at);
  if (t.at < startOfToday()) {
    const now = new Date();
    d.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
  } else {
    d.setDate(d.getDate() + 1);
  }
  /* У серии освободившееся место надо закрыть зарубкой. Иначе досоздание
     увидит пустую клетку расписания и вернёт дело на старый день — оно
     окажется в двух сразу. */
  if (t.seriesId) {
    await db.put({ ...t, id: db.newId(), skipped: true, done: false, doneAt: null });
  }

  // Дело уезжает на другой день: строка исчезает, остальные поднимаются.
  // Без этого они прыгали бы на новое место одним кадром.
  const before = rowRects();

  t.at = d.getTime();
  t.skipped = false;
  await db.put(t);
  state.flash = id;
  await refresh();
  playMove(before);
}

/* scope — что удаляем у повторяющегося дела.

   'one' — вхождение становится зарубкой, а не исчезает: место в расписании
   должно остаться занятым, иначе syncSeries создаст дело заново и удалённое
   вернётся.

   'all' — будущие вхождения сносятся, а последнему оставшемуся ставится
   repeatEnd: без него досоздание пройдёт по расписанию и создаст их снова.
   Полоски «Вернуть» тут нет намеренно: она умеет возвращать одно дело,
   а не серию, и делать вид, что вернёт всё, хуже, чем не показывать её. */
async function deleteTask(id, scope = 'one') {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;

  if (t.seriesId && scope === 'all') {
    const future = state.tasks.filter((x) => x.seriesId === t.seriesId && x.at >= t.at);
    const rest = state.tasks
      .filter((x) => x.seriesId === t.seriesId && x.at < t.at)
      .sort((a, b) => b.at - a.at);
    for (const x of future) await db.remove(x.id);
    if (rest.length) await db.put({ ...rest[0], repeatEnd: t.at });
    await refresh();
    return;
  }

  if (t.seriesId) {
    await db.put({ ...t, skipped: true, done: false, doneAt: null });
    await refresh();
    return;
  }

  // Сначала доигрываем сжатие, и только потом трогаем список: если убрать
  // строку сразу, экран перерисуется и сжимать будет уже нечего.
  await collapseRow(id);
  state.removed = t;          // держим в памяти, пока полоска «Вернуть» на экране
  await db.remove(id);
  await refresh();
  showUndo();
}

async function undoDelete() {
  const t = state.removed;
  if (!t) return;
  hideUndo();          // сначала забираем дело, потом прячем полоску —
                       // hideUndo обнуляет state.removed
  await db.put(t);
  await refresh();
}

let undoTimer = 0;

function showUndo() {
  undoEl.classList.add('undo--on');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 6000);
}

function hideUndo() {
  clearTimeout(undoTimer);
  undoEl.classList.remove('undo--on');
  state.removed = null;
}

/* ---------- Переезд строки ----------

   Отметили дело — оно уходит в «Сделано». Раньше оно там просто появлялось:
   экран перерисовывался целиком, и строка телепортировалась. Плана это
   не устраивало (§5, «Движение»): карточка должна уезжать.

   Приём называется FLIP — «сначала, потом, наоборот, играй». Запоминаем,
   где строки стояли до перерисовки (First), даём экрану перерисоваться
   и меряем заново (Last), ставим каждую на старое место через transform
   (Invert) и отпускаем — дальше её ведёт transition (Play).

   Считается это по **всем** строкам, а не только по отмеченной: когда одна
   уезжает вниз, остальные сдвигаются вверх, и без этого они прыгали бы.

   Транзишн на время измерения выключается: иначе браузер применит его
   к самому сдвигу и строка поедет не туда. */

const noMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const rowRects = () => {
  const map = new Map();
  for (const el of root.querySelectorAll('.task[data-id]')) {
    map.set(el.dataset.id, el.getBoundingClientRect());
  }
  return map;
};

function playMove(before) {
  if (noMotion()) return;
  for (const el of root.querySelectorAll('.task[data-id]')) {
    const was = before.get(el.dataset.id);
    if (!was) continue;                       // строка новая — ей нечего догонять

    const now = el.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    // принудительный пересчёт: без него браузер не увидит исходного
    // положения и следующая строка ничего не изменит
    void el.offsetWidth;
    el.style.transition = 'transform .35s var(--ease-out)';
    el.style.transform = '';
    el.addEventListener('transitionend', () => {
      el.style.transition = '';
      el.style.transform = '';
    }, { once: true });
  }
}

/** Сжимает строку до нуля и ждёт, пока это доиграет.

    Отдельной анимации для соседей не нужно: высота меняется плавно, и браузер
    пересчитывает раскладку каждый кадр — остальные строки поднимаются сами,
    ровно с той же скоростью. Это и есть «карточка сжимается в точку» из §5,
    только без выдумывания координат: раскладку двигает сам браузер. */
function collapseRow(id) {
  return new Promise((resolve) => {
    const el = [...root.querySelectorAll('.task[data-id]')]
      .find((r) => r.dataset.id === id);
    if (!el || noMotion()) { resolve(); return; }

    el.style.overflow = 'hidden';
    el.style.height = el.offsetHeight + 'px';
    void el.offsetWidth;                 // иначе браузер не увидит исходной высоты
    el.style.transition = 'height .26s var(--ease-out), padding .26s var(--ease-out), opacity .2s var(--ease-out)';
    el.style.height = '0px';
    el.style.paddingTop = '0px';
    el.style.paddingBottom = '0px';
    el.style.opacity = '0';
    setTimeout(resolve, 290);
  });
}

async function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;

  const before = rowRects();
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  state.flash = id;
  if (t.done) navigator.vibrate?.(12);
  await db.put(t);
  await refresh();
  playMove(before);
}

/* Звук в файл копии.

   Без него копия теряет смысл: расшифровки нет, звук и есть заметка.
   В JSON двоичное не положить, поэтому base64 — файл от этого растёт
   примерно на треть, и ради этого запись ограничена двумя минутами.

   Через FileReader, а не через btoa по массиву: btoa на большом массиве
   падает, потому что строку пришлось бы собирать по байту. */
const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function exportBackup() {
  const audio = {};
  for (const [id, blob] of await db.allVoice()) audio[id] = await blobToBase64(blob);

  const payload = {
    app: 'napominalka', version: 3, exportedAt: new Date().toISOString(),
    tasks: state.tasks,
    subs: state.subs,
    audio,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `напоминалка-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  const tasks = Array.isArray(data) ? data : data.tasks;
  if (!Array.isArray(tasks)) throw new Error('в файле нет списка задач');
  for (const t of tasks) {
    if (!t.id || !t.title || typeof t.at !== 'number') throw new Error('файл повреждён');
  }
  /* Копия — источник правды целиком, поэтому звук заменяется, а не
     добавляется. В копии версии 1 звука нет вовсе, и записи от прежнего
     списка уходят вместе с ним: оставить их значило бы оставить звук
     от дел, которых больше нет. */
  const audio = data.audio || {};
  const pairs = Object.entries(audio).map(([id, b64]) => [
    id,
    base64ToBlob(b64, tasks.find((t) => t.voice?.id === id)?.voice?.type || 'audio/webm'),
  ]);

  await db.replaceAll(tasks);
  await db.replaceVoice(pairs);
  // копия версии 1 и 2 подписок не знает вовсе — тогда список просто пустой,
  // и прежние подписки уходят вместе со всем остальным
  await db.replaceSubs(Array.isArray(data.subs) ? data.subs : []);
  await refresh();
}

/* ---------- Связывание ---------- */

async function refresh() {
  state.tasks = await db.all();
  state.subs = await db.allSubs();
  render();
  // Список времён на сервере держим свежим. Не ждём: напоминания — не то,
  // ради чего стоит задерживать отрисовку. Внутри свой предел частоты.
  syncTimes();
}

document.addEventListener('click', async (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    const tab = tabBtn.dataset.tab;
    // вход на «Месяц» всегда показывает календарь: если человек был
    // в открытом дне, повторный тап по вкладке возвращает его назад
    if (tab === 'month') state.monthDay = null;
    state.tab = tab;
    fresh = true;
    render();
    return;
  }

  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    // кнопка несёт день, на который её нажали: с экрана чужого дня форма
    // откроется на нём, а не на сегодня
    if (a === 'add') { openAdd(act.dataset.day ? Number(act.dataset.day) : null); return; }
    if (a === 'settings') { openSettings(); return; }
    if (a === 'close') { dismiss(); return; }
    if (a === 'back') { state.monthDay = null; fresh = true; render(); return; }
    if (a === 'month-prev' || a === 'month-next') {
      const c = new Date(state.monthCursor);
      state.monthCursor = new Date(
        c.getFullYear(), c.getMonth() + (a === 'month-next' ? 1 : -1), 1).getTime();
      state.monthDay = null;
      fresh = true;
      render();
      return;
    }
    if (a === 'day') {
      state.monthDay = Number(act.dataset.day);
      fresh = true;
      render();
      return;
    }
    if (a === 'year-prev' || a === 'year-next') {
      state.yearCursor += (a === 'year-next' ? 1 : -1);
      fresh = true;
      render();
      return;
    }
    // тап по месяцу в «Годе» открывает его в «Месяце»: год показывает
    // форму года, а не заменяет календарь
    if (a === 'year-month') {
      state.monthCursor = Number(act.dataset.month);
      state.monthDay = null;
      state.tab = 'month';
      fresh = true;
      render();
      return;
    }
    if (a === 'export') { exportBackup(); return; }
    if (a === 'import') { document.getElementById('import-file').click(); return; }
    if (a === 'install') {
      const invite = state.installEvent;
      if (!invite) return;
      state.installEvent = null;   // приглашение одноразовое
      await invite.prompt();
      await invite.userChoice;     // ждём выбор, иначе не узнаем, поставили или нет
      syncInstallRow();
      return;
    }
    if (a === 'toggle') {
      const id = act.closest('[data-id]')?.dataset.id;
      if (id) await toggleTask(id);
      return;
    }
    if (a === 'play') { playVoice(act.dataset.voice, act.closest('.player')); return; }

    if (a === 'remind') {
      try {
        const sub = await pushReady();
        if (sub) {
          await sub.unsubscribe();     // отписались — сервер узнает об этом сам, ответом 410
        } else if (await enableReminders()) {
          await syncTimes(true);
        }
      } catch { /* отказ в разрешении — не беда, покажем это строкой */ }
      await syncRemindersRow();
      return;
    }

    // подписки
    if (a === 'sub-new') { openSubNew(); return; }
    if (a === 'sub') { openSubActs(act.dataset.id); return; }
    if (a === 'sub-edit') { if (state.sheetSub) openSubEdit(state.sheetSub); return; }
    if (a === 'sub-paid' || a === 'sub-drop') {
      const s = state.subs.find((x) => x.id === state.sheetSub);
      if (!s) return;
      // «Оплачено» двигает дату вперёд; «Отменить» переключает судьбу.
      // Это два разных действия, и оба обычные — не исключение из правила.
      await db.putSub(a === 'sub-paid'
        ? { ...s, nextAt: nextCharge(s) }
        : { ...s, state: s.state === 'off' ? 'on' : 'off' });
      closeSheets();
      await refresh();
      return;
    }
    if (a === 'sub-remove') {
      if (state.sheetSub) await db.removeSub(state.sheetSub);
      closeSheets();
      await refresh();
      return;
    }

    if (a === 'scope-one') { answerScope('one'); return; }
    if (a === 'scope-all') { answerScope('all'); return; }

    // действия над делом из листа, открытого долгим нажатием
    const id = state.sheetTask;
    if (a === 'edit') { if (id) openEdit(id); return; }
    // перенос у серии спрашивать не о чем: «на завтра» значит сдвинуть
    // этот день, а не переписать расписание всей серии
    if (a === 'move') { closeSheets(); if (id) await moveTask(id); return; }
    if (a === 'delete') {
      const task = state.tasks.find((x) => x.id === id);
      closeSheets();
      if (!task) return;
      const scope = task.seriesId ? await askScope(task) : 'one';
      if (scope) await deleteTask(id, scope);
      return;
    }
    if (a === 'undo') { await undoDelete(); return; }
  }
});

/* ---------- Долгое нажатие ----------
   §4.1: долгое нажатие на дело открывает карточку действий. Держим 480 мс;
   сдвиг пальца больше чем на 10 px отменяет — иначе меню вылезало бы
   при обычной прокрутке списка. */

let hold = null;

function dropHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  hold.row.classList.remove('task--held');
  hold = null;
}

document.addEventListener('pointerdown', (e) => {
  const row = e.target.closest('.task');
  // галочка — это отметка «сделано», у неё своё действие
  if (!row || e.target.closest('.task__check')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  dropHold();
  const h = { row, x: e.clientX, y: e.clientY, timer: 0 };
  h.timer = setTimeout(() => {
    hold = null;
    row.classList.add('task--held');
    setTimeout(() => row.classList.remove('task--held'), 260);
    navigator.vibrate?.(14);
    openTaskSheet(row.dataset.id);
  }, 480);
  hold = h;
});

document.addEventListener('pointermove', (e) => {
  if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) dropHold();
});

document.addEventListener('pointerup', dropHold);
document.addEventListener('pointercancel', dropHold);

// на компьютере то же самое делает правая кнопка
document.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.task');
  if (!row) return;
  e.preventDefault();
  dropHold();
  openTaskSheet(row.dataset.id);
});

for (const b of document.querySelectorAll('[data-theme-set]')) {
  b.addEventListener('click', () => {
    state.theme = b.dataset.themeSet;
    localStorage.setItem('theme', state.theme);
    applyAppearance();
    syncSettings();
  });
}

for (const b of document.querySelectorAll('[data-accent-set]')) {
  b.addEventListener('click', () => {
    state.accent = b.dataset.accentSet;
    localStorage.setItem('accent', state.accent);
    applyAppearance();
    syncSettings();
  });
}

for (const b of document.querySelectorAll('[data-currency-set]')) {
  b.addEventListener('click', () => {
    state.currency = b.dataset.currencySet;
    localStorage.setItem('currency', state.currency);
    syncSettings();
    // суммы на экране подписок надо переписать: значок изменился
    render();
  });
}

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    await importBackup(file);
    alert('Задачи загружены.');
  } catch (err) {
    alert('Не получилось загрузить: ' + err.message);
  }
});

// dismiss, а не closeSheets: если висит вопрос «этот день или всё будущее»,
// закрытие листа обязано на него ответить, иначе ожидающий код зависнет
scrim.addEventListener('click', dismiss);
document.getElementById('sheet-cancel').addEventListener('click', dismiss);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = form.elements.title.value;
  if (!title.trim()) return;

  // Заметка — либо текстом, либо голосом. Если записали голос, текст не
  // сохраняем: два описания одного и того же только мешали бы друг другу.
  const fields = {
    title,
    note: formVoice ? '' : form.elements.note.value,
    voice: formVoice
      ? { id: formVoice.id, ms: formVoice.ms, wave: formVoice.wave, type: formVoice.type }
      : null,
    date: form.elements.date.value,
    time: form.elements.time.value,
    repeatKind: repeatSelect.value,
    weekdays: readWeekdays(),
  };

  // Правка повторяющегося дела: сначала выясняем, что именно меняем, и только
  // потом закрываем форму. Если человек передумал — возвращаем его обратно
  // к форме, значения на месте.
  const editing = state.editing ? state.tasks.find((x) => x.id === state.editing) : null;
  if (editing && editing.seriesId) {
    const scope = await askScope(editing);
    if (!scope) { openSheet('add'); return; }
    await saveTask(fields, scope);
    return;
  }

  await saveTask(fields, 'one');
  closeSheets();
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); });

/* ---------- Старт ---------- */

applyAppearance();

/* Горизонт повторов надо двигать при каждом запуске: серия, созданная год
   назад, иначе кончится ровно через год после создания. Заодно это проверка
   идемпотентности — зарубки занимают свои места, и удалённое не возвращается. */
(async () => {
  await refresh();
  if (await syncSeries()) await refresh();

  syncNoteRow();

  /* Метла по звуку — при запуске, когда возвращать удалённое уже нечего.

     Удаление дела не сносит его запись: удалённое можно вернуть полоской
     «Вернуть», и снести звук в момент удаления значило бы вернуть дело
     без голоса. Поэтому записи, на которые никто не ссылается, убираются
     здесь — заодно и те, что остались от брошенных форм. */
  try {
    await db.sweepVoice(new Set(state.tasks.filter((t) => t.voice).map((t) => t.voice.id)));
  } catch { /* метла не должна мешать запуску */ }
})();

/* Раз в полминуты — только то, что действительно изменилось.
   Полная перерисовка здесь была бы вредна: она заново проигрывает
   появление карточек и сбивает нажатие, если палец в этот момент на экране. */
let prevNow = Date.now();

setInterval(() => {
  const now = Date.now();
  const was = new Date(prevNow), is = new Date(now);
  const rolled = was.getDate() !== is.getDate();
  // дело перешагнуло текущую минуту → линия «сейчас» едет вниз
  const crossed = state.tasks.some((t) => t.at > prevNow && t.at <= now);
  prevNow = now;

  // Живёт только тот экран, на котором идёт сегодняшняя лента. День,
  // открытый из календаря, — такой же живой, если он сегодняшний.
  const live = state.tab === 'today'
    || (state.tab === 'month' && state.monthDay === startOfToday());
  if (!live) return;
  if (rolled) { refresh(); return; }
  if (crossed) { render(); return; }

  const label = root.querySelector('.now__label');
  if (label) label.textContent = hhmm(now);
}, 30_000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
