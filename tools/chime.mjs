/* Собирает звук уведомления.

   node tools/chime.mjs <папка res>

   Кладёт res/raw/domovoy_chime.wav — тот самый «свой» звук, который
   человек выбирает в настройках вместо системного.

   Почему свой, а не скачанный: чужой файл пришлось бы тащить в проект
   вместе с лицензией, а нам нужны две ноты. Две ноты — это две синусоиды,
   и написать их короче, чем искать, скачивать и прикладывать лицензию.

   Звук нарочно мягкий. Резкая трель на каждый чих превращает напоминалку
   в раздражитель, а дело-то обычно пустяковое. Две ноты вверх, тихая
   атака, длинный хвост: слышно, но не подскакиваешь.

   Формат — WAV без сжатия. Android его принимает и, что важнее, читает
   без библиотек; mp3 сэкономил бы полсотни килобайт и стоил бы
   возни с кодировщиком. */

import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
if (!OUT) {
  console.error('укажите папку res: node tools/chime.mjs <папка res>');
  process.exit(1);
}

const RATE = 22050;          // половина от «дисковой» — для двух нот за глаза
const SECONDS = 1.15;
const TOTAL = Math.round(RATE * SECONDS);
const bits = new Float64Array(TOTAL);

/* Ноты. До-диез и соль-диез пятой октавы — чистая кварта вверх:
   узнаваемо и не похоже на будильник. Вторая входит с задержкой,
   так звук читается как «дон-дон», а не как один щелчок. */
const NOTES = [
  { at: 0.00, hz: 554.37, gain: 0.50, tau: 0.30 },
  { at: 0.17, hz: 830.61, gain: 0.42, tau: 0.42 },
];

/* Обертоны. Чистая синусоида звучит как пищалка от микроволновки;
   два призвука делают звук похожим на колокольчик. */
const OVERTONES = [
  { mult: 1, gain: 1.0 },
  { mult: 2, gain: 0.30 },
  { mult: 3, gain: 0.10 },
];

for (const note of NOTES) {
  const from = Math.round(note.at * RATE);
  for (let i = from; i < TOTAL; i++) {
    const t = (i - from) / RATE;
    /* Атака в шесть миллисекунд: мгновенное начало щёлкает.
       Обрыв потихому — с оговоркой `t > 0.1`, и это не придирка:
       на самом первом отсчёте огибающая равна нулю по построению,
       и проверка без оговорки обрывала бы ноту, не начав её. Файл
       выходил ровно нужной длины и абсолютно беззвучный. */
    const attack = Math.min(1, t / 0.006);
    const envelope = attack * Math.exp(-t / note.tau) * note.gain;
    if (t > 0.1 && envelope < 1e-4) break;
    for (const o of OVERTONES) {
      bits[i] += Math.sin(2 * Math.PI * note.hz * o.mult * t) * envelope * o.gain;
    }
  }
}

/* Хвост сводим на нет: оборванная на полуслове волна слышна как щелчок
   в конце — тем заметнее, чем тише вокруг. */
const TAIL = Math.round(RATE * 0.12);
for (let i = 0; i < TAIL; i++) {
  bits[TOTAL - 1 - i] *= i / TAIL;
}

let peak = 0;
for (const v of bits) peak = Math.max(peak, Math.abs(v));

/* Ноль здесь означает не тишину, а поломку: ноты есть, звука нет.
   Молча получить беззвучный файл уже довелось — пусть теперь это
   будет отказом с причиной, а не тишиной в телефоне через неделю. */
if (!(peak > 0)) throw new Error('звук вышел беззвучным — нечего записывать');

const scale = 0.82 / peak;

const data = Buffer.alloc(TOTAL * 2);
for (let i = 0; i < TOTAL; i++) {
  const v = Math.max(-1, Math.min(1, bits[i] * scale));
  data.writeInt16LE(Math.round(v * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);          // длина описания формата
header.writeUInt16LE(1, 20);           // без сжатия
header.writeUInt16LE(1, 22);           // моно
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);    // байт в секунду
header.writeUInt16LE(2, 32);           // байт на отсчёт
header.writeUInt16LE(16, 34);          // бит на отсчёт
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

const file = path.join(OUT, 'raw', 'domovoy_chime.wav');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, Buffer.concat([header, data]));

/* Сколько отсчётов вообще звучит. Нужно, чтобы «файл есть» не значило
   «файл годный»: беззвучный WAV отличается от слышимого только этими
   четырьмя байтами на отсчёт, и глазами их не видно. */
let loud = 0;
for (let i = 0; i < TOTAL; i++) if (data.readInt16LE(i * 2)) loud++;

console.log(`звук собран: ${(fs.statSync(file).size / 1024).toFixed(0)} КБ, `
  + `${SECONDS.toFixed(2)} с, громких отсчётов ${Math.round(loud / TOTAL * 100)}%, `
  + `пик ${Math.round(peak * scale * 100)}% шкалы`);
