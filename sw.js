/* ============================================================
   Service worker.
   Офлайн-оболочка — этап 1. Приём push — начало этапа 3:
   сначала надо выяснить, доходит ли push до телефона вообще.
   ============================================================ */

const CACHE = 'napominalka-v4';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './manifest.json',
  './icons/icon.svg',
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

/* Приём push.

   Пока задача одна: показать, что пуш дошёл, и во сколько. Время
   берётся здесь, а не в тексте пуша, намеренно: разница между
   «отправлено» на компьютере и этим временем и есть задержка
   доставки — то, ради чего проверка и затевается.

   Текст из пуша показываем, если он есть. Первый шаг идёт без
   текста: пуш без полезной нагрузки не надо шифровать, а значит
   и ломаться в нём нечему.

   Кнопки «Готово» и «Позже», сводка за день и повтор — дальше,
   на этапе 3. */
self.addEventListener('push', (e) => {
  let data = null;
  try { data = e.data && e.data.json(); } catch { data = null; }

  e.waitUntil(self.registration.showNotification(data?.title || 'Напоминалка', {
    body: data?.body || 'Пуш дошёл в ' + new Date().toLocaleTimeString('ru-RU'),
    tag: 'napominalka-check',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
  }));
});

/* Тап по уведомлению открывает приложение, а не новую вкладку
   поверх уже открытой. Для этого же обработчика на этапе 3
   появится разбор кнопок. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    }));
});
