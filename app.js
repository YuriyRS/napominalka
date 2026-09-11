/* ============================================================
   Напоминалка — логика
   Этап 1: экран «Сегодня». Остальные вкладки — заглушки.
   ============================================================ */

import * as db from './db.js';

/* ---------- Иконки ---------- */

const ICON = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  month: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  year:  '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/>',
  subs:  '<rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M2.5 11h19M6 15.5h3"/>',
  plus:  '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M3 9l4.5 4.5L15 5"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8"/>',
};

const svg = (d, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

/* ---------- Утилиты ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (ts) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function dateHuman(d) {
  return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/* ---------- Состояние ---------- */

const state = {
  tab: 'today',
  tasks: [],
};

/* ---------- Отрисовка ---------- */

const root = document.getElementById('screen');
const navEl = document.getElementById('nav');

function render() {
  if (state.tab === 'today') renderToday();
  if (state.tab === 'month') renderSoon('Месяц', 'Календарь с плотностью задач по дням', 'Этап 2');
  if (state.tab === 'year')  renderSoon('Год', 'Обзор по месяцам — видно, где густо, а где пусто', 'Этап 2');
  if (state.tab === 'subs')  renderSoon('Подписки', 'Список подписок, даты списаний и общая сумма', 'Этап 4');
  renderNav();
}

function renderNav() {
  const items = [
    ['today', 'Сегодня', ICON.today],
    ['month', 'Месяц',   ICON.month],
    ['year',  'Год',     ICON.year],
    ['subs',  'Подписки', ICON.subs],
  ];
  navEl.innerHTML = items.map(([key, label, icon]) => `
    <button class="nav__item ${state.tab === key ? 'nav__item--active' : ''}"
            data-tab="${key}" aria-label="${esc(label)}"
            ${state.tab === key ? 'aria-current="page"' : ''}>
      ${svg(icon)}<span>${esc(label)}</span>
    </button>`).join('');
}

function renderToday() {
  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate() + 1);

  const todays = state.tasks
    .filter((t) => t.at >= startOfDay.getTime() && t.at < endOfDay.getTime())
    .sort((a, b) => a.at - b.at);

  const active = todays.filter((t) => !t.done);
  const done = todays.filter((t) => t.done);

  const nextId = active.find((t) => t.at >= now.getTime())?.id ?? null;

  let list = '';
  let linePlaced = false;

  const rowHtml = (t, extra = '') => `
    <li>
      <div class="task ${t.done ? 'task--done' : ''} ${extra}" data-id="${esc(t.id)}">
        <button class="task__check" data-act="toggle" aria-pressed="${t.done}"
                aria-label="${t.done ? 'Отменить' : 'Отметить'} «${esc(t.title)}»">
          ${svg(ICON.check)}
        </button>
        <div class="task__body">
          <div class="task__time">${hhmm(t.at)}</div>
          <div class="task__title">${esc(t.title)}</div>
          ${t.note ? `<div class="task__note">${esc(t.note)}</div>` : ''}
        </div>
      </div>
    </li>`;

  for (const t of active) {
    if (!linePlaced && t.at >= now.getTime()) {
      list += nowLine(now);
      linePlaced = true;
    }
    list += rowHtml(t, t.id === nextId ? 'task--next' : '');
  }

  // если все задачи уже прошли — линия «сейчас» встаёт в конец
  if (active.length && !linePlaced) list += nowLine(now);

  if (done.length) {
    list += `<li class="timeline__sep">Сделано · ${done.length}</li>`;
    for (const t of done) list += rowHtml(t);
  }

  const count = active.length;
  const countText = count
    ? `<b>${count}</b> ${plural(count, 'дело', 'дела', 'дел')} на сегодня`
    : '';

  root.innerHTML = `
    <header class="head">
      <h1 class="head__title">Сегодня</h1>
      <p class="head__sub">${esc(dateHuman(now))}</p>
      ${countText ? `<p class="head__count">${countText}</p>` : ''}
    </header>
    ${todays.length ? `<ul class="timeline">${list}</ul>` : emptyState()}
    <div class="add-bar">
      <button class="add-btn" data-act="add">${svg(ICON.plus)}Добавить</button>
    </div>`;
}

function nowLine(now) {
  return `
    <li class="now-line" aria-hidden="true">
      <div class="now-line__bar"></div>
      <span class="now-line__label">сейчас ${hhmm(now.getTime())}</span>
    </li>`;
}

function emptyState() {
  return `
    <div class="empty">
      <div class="empty__mark">${svg(ICON.spark)}</div>
      <h2 class="empty__title">Ничего не запланировано</h2>
      <p class="empty__text">Хороший день, чтобы просто выдохнуть. Или запишите что-нибудь, пока не забылось.</p>
    </div>`;
}

function renderSoon(title, text, stage) {
  root.innerHTML = `
    <header class="head"><h1 class="head__title">${esc(title)}</h1></header>
    <div class="soon">
      <h2 class="soon__title">Ещё не готово</h2>
      <p class="soon__text">${esc(text)}.</p>
      <span class="soon__stage">${esc(stage)}</span>
    </div>`;
}

/* ---------- Лист добавления ---------- */

const sheet = document.getElementById('sheet');
const back = document.getElementById('sheet-back');
const form = document.getElementById('task-form');

function defaultTime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function openSheet() {
  form.reset();
  form.elements.time.value = defaultTime();
  back.classList.add('sheet-back--on');
  sheet.classList.add('sheet--on');
  setTimeout(() => form.elements.title.focus(), 340);
}

function closeSheet() {
  back.classList.remove('sheet-back--on');
  sheet.classList.remove('sheet--on');
}

/* ---------- Действия ---------- */

async function addTask(title, note, time) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  await db.put({
    id: db.newId(),
    title: title.trim(),
    note: note.trim(),
    at: d.getTime(),
    done: false,
    doneAt: null,
    createdAt: Date.now(),
  });
  await refresh();
}

async function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  await db.put(t);
  await refresh();
}

/* ---------- Связывание ---------- */

async function refresh() {
  state.tasks = await db.all();
  render();
}

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { state.tab = tabBtn.dataset.tab; render(); return; }

  const act = e.target.closest('[data-act]');
  if (act && act.dataset.act === 'add') { openSheet(); return; }

  const check = e.target.closest('[data-act="toggle"]');
  if (check) {
    const id = check.closest('[data-id]')?.dataset.id;
    if (id) toggleTask(id);
    return;
  }
});

back.addEventListener('click', closeSheet);
document.getElementById('sheet-cancel').addEventListener('click', closeSheet);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = form.elements.title.value;
  if (!title.trim()) return;
  await addTask(title, form.elements.note.value, form.elements.time.value);
  closeSheet();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

/* ---------- Старт ---------- */

refresh();
// если приложение открыто через полночь — обновляем экран
setInterval(() => { if (state.tab === 'today') render(); }, 60_000);
