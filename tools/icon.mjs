/* Рисует значки для Android из наших SVG.

   node tools/icon.mjs <куда>

   Значки — единственное, что в приложении нельзя написать текстом:
   Android принимает картинки, а не разметку. Кисти у нас нет, зато
   есть Chrome, который SVG рисует. Поэтому значок каждого размера —
   это снимок страницы tools/icon.html, растянутой ровно на столько
   пикселей, сколько нужно.

   Размеры и имена файлов — не наши выдумки, а требование Android:
   mipmap-* — значок на главном экране, drawable-* — слои адаптивного
   значка и значок для строки состояния. Плотности кратны четырём:
   48/72/96/144/192 — это один и тот же значок для экранов разной
   резкости, и система сама выберет подходящий.

   Ошибка здесь не видна глазом до установки: значок либо есть, либо
   вместо него серая заглушка Android. Поэтому каждый файл проверяется
   на месте и на ненулевой размер. */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { open } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const OUT = process.argv[2];
if (!OUT) {
  console.error('укажите папку: node tools/icon.mjs <куда>');
  process.exit(1);
}

/* Границы непрозрачного в PNG.

   Нужны не для красоты: у адаптивного значка система обрезает всё, что
   вышло за круг поперечником 66% от значка, и вылезший знак теряет углы
   молча. Глазом этого не видно — на снимке знак просто лежит в квадрате,
   а обрежется он только на телефоне. Поэтому считаем по пикселям.

   Разбор ровно того PNG, который отдаёт Chrome: восемь бит на канал,
   RGBA, без чередования. Всё остальное — повод сказать вслух, а не
   догадываться. */
function alphaBox(file) {
  const buf = fs.readFileSync(file);
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  if (buf[24] !== 8 || buf[25] !== 6) throw new Error(`${file}: не RGBA по 8 бит`);

  const parts = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at);
    const kind = buf.toString('ascii', at + 4, at + 8);
    if (kind === 'IDAT') parts.push(buf.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));

  const stride = width * 4;
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  let box = null;
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
  };

  for (let y = 0, at = 0; y < height; y++) {
    const filter = raw[at++];
    for (let i = 0; i < stride; i++) {
      const x = raw[at + i];
      const a = i >= 4 ? line[i - 4] : 0, b = prev[i], c = i >= 4 ? prev[i - 4] : 0;
      line[i] = (filter === 0 ? x
        : filter === 1 ? x + a
        : filter === 2 ? x + b
        : filter === 3 ? x + ((a + b) >> 1)
        : x + paeth(a, b, c)) & 255;
    }
    at += stride;

    for (let px = 0; px < width; px++) {
      if (line[px * 4 + 3] < 8) continue;   // почти прозрачное не считаем
      box = box || { x0: px, x1: px, y0: y, y1: y, far: 0 };
      if (px < box.x0) box.x0 = px;
      if (px > box.x1) box.x1 = px;
      if (y > box.y1) box.y1 = y;
      // Самая дальняя от середины точка, а не угол рамки: у круга углы
      // рамки пустые, и проверка по ним забраковала бы верный значок.
      const d = Math.hypot(px + 0.5 - width / 2, y + 0.5 - height / 2);
      if (d > box.far) box.far = d;
    }
    line.copy(prev);
  }
  return { width, height, box };
}

const DPI = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const PNG = (name, svg, dp) => ({ name, svg, dp });

/* dp — размер в независимых пикселях Android; значок для строки
   состояния по правилам занимает 24dp, слои адаптивного значка 108dp,
   обычный значок на главном экране 48dp. */
const JOBS = [
  ...Object.keys(DPI).map((d) => PNG(`mipmap-${d}/ic_launcher.png`, 'icons/icon.svg', 48)),
  ...Object.keys(DPI).map((d) => PNG(`mipmap-${d}/ic_launcher_round.png`, 'android-res/svg/round.svg', 48)),
  ...Object.keys(DPI).map((d) => PNG(`drawable-${d}/ic_launcher_foreground.png`, 'android-res/svg/fg.svg', 108)),
  ...Object.keys(DPI).map((d) => PNG(`drawable-${d}/ic_launcher_background.png`, 'android-res/svg/bg.svg', 108)),
  ...Object.keys(DPI).map((d) => PNG(`drawable-${d}/ic_stat_domovoy.png`, 'android-res/svg/stat.svg', 24)),
];

