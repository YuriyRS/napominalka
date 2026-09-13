/* ============================================================
   Хранилище. Всё лежит на телефоне, никуда не отправляется.
   IndexedDB, одна таблица tasks.
   ============================================================ */

const DB_NAME = 'napominalka';
const DB_VERSION = 1;
const STORE = 'tasks';

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
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
