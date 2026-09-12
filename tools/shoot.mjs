/* Снимок экрана «Сегодня» в разных состояниях.

   node tools/shoot.mjs обычный              — как выглядит день
   node tools/shoot.mjs тёмная 1200          — вторым числом высота окна
   node tools/shoot.mjs закрытый
   node tools/shoot.mjs пустой

   Файлы кладутся в tools/out/. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, seedExpr, DEMO_DAY, DEMO_LATE, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');

const CASES = {
  обычный:    { tasks: DEMO_DAY, dark: false, height: 880 },
  тёмная:     { tasks: DEMO_DAY, dark: true,  height: 880 },
  закрытый:   { tasks: DEMO_DAY.map((t) => ({ ...t, done: true })), dark: false, height: 880 },
  просрочено: { tasks: DEMO_LATE, dark: false, height: 1180 },
  пустой:     { tasks: [], dark: false, height: 760 },
};

const [name = 'обычный', height] = process.argv.slice(2);
const c = CASES[name];
if (!c) {
  console.error(`Не знаю состояние «${name}». Есть: ${Object.keys(CASES).join(', ')}`);
  process.exit(1);
}

const w = Number(height) || c.height;
const browser = await open({ port: 8099, out: OUT, width: 400, height: w });

await browser.navigate(browser.url);
await sleep(1000);
await browser.evalIn(seedExpr(c.tasks));
await browser.setSystemTheme(c.dark ? 'dark' : 'light');
await browser.navigate(browser.url);
await sleep(1500);

const file = await browser.shot(name);
console.log(browser.problems.length ? 'ПРОБЛЕМЫ:\n' + browser.problems.join('\n') : 'консоль чистая');
console.log('→', file);

await browser.close();
process.exit(0);