/* Адаптивный значок: с восьмого Android форму значку придаёт система,
   и значок — это не картинка, а два слоя и маска поверх них. Файл
   один на все плотности (anydpi): слои те же самые, меняется только
   их разрешение, а его выбирает система. Круглый вариант не отличается
   от обычного — маску в этом случае тоже рисует система, — но имя
   файла должно существовать: манифест ссылается на оба. */
const ADAPTIVE = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>
`;

const ADAPTIVE_NAMES = [
  'mipmap-anydpi-v26/ic_launcher.xml',
  'mipmap-anydpi-v26/ic_launcher_round.xml',
];

const WRITTEN = [...ADAPTIVE_NAMES];

const port = 8791 + (process.pid % 200);
const stand = await open({ port, out: path.join(ROOT, 'tools', 'out', 'icon'), width: 512, height: 512, scale: 1 });

/* Прозрачный фон снимка. По умолчанию Chrome подкладывает белый, и на
   значке для строки состояния это была бы белая плитка вместо галочки. */
await stand.S('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

try {
  await stand.navigate(`${stand.url}tools/icon.html?src=x`);

  for (const job of JOBS) {
    const size = Math.round(job.dp * DPI[job.name.match(/^(?:mipmap|drawable)-(\w+)\//)[1]]);
    await stand.S('Emulation.setDeviceMetricsOverride', {
      width: size, height: size, deviceScaleFactor: 1, mobile: true,
    });
    // Слэш впереди обязателен: страница лежит в tools/, и без него путь
    // к значку отсчитывался бы от неё, а не от корня проекта.
    await stand.evalIn(`document.getElementById('i').src = ${JSON.stringify('/' + job.svg)}; document.title = 'icon';`);
    const ok = await stand.waitFor(`document.title !== 'icon'`);
    if (!ok || await stand.evalIn('document.title') !== 'ready') {
      throw new Error(`не нарисовался: ${job.svg}`);
    }

    const { data } = await stand.S('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(data, 'base64');
    const file = path.join(OUT, job.name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    WRITTEN.push(job.name);
  }

  for (const name of ADAPTIVE_NAMES) {
    const file = path.join(OUT, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ADAPTIVE);
  }

  /* Пустой или обрезанный файл Android примет молча и нарисует заглушку —
     ровно тот случай, когда ошибку ищут глазами на телефоне. */
  for (const name of WRITTEN) {
    const size = fs.statSync(path.join(OUT, name)).size;
    if (size < 100) throw new Error(`подозрительно мал: ${name} — ${size} байт`);
  }

  /* Знак переднего слоя обязан помещаться в безопасную зону: её поперечник
     две трети от значка, то есть радиус — треть ширины. Что вылезло,
     то система срежет, и узнать об этом можно будет только на телефоне. */
  const fg = alphaBox(path.join(OUT, 'drawable-xxxhdpi/ic_launcher_foreground.png'));
  const safe = fg.width / 3;
  if (fg.box.far > safe) {
    throw new Error(`знак вылез за безопасную зону: ${fg.box.far.toFixed(1)} из ${safe.toFixed(1)}`);
  }

  /* Значок строки состояния: Android отводит ему 24dp и сам красит его
     в цвет строки. Пустой или во весь квадрат — одинаково негоден. */
  const stat = alphaBox(path.join(OUT, 'drawable-xxxhdpi/ic_stat_domovoy.png'));
  const share = stat.box.far / (stat.width / 2);
  if (share < 0.5 || share > 0.95) {
    throw new Error(`значок строки состояния занял ${(share * 100).toFixed(0)}% поля`);
  }
  console.log(`знак: ${(fg.box.far / safe * 100).toFixed(0)}% безопасной зоны, `
    + `строка состояния: ${(share * 100).toFixed(0)}% поля`);
} finally {
  await stand.close();
}

console.log(`значков нарисовано: ${WRITTEN.length}`);
