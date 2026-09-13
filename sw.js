/* ============================================================
   Service worker.
   Задача этапа 1 — офлайн-оболочка. Приём push добавим
   на этапе 3, когда появится сервер-будильник.
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
