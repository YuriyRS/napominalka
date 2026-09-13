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
  check:  '<path d="M3 9l4.5 4.5L15 5"/>',
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

/* Появление проигрывается только при входе на экран.
   Иначе любое обновление — отметка дела, смена минуты — заставляет
   карточки всплывать заново, и экран мигает. */
let fresh = true;

function render() {
  const f = fresh ? ' is-fresh' : '';
  fresh = false;
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
  if (state.tab === 'year')  renderSoon('Год', 'Обзор по месяцам — видно, где густо, а где пусто', 'Этап 2', f);
  if (state.tab === 'subs')  renderSoon('Подписки', 'Список подписок, даты списаний и общая сумма', 'Этап 4', f);
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
    : state.tab === 'month'
      ? `<div class="top top--slim"><span class="top__eyebrow">${esc(TITLES.month)}</span>${gear}</div>`
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
        ${t.note ? `<div class="task__note">${esc(t.note)}</div>` : ''}
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
    ${body}
    ${withAdd ? `<div class="add-bar">
      <button class="add-btn" data-act="add" data-day="${startOfDay.getTime()}">${svg(ICON.plus)}Добавить</button>
    </div>` : ''}`;
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

function renderSoon(title, text, stage, f) {
  root.innerHTML = `
    ${topBar()}
    <div class="soon${f}">
      <h2 class="soon__title">Ещё не готово</h2>
      <p class="soon__text">${esc(text)}.</p>
      <span class="soon__stage">${esc(stage)}</span>
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

function renderMonth(f) {
  if (state.monthCursor === null) state.monthCursor = firstOfMonth(new Date());

  const cursor = new Date(state.monthCursor);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // неделя с понедельника: getDay() считает от воскресенья
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;

  // сколько дел в каждом дне — одним проходом по уже загруженному списку,
  // а не сорока двумя запросами к базе
  const counts = new Map();
  for (const t of state.tasks) {
    if (!shown(t)) continue;
    const d = new Date(t.at); d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    counts.set(key, (counts.get(key) || 0) + 1);
  }

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

/* ---------- Листы ---------- */

const sheets = {
  add:      document.getElementById('sheet'),
  settings: document.getElementById('settings'),
  task:     document.getElementById('task-sheet'),
  scope:    document.getElementById('scope-sheet'),
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
  syncInstallRow();
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
  const { title, note, date, time, repeatKind, weekdays } = fields;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  const at = new Date(y, mo - 1, d, h, m, 0, 0).getTime();
  const clean = { title: title.trim(), note: note.trim() };

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

  t.at = d.getTime();
  t.skipped = false;
  await db.put(t);
  state.flash = id;
  await refresh();
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

async function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  state.flash = id;
  if (t.done) navigator.vibrate?.(12);
  await db.put(t);
  await refresh();
}

function exportBackup() {
  const payload = { app: 'napominalka', version: 1, exportedAt: new Date().toISOString(), tasks: state.tasks };
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
  await db.replaceAll(tasks);
  await refresh();
}

/* ---------- Связывание ---------- */

async function refresh() {
  state.tasks = await db.all();
  render();
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

  const fields = {
    title,
    note: form.elements.note.value,
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
