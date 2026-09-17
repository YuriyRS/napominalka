/* Снимки экрана для карточки в магазине.

   node tools/shots.mjs

   Кладёт в rustore/screenshots/ шесть картинок 1080×1920 — те экраны,
   по которым человек решает, ставить приложение или нет.

   Почему снимаем сами, а не фотографируем телефон: магазин требует,
   чтобы на снимках был настоящий интерфейс и надписи на русском.
   У нас интерфейс и есть русский, а снимает его тот же стенд, которым
   мы проверяем приложение, — значит, снимки не могут разойтись с тем,
   что человек увидит после установки. Фотография с телефона разошлась бы:
   на ней были бы часы, заряд батареи и обои.

   Размер: 1080×1920. Экран 360×640 точек при тройной плотности — это
   и есть 1080×1920, и это ровно тот размер, который магазин называет
   обычным для вертикальных снимков. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, seedExpr, DEMO_DAY, DEMO_MONTH, DEMO_SUBS, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'rustore', 'screenshots');
const WORK = path.join(ROOT, 'tools', 'out', 'shots');

fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const b = await open({ port: 8123, out: WORK, width: 360, height: 640, scale: 3 });
const READY = `document.querySelectorAll('.nav__item').length === 4`;

/** Открыть приложение с нужным набором дел и снять экран. */
async function shot(name, { seed, after }) {
  await b.navigate(b.url);
  await b.waitFor(READY, { timeout: 20_000 });
  if (seed) {
    // набор — либо дела, либо пара [дела, подписки]
    await b.evalIn(Array.isArray(seed[0]) ? seedExpr(seed[0], seed[1]) : seedExpr(seed));
    await b.navigate(b.url);
    await b.waitFor(READY, { timeout: 20_000 });
  }
  if (after) await after();
  await sleep(700);   // дать доиграть появлению карточек
  await b.shot(name);
  const from = path.join(WORK, name + '.png');
  fs.copyFileSync(from, path.join(SHOTS, name + '.png'));
  console.log('снято:', name);
}

const tap = (sel) => b.evalIn(`document.querySelector('${sel}').click()`);

await shot('1-сегодня', { seed: DEMO_DAY });

await shot('2-месяц', {
  seed: DEMO_MONTH,
  after: () => tap('[data-tab="month"]'),
});

/* Поиск — не украшение карточки, а ответ на вопрос «зачем это мне».
   На снимке видно, что дела можно найти по слову из заметки. */
await shot('3-поиск', {
  seed: DEMO_DAY,
  after: async () => {
    await tap('[data-tab="month"]');
    await sleep(400);
    await b.evalIn(`(() => {
      const i = document.getElementById('month-search');
      i.value = 'пятёрочке';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  },
});

/* Засев принимает два набора: дела и подписки. Здесь нужны только
   подписки — и первым доводом идёт пустой список дел, иначе он
   принял бы подписки за дела и экран вышел бы пустым. */
await shot('4-подписки', {
  seed: [[], DEMO_SUBS],
  after: () => tap('[data-tab="subs"]'),
});

await shot('5-год', {
  seed: DEMO_MONTH,
  after: () => tap('[data-tab="year"]'),
});

await shot('6-новое-дело', {
  seed: DEMO_DAY,
  after: async () => {
    await tap('#add-bar button');
    await sleep(600);
  },
});

await b.close();

/* Проверяем размер: магазин принимает не всякий, а переснимать потом
   дороже, чем посчитать сейчас. */
for (const f of fs.readdirSync(SHOTS)) {
  const buf = fs.readFileSync(path.join(SHOTS, f));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w !== 1080 || h !== 1920) throw new Error(`${f}: ${w}×${h}, а нужно 1080×1920`);
}
console.log(`снимков: ${fs.readdirSync(SHOTS).length}, все 1080×1920`);
