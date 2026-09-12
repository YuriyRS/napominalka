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
  if (state.tab === 'today') renderToday(f);
  if (state.tab === 'month') renderSoon('Месяц', 'Календарь с плотностью задач по дням', 'Этап 2', f);
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
   крупным шрифтом здесь пишется дата, иначе две доминанты спорят за глаз. */
const topBar = () => state.tab === 'today'
  ? `<div class="top top--slim"><span class="top__eyebrow">Сегодня</span>${gear}</div>`
  : `<div class="top"><h1 class="top__title">${esc(TITLES[state.tab] || '')}</h1>${gear}</div>`;

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

const gapLabel = (ms) => {
  const h = Math.round(ms / 3_600_000);
  return h >= 3 ? `${h} ч` : '';
};

function renderToday(f) {
  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate() + 1);

  const todays = state.tasks
    .filter((t) => t.at >= startOfDay.getTime() && t.at < endOfDay.getTime())
    .sort((a, b) => a.at - b.at);

  const active = todays.filter((t) => !t.done);
  const done   = todays.filter((t) => t.done);
  const nextId = active.find((t) => t.at >= now.getTime())?.id ?? null;
  const closed = todays.length > 0 && active.length === 0;

  // Незакрытое с прошлых дней. Раньше оно не показывалось нигде: человек
  // записал дело, не сделал, и оно молча исчезало — для напоминалки это
  // худшее, что может случиться.
  const overdue = state.tasks
    .filter((t) => !t.done && t.at < startOfDay.getTime())
    .sort((a, b) => a.at - b.at);

  // флаг «только что отмечено» живёт ровно один кадр — он подсвечивает
  // строку, чтобы глаз проследил, куда она уехала
  const flashId = state.flash;
  state.flash = null;

  const weekday = now.toLocaleDateString('ru-RU', { weekday: 'long' });
  const dateNum = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

  const subText = todays.length === 0
    ? (overdue.length ? 'на сегодня ничего' : 'свободный день')
    : closed
      ? 'всё сделано — отдыхайте'
      : `осталось ${deeds(active.length)}`;

  // late — дело с прошлого дня: вместо часов показываем «вчера, 15:00»,
  // иначе непонятно, откуда оно взялось
  const row = (t, extra = '', late = false) => `
    <li class="task ${t.done ? 'task--done' : ''} ${t.id === flashId ? 'task--flash' : ''} ${extra}" data-id="${esc(t.id)}">
      <button class="task__check" data-act="toggle" aria-pressed="${t.done}"
              aria-label="${t.done ? 'Отменить' : 'Отметить'} «${esc(t.title)}»">
        ${svg(ICON.check)}
      </button>
      <div class="task__body">
        <div class="task__time">${late ? esc(whenLabel(t.at)) : hhmm(t.at)}</div>
        <div class="task__title">${esc(t.title)}</div>
        ${t.note ? `<div class="task__note">${esc(t.note)}</div>` : ''}
      </div>
    </li>`;

  // лента дня: между делами — воздух по фактическому разрыву
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

  let placed = false;
  for (const t of active) {
    if (!placed && t.at >= now.getTime()) { push(now.getTime(), nowLine(now)); placed = true; }
    push(t.at, row(t, t.id === nextId ? 'task--next' : ''));
  }
  if (active.length && !placed) push(now.getTime(), nowLine(now));

  const dayBlock = active.length ? `
    <div class="section"><h2 class="section__name">День</h2></div>
    <div class="list${f}"><ul class="timeline">${items}</ul></div>` : '';

  const doneBlock = done.length ? `
    <div class="section">
      <h2 class="section__name">Сделано</h2>
      <span class="section__meta">${done.length}</span>
    </div>
    <div class="list list--done${f}"><ul class="timeline timeline--flat">${
      done.map((t) => row(t)).join('')}</ul></div>` : '';

  const overdueBlock = overdue.length ? `
    <div class="section">
      <h2 class="section__name section__name--late">Просрочено</h2>
      <span class="section__meta">${overdue.length}</span>
    </div>
    <div class="list list--late${f}"><ul class="timeline timeline--flat">${
      overdue.map((t) => row(t, '', true)).join('')}</ul></div>` : '';

  const body = (todays.length || overdue.length)
    ? overdueBlock + dayBlock + doneBlock
    : emptyState(f);
  const pct = todays.length ? Math.round((done.length / todays.length) * 100) : 0;

  root.innerHTML = `
    ${topBar()}
    <section class="hero${closed ? ' hero--closed' : ''}${f}">
      <h2 class="hero__date">${esc(dateNum)}</h2>
      <p class="hero__sub${closed ? ' hero__sub--done' : ''}">
        ${closed ? svg(ICON.check) : ''}${esc(weekday)} · ${esc(subText)}
      </p>
      ${todays.length ? `<div class="hero__bar"><i style="width:${pct}%"></i></div>` : ''}
    </section>
    ${body}
    <div class="add-bar">
      <button class="add-btn" data-act="add">${svg(ICON.plus)}Добавить</button>
    </div>`;
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

/* ---------- Листы ---------- */

const sheets = {
  add:      document.getElementById('sheet'),
  settings: document.getElementById('settings'),
  task:     document.getElementById('task-sheet'),
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

function openAdd() {
  state.editing = null;
  form.reset();
  form.elements.time.value = defaultTime();
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
  form.elements.time.value = hhmm(t.at);
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
}

/* ---------- Действия ---------- */

/* Новое дело и изменённое идут одним путём: форма одна, отличается только
   тем, есть ли state.editing. У просроченного дела при изменении сохраняется
   его прежняя дата — меняем только часы, иначе оно молча прыгнет на сегодня. */
async function saveTask(title, note, time) {
  const [h, m] = time.split(':').map(Number);
  const old = state.editing ? state.tasks.find((x) => x.id === state.editing) : null;
  const d = old ? new Date(old.at) : new Date();
  d.setHours(h, m, 0, 0);

  await db.put(old
    ? { ...old, title: title.trim(), note: note.trim(), at: d.getTime() }
    : {
        id: db.newId(),
        title: title.trim(),
        note: note.trim(),
        at: d.getTime(),
        done: false,
        doneAt: null,
        createdAt: Date.now(),
      });
  state.editing = null;
  await refresh();
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
  t.at = d.getTime();
  await db.put(t);
  state.flash = id;
  await refresh();
}

async function deleteTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
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
  if (tabBtn) { state.tab = tabBtn.dataset.tab; fresh = true; render(); return; }

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

    // действия над делом из листа, открытого долгим нажатием
    const id = state.sheetTask;
    if (a === 'edit') { if (id) openEdit(id); return; }
    if (a === 'move') { closeSheets(); if (id) await moveTask(id); return; }
    if (a === 'delete') { closeSheets(); if (id) await deleteTask(id); return; }
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

scrim.addEventListener('click', closeSheets);
document.getElementById('sheet-cancel').addEventListener('click', closeSheets);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = form.elements.title.value;
  if (!title.trim()) return;
  await saveTask(title, form.elements.note.value, form.elements.time.value);
  closeSheets();
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

/* ---------- Старт ---------- */

applyAppearance();
refresh();

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

  if (state.tab !== 'today') return;
  if (rolled) { refresh(); return; }
  if (crossed) { render(); return; }

  const label = root.querySelector('.now__label');
  if (label) label.textContent = hhmm(now);
}, 30_000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
