/* ============================================================
   Хранилище. Всё лежит на телефоне, никуда не отправляется.
   IndexedDB: таблица tasks и отдельная таблица voice под звук.
   ============================================================ */

const DB_NAME = 'napominalka';

/* Версия поднята до 2, когда появился звук голосовых заметок.

   Здесь была первая правка схемы за всю историю проекта, и она сделана
   тем порядком, который записан в ПЛАН.md §7:

   1. Поднять версию здесь.
   2. Добавить таблицу **отдельным** `if`, а не внутри проверки на tasks.
      У установленного приложения первая проверка истинна, блок целиком
      пропускается, и вложенное создание не выполнилось бы — молча и без
      ошибки, что хуже всего.
   3. Поправить версию в стенде (tools/cdp.mjs) — он открывает базу
      жёстко, и разойдись они, стенд получит VersionError.
   4. Помнить, что приложение у людей уже установлено: onupgradeneeded
      обязан **добавлять, а не пересоздавать**. Старая база на телефоне
      должна пережить обновление вместе со всеми делами. */
const DB_VERSION = 3;
const STORE = 'tasks';
const VOICE = 'voice';
const SUBS = 'subs';

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        // по времени — чтобы выбирать день одним запросом
        s.createIndex('at', 'at');
      }
      if (!db.objectStoreNames.contains(VOICE)) {
        // без keyPath: ключ задаётся снаружи и совпадает с voice.id в деле
        db.createObjectStore(VOICE);
      }
      // Подписки — не дела, и в таблицу дел их не положить: те читаются
      // все разом и показываются в ленте дня и в календаре, а подписке там
      // делать нечего. Отдельной таблицей, отдельным if — как voice.
      if (!db.objectStoreNames.contains(SUBS)) {
        db.createObjectStore(SUBS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(mode, fn, name = STORE) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(name, mode);
    const store = t.objectStore(name);
    let out;
    try { out = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** Все задачи, отсортированные по времени. */
export function all() {
  return tx('readonly', (s) => s.index('at').getAll());
}

/** Задачи за конкретный день (границы — местная полночь, включительно). */
export async function forDay(date) {
  const from = new Date(date); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 1);
  const range = IDBKeyRange.bound(from.getTime(), to.getTime(), false, true);
  return tx('readonly', (s) => s.index('at').getAll(range));
}

export function put(task) {
  return tx('readwrite', (s) => s.put(task));
}

export function remove(id) {
  return tx('readwrite', (s) => s.delete(id));
}

/** Записать пачку за одну транзакцию.

    У серии повторов на год набирается триста шестьдесят пять записей,
    и поодиночке это триста шестьдесят пять транзакций подряд — заметная
    пауза на ровном месте. Пачкой — одна. */
export function putMany(tasks) {
  if (!tasks.length) return Promise.resolve();
  return tx('readwrite', (s) => { for (const t of tasks) s.put(t); });
}

/** Заменить весь список — нужно для импорта из копии.

    Очистка и запись идут в одной транзакции: раньше между ними можно было
    упасть и остаться с половиной списка. */
export function replaceAll(tasks) {
  return tx('readwrite', (s) => {
    s.clear();
    for (const t of tasks) s.put(t);
  });
}

/** Простой идентификатор. crypto.randomUUID есть не везде, поэтому запасной путь. */
export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------- Подписки ----------

   Сумма хранится в **копейках целым числом**, а не в рублях дробью. Дробь
   в деньгах — это 0.1 + 0.2, и годовой итог из двенадцати подписок рано или
   поздно покажет «9 587.999999999998 ₽». Копейки этого не умеют. */

export function allSubs() {
  return tx('readonly', (s) => s.getAll(), SUBS);
}

export function putSub(sub) {
  return tx('readwrite', (s) => s.put(sub), SUBS);
}

export function removeSub(id) {
  return tx('readwrite', (s) => s.delete(id), SUBS);
}

/** Заменить все подписки — для импорта из копии. */
export function replaceSubs(list) {
  return tx('readwrite', (s) => {
    s.clear();
    for (const x of list) s.put(x);
  }, SUBS);
}

/* ---------- Звук голосовых заметок ----------

   Отдельной таблицей, потому что в таблицу дел его не положить: дела
   читаются все разом при запуске (`all()`), и, лежи звук там же, каждое
   открытие приложения тянуло бы с диска все записи целиком. Дело хранит
   только ссылку — voice.id, описание волны и длительность. */

/** Положить запись. Ключ — тот же id, что лежит в деле. */
export function putVoice(id, blob) {
  return tx('readwrite', (s) => s.put(blob, id), VOICE);
}

/** Достать запись или undefined, если её нет. */
export function getVoice(id) {
  return tx('readonly', (s) => s.get(id), VOICE);
}

/** Запрос к базе как обычный промис.

    Нельзя отдать IDBRequest прямо в Promise.all: в Chrome он сам похож
    на промис, и Promise.all возвращает **не результаты, а сами запросы**.
    Ошибка при этом тихая — падает уже дальше, на попытке что-то с ними
    сделать, и выглядит это как «поле не того типа».

    Оба запроса создаются здесь подряд и в одной транзакции намеренно:
    транзакция закрывается, как только очередь микрозадач опустеет, и
    запрос, созданный внутри .then(), к тому времени уже не примут. */
function req(r) {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/** Все записи разом — для выгрузки в файл копии.
    Ключи и значения идут в одном порядке, поэтому пары собираются по индексу. */
export function allVoice() {
  return tx('readonly', (s) => {
    const keys = req(s.getAllKeys());
    const vals = req(s.getAll());
    return Promise.all([keys, vals]).then(([ids, blobs]) => ids.map((id, i) => [id, blobs[i]]));
  }, VOICE);
}

/** Заменить записи целиком — для импорта из копии. */
export function replaceVoice(pairs) {
  return tx('readwrite', (s) => {
    s.clear();
    for (const [id, blob] of pairs) s.put(blob, id);
  }, VOICE);
}

export function removeVoice(id) {
  return tx('readwrite', (s) => s.delete(id), VOICE);
}

/** Убрать записи, на которые никто не ссылается.

    Так делается намеренно вместо удаления сразу за делом: удалённое дело
    можно вернуть полоской «Вернуть», и если снести звук в момент удаления,
    возвращать будет нечего. Метла проходит при запуске, когда возвращать
    уже нечего по определению. */
export async function sweepVoice(usedIds) {
  const ids = await tx('readonly', (s) => req(s.getAllKeys()), VOICE);
  const dead = ids.filter((id) => !usedIds.has(id));
  if (!dead.length) return 0;
  await tx('readwrite', (s) => { for (const id of dead) s.delete(id); }, VOICE);
  return dead.length;
}
