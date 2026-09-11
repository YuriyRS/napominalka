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
};

const svg = (d, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

/* ---------- Утилиты ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (ts) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

const deeds = (n) => `${n} ${plural(n, 'дело', 'дела', 'дел')}`;

/* ---------- Состояние ---------- */

const state = {
  tab: 'today',
  tasks: [],
  theme: localStorage.getItem('theme') || 'auto',
  accent: localStorage.getItem('accent') || 'violet',
};

/* ---------- Оформление ---------- */

const ACCENTS = ['violet', 'blue', 'teal', 'emerald'];

function applyAppearance() {
  const el = document.documentElement;
  if (state.theme === 'auto') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', state.theme);
  if (state.accent === 'violet') el.removeAttribute('data-accent');
  else el.setAttribute('data-accent', state.accent);
}

/* ---------- Отрисовка ---------- */

const root  = document.getElementById('screen');
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

const topBar = () => `
  <div class="top">
    <h1 class="top__title">${state.tab === 'today' ? 'Сегодня' : esc({ month: 'Месяц', year: 'Год', subs: 'Подписки' }[state.tab] || '')}</h1>
    <button class="icon-btn" data-act="settings" aria-label="Настройки">${svg(ICON.gear)}</button>
  </div>`;

/* кольцо прогресса: r=30 → длина окружности 2πr */
const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;

function ring(done, total) {
  const p = total ? done / total : 0;
  const offset = RING_C * (1 - p);
  const num = total ? `${done}<span class="ring__of">/${total}</span>` : '—';
  return `
    <div class="ring">
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop class="ring-grad-a" offset="0"/>
            <stop class="ring-grad-b" offset="1"/>
          </linearGradient>
        </defs>
        <circle class="ring__track" cx="36" cy="36" r="${RING_R}"/>
        <circle class="ring__fill" cx="36" cy="36" r="${RING_R}"
                stroke-dasharray="${RING_C.toFixed(1)}"
                stroke-dashoffset="${offset.toFixed(1)}"/>
      </svg>
      <span class="ring__num">${num}</span>
    </div>`;
}

function renderToday() {
  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate() + 1);

  const todays = state.tasks
    .filter((t) => t.at >= startOfDay.getTime() && t.at < endOfDay.getTime())
    .sort((a, b) => a.at - b.at);

  const active = todays.filter((t) => !t.done);
  const done   = todays.filter((t) => t.done);
  const nextId = active.find((t) => t.at >= now.getTime())?.id ?? null;

  // «суббота, 12 сентября» — поднимаем только первую букву,
  // месяц в русском остаётся строчным
  const raw = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const dateStr = raw.charAt(0).toUpperCase() + raw.slice(1);

  const subText = todays.length === 0
    ? 'Пока пусто'
    : active.length === 0
      ? 'Всё сделано. Отдыхайте.'
      : `осталось ${deeds(active.length)}`;

  const row = (t, extra = '') => `
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
    </div>`;

  let body = '';
  if (todays.length) {
    let items = '';
    let placed = false;
    for (const t of active) {
      if (!placed && t.at >= now.getTime()) { items += nowLine(now); placed = true; }
      if (t.done) continue;
      items += `<li>${row(t, t.id === nextId ? 'task--next' : '')}</li>`;
    }
    if (active.length && !placed) items += nowLine(now);
    for (const t of done) items += `<li>${row(t)}</li>`;

    body = `
      <div class="section">
        <h2 class="section__name">День</h2>
        <span class="section__meta">${done.length} из ${todays.length}</span>
      </div>
      <div class="list"><ul class="timeline">${items}</ul></div>`;
  } else {
    body = emptyState();
  }

  root.innerHTML = `
    ${topBar()}
    <section class="hero">
      ${ring(done.length, todays.length)}
      <div class="hero__text">
        <p class="hero__date">${esc(dateStr)}</p>
        <p class="hero__sub">${esc(subText)}</p>
      </div>
    </section>
    ${body}
    <div class="add-bar">
      <button class="add-btn" data-act="add">${svg(ICON.plus)}Добавить</button>
    </div>`;
}

function nowLine(now) {
  return `
    <li class="now" aria-hidden="true">
      <div class="now__bar"></div>
      <span class="now__label">сейчас ${hhmm(now.getTime())}</span>
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
    ${topBar()}
    <div class="soon">
      <h2 class="soon__title">Ещё не готово</h2>
      <p class="soon__text">${esc(text)}.</p>
      <span class="soon__stage">${esc(stage)}</span>
    </div>`;
}

/* ---------- Листы ---------- */

const addSheet  = document.getElementById('sheet');
const addBack   = document.getElementById('sheet-back');
const setSheet  = document.getElementById('settings');
const setBack   = document.getElementById('settings-back');
const form      = document.getElementById('task-form');

const anyOpen = () => addSheet.classList.contains('sheet--on') || setSheet.classList.contains('sheet--on');

function openAdd() {
  form.reset();
  form.elements.time.value = defaultTime();
  addBack.classList.add('sheet-back--on');
  addSheet.classList.add('sheet--on');
  setTimeout(() => form.elements.title.focus(), 360);
}

function openSettings() {
  setBack.classList.add('sheet-back--on');
  setSheet.classList.add('sheet--on');
  syncSettings();
}

function closeSheets() {
  for (const el of [addSheet, setSheet]) el.classList.remove('sheet--on');
  for (const el of [addBack, setBack]) el.classList.remove('sheet-back--on');
}

function defaultTime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function syncSettings() {
  for (const b of setSheet.querySelectorAll('[data-theme-set]')) {
    b.setAttribute('aria-pressed', String(b.dataset.themeSet === state.theme));
  }
  for (const b of setSheet.querySelectorAll('[data-accent-set]')) {
    b.setAttribute('aria-pressed', String(b.dataset.accentSet === state.accent));
  }
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
  if (tabBtn) { state.tab = tabBtn.dataset.tab; render(); return; }

  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'add') { openAdd(); return; }
    if (a === 'settings') { openSettings(); return; }
    if (a === 'close') { closeSheets(); return; }
    if (a === 'export') { exportBackup(); return; }
    if (a === 'import') { document.getElementById('import-file').click(); return; }
    if (a === 'toggle') {
      const id = act.closest('[data-id]')?.dataset.id;
      if (id) await toggleTask(id);
      return;
    }
  }
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

for (const back of [addBack, setBack]) back.addEventListener('click', closeSheets);
document.getElementById('sheet-cancel').addEventListener('click', closeSheets);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = form.elements.title.value;
  if (!title.trim()) return;
  await addTask(title, form.elements.note.value, form.elements.time.value);
  closeSheets();
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

/* ---------- Старт ---------- */

applyAppearance();
refresh();

// если приложение открыто через полночь — обновляем
setInterval(() => { if (state.tab === 'today') render(); }, 60_000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
