/* Собирает папку www/ — то, что уедет внутрь APK.

   node tools/www.mjs

   Приложение лежит в корне репозитория вместе с сервером, стендом и планом.
   Завернуть в APK весь корень нельзя: туда попадёт лишнее, а внутрь телефона
   лишнее класть не надо. Поэтому собираем список нужного — и он обязан
   совпадать со списком офлайн-кэша в sw.js: оба отвечают на один вопрос,
   что нужно приложению, чтобы работать.

   Самого sw.js в списке нет намеренно. В приложении, установленном
   на телефон, сервис-воркер не нужен: файлы лежат внутри, кэшировать нечего.
   И вреден: он начал бы отдавать сохранённое вместо свежего — то есть
   ровно то, от чего мы избавлялись в браузере. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'www');

const FILES = ['index.html', 'app.js', 'db.js', 'styles.css', 'manifest.json'];
const DIRS = ['icons', 'fonts'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let bytes = 0;
const size = (p) => {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    return fs.readdirSync(p).reduce((sum, f) => sum + size(path.join(p, f)), 0);
  }
  return st.size;
};

for (const f of FILES) {
  fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
  bytes += size(path.join(ROOT, f));
}
for (const d of DIRS) {
  fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });
  bytes += size(path.join(ROOT, d));
}

console.log(`собрано www/: ${FILES.length + DIRS.length} записей, ${Math.round(bytes / 1024)} КБ`);
