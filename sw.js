/* ============================================================
   Service worker.
   Офлайн-оболочка — этап 1. Приём push — начало этапа 3:
   сначала надо выяснить, доходит ли push до телефона вообще.
   ============================================================ */

const CACHE = 'napominalka-v5';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './manifest.json',
  './icons/icon.svg',

  /* Шрифт кладётся в кэш сразу, а не подтягивается при первом показе:
     он нужен на первом же экране, и без него приложение открылось бы
     системным шрифтом, а через мгновение перерисовалось — то есть
     ровно тем миганием, от которого уходили.

     Подмножеств три, и все три здесь: браузер берёт из кэша только нужное
     ему по unicode-range, лишнее просто лежит. Знак рубля — в latin-ext,
     без него суммы схлопнулись бы в системный шрифт на ровном месте. */
  './fonts/golos.css',
  './fonts/golos-text-cyrillic.woff2',
  './fonts/golos-text-latin-ext.woff2',
  './fonts/golos-text-latin.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Сначала кэш, но с обновлением в фоне.

   Раньше здесь был чистый «кэш-первым»: приложение открывалось мгновенно,
   но правки в styles.css и app.js не доходили до установленного приложения
   никогда — кэш отдавал старую версию, а имя кэша менялось только вместе
   с этим файлом. Отдаём сохранённое сразу и тут же тянем свежее, чтобы
   следующее открытие было уже новым. Цена — одна устаревшая загрузка. */
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);

    /* cache: 'no-cache' — не «не кэшировать», а «переспросить сайт,
       можно ли взять из кэша». Без этого фоновое обновление упиралось
       в HTTP-кэш браузера: GitHub Pages разрешает держать файлы 10 минут,
       и правка, выложенная только что, могла снова лечь в кэш старой.
       Тогда новая версия приходила не со второго открытия, а с третьего —
       и выглядело это как «не обновилось». */
    const fromNet = fetch(request, { cache: 'no-cache' }).then((res) => {
      if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
      return res;
    });

    if (hit) {
      fromNet.catch(() => {});   // ответ уже отдан, сеть просто догоняет
      return hit;
    }

    try {
      return await fromNet;
    } catch {
      // первый заход без сети и без кэша — показываем оболочку
      return (await cache.match('./index.html')) || Response.error();
    }
  })());
});

/** Найти дело по номеру.

    Сервер шлёт только номер — случайную строку, по которой понять нечего.
    Что за дело, знает только телефон: он его у себя и находит. Названия
    и заметки наружу не уходят ни в каком виде.

    База открывается **без номера версии** намеренно. С номером он должен был
    бы совпадать с db.js, а версия уже дублируется в стенде — третьего места,
    где она может разойтись, заводить не надо. Без номера открывается то,
    что есть сейчас, и обновление схемы ничего здесь не ломает. */
function findTask(id) {
  return new Promise((resolve) => {
    const rq = indexedDB.open('napominalka');
    rq.onerror = () => resolve(null);
    rq.onsuccess = () => {
      try {
        const r = rq.result.transaction('tasks', 'readonly').objectStore('tasks').get(id);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      } catch { resolve(null); }
    };
  });
}

/* Приём push.

   Пока задача одна: показать, что пуш дошёл, и во сколько. Время
   берётся здесь, а не в тексте пуша, намеренно: разница между
   «отправлено» на компьютере и этим временем и есть задержка
   доставки — то, ради чего проверка и затевается.

   Текст из пуша показываем, если он есть. Первый шаг идёт без
   текста: пуш без полезной нагрузки не надо шифровать, а значит
   и ломаться в нём нечему.

   Кнопки «Готово» и «Позже» — то, ради чего уведомление вообще стоит
   показывать поверх всего: отметку ставят не открывая приложения.

   Сводка за день, повтор для важных и настройка «Позже через N минут» —
   дальше, на этапе 3. */
self.addEventListener('push', (e) => {
  let data = null;
  try { data = e.data && e.data.json(); } catch { data = null; }

  e.waitUntil((async () => {
    /* Три случая, и они разные.

       1. Пришёл номер дела — так шлёт наш сервер. Дело ищем у себя.
       2. Пришёл готовый заголовок — так шлют проверки из tools/. Нужен,
          чтобы проверять доставку, не заводя дел.
       3. Не пришло ничего — пуш без нагрузки. Тоже проверка: показывает
          время доставки, по нему и меряется задержка. */
    let title = data?.title || 'Напоминалка';
    let body = data?.body || 'Пуш дошёл в ' + new Date().toLocaleTimeString('ru-RU');
    let tag = 'napominalka-check';

    if (data?.id) {
      const task = await findTask(data.id);
      // Дела нет или оно уже сделано — будить не о чем. Молчание здесь
      // правильное: человек его удалил или закрыл, и напоминать не о чем.
      if (!task || task.done) return;
      title = task.title;
      body = [hhmm(task.at), task.note].filter(Boolean).join(' · ');
      /* Метчик — номер дела. Иначе второе уведомление молча съест первое:
         Android считает одинаковые метчики одним уведомлением и заменяет
         без звука. Проверено и записано в §6 плана. */
      tag = 'task-' + task.id;
    }

    await self.registration.showNotification(title, {
      body,
      tag,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',

      /* Две кнопки — предел Chrome: третью он отбрасывает молча.
         Поддерживает ли их Android — проверяем, на компьютере они есть. */
      actions: [
        { action: 'done', title: 'Готово' },
        { action: 'later', title: 'Позже' },
      ],
    });
  })());
});

/** Время в том же виде, что и в ленте: «15:00». */
function hhmm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* Тап по уведомлению открывает приложение, а не новую вкладку
   поверх уже открытой. Нажатие на кнопку вместо этого показывает
   маленькое подтверждение: на этом шаге важно увидеть, что нажатие
   вообще дошло и какое именно.

   На этапе 3 подтверждение заменят настоящие действия: «Готово»
   закроет дело в базе, «Позже» — перенесёт на N минут. */
self.addEventListener('notificationclick', (e) => {
  const action = e.action;
  e.notification.close();

  e.waitUntil((async () => {
    if (action) {
      await self.registration.showNotification('Кнопка дошла', {
        body: 'Нажато: ' + action,
        tag: 'napominalka-check',
        icon: './icons/icon-192.png',
      });
      return;
    }

    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  })());
});
