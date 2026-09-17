/* Собирает папку «всё для выкладки в RuStore».

   node tools/kit.mjs [куда]

   По умолчанию — на рабочий стол. В папке оказывается ровно то, что
   нужно, чтобы заполнить карточку в консоли и отправить приложение:
   инструкция, тексты по отдельным файлам, иконка, снимки экрана.

   Отдельные файлы под каждый текст, а не один общий документ: в консоль
   текст копируют, и общий документ означал бы, что человек выделяет
   мышью кусок и гадает, попал ли в выделение заголовок.

   Ключ подписи сюда не кладётся — он не в репозитории и собирается
   отдельно. Папка с ним не трогается вовсе: этот скрипт пишет поверх
   своей части и никогда не удаляет чужое. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { НАЗВАНИЕ, КРАТКОЕ, ПОЛНОЕ, ЧТО_НОВОГО, НАСТРОЙКИ } from '../rustore/тексты.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RUSTORE = path.join(ROOT, 'rustore');

const OUT = process.argv[2] || path.join(os.homedir(), 'Desktop', 'Домовой в RuStore');
fs.mkdirSync(OUT, { recursive: true });

const write = (rel, text) => {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n', 'utf8');
  return rel;
};

const copy = (from, rel) => {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(from, file);
  return rel;
};

const made = [];

// 1. Инструкция
made.push(copy(path.join(RUSTORE, 'КАК-ВЫЛОЖИТЬ.html'), '1. ПРОЧТИ ПЕРВЫМ.html'));

// 2. Тексты — по файлу на поле
const T = '2. Тексты для карточки';
made.push(write(`${T}/Название.txt`, НАЗВАНИЕ));
made.push(write(`${T}/Краткое описание.txt`, КРАТКОЕ));
made.push(write(`${T}/Полное описание.txt`, ПОЛНОЕ));
made.push(write(`${T}/Что нового.txt`, ЧТО_НОВОГО));
made.push(write(`${T}/Настройки и ссылки.txt`,
  'Это не копируют, а выбирают в консоли:\n\n'
  + НАСТРОЙКИ.map(([k, v]) => `${k}: ${v}`).join('\n')
  + '\n\nИконка и скриншоты — в соседних папках.\n'));

// 3. Иконка
made.push(copy(path.join(RUSTORE, 'иконка-512.png'), '3. Иконка/иконка 512 на 512.png'));

// 4. Снимки экрана
for (const name of fs.readdirSync(path.join(RUSTORE, 'screenshots')).sort()) {
  made.push(copy(path.join(RUSTORE, 'screenshots', name), `4. Скриншоты/${name}`));
}

// 5. Сборка — её ещё нет, и делать вид, что есть, нельзя
made.push(write('5. Сборка для магазина/ГДЕ ВЗЯТЬ.txt',
  `Подписанная сборка появится здесь:
https://github.com/YuriyRS/napominalka/releases/download/rustore/domovoy-release.apk

Она соберётся сама после того, как вы заведёте четыре секрета
(шаг 1 в инструкции). Чтобы не ждать, запустите сборку руками:
Actions → «APK» → Run workflow.

Файл из релиза apk для магазина не годится: он подписан отладочным
ключом, и магазин его не примет.`));

// 6. Ключ — папку создаём, но не наполняем: ключа у скрипта нет
const KEY = path.join(OUT, '6. Ключ подписи');
if (!fs.existsSync(KEY)) {
  fs.mkdirSync(KEY, { recursive: true });
  fs.writeFileSync(path.join(KEY, 'ПОЛОЖИТЕ СЮДА КЛЮЧ И ЗАПИСКУ С ПАРОЛЯМИ.txt'),
    'В этой папке должны лежать три файла:\n'
    + '  домовой.p12        — сам ключ подписи\n'
    + '  ключ-строкой.txt   — он же, строкой, для секрета на GitHub\n'
    + '  ПАРОЛИ.txt         — пароли и отпечаток\n\n'
    + 'Храните их в двух местах, а не только здесь.\n', 'utf8');
  made.push('6. Ключ подписи/');
}

// Карточка для репозитория — из тех же текстов, чтобы не разошлись
const md = `# Карточка приложения для RuStore

Файл собран из \`rustore/тексты.mjs\`. Править надо там: описание,
живущее в двух местах, расходится на первой же правке.

## Название

\`\`\`
${НАЗВАНИЕ}
\`\`\`

Ровно так же приложение называется и на телефоне после установки —
магазин требует, чтобы эти два имени совпадали, и проверяет это.

## Краткое описание

\`\`\`
${КРАТКОЕ}
\`\`\`

${КРАТКОЕ.length} знаков из 80 допустимых.

## Полное описание

\`\`\`
${ПОЛНОЕ}
\`\`\`

## Что нового

\`\`\`
${ЧТО_НОВОГО}
\`\`\`

## Что выбирают в консоли

${НАСТРОЙКИ.map(([k, v]) => `- **${k}:** ${v}`).join('\n')}

## Графика

| Что | Файл | Размер |
|---|---|---|
| Иконка | \`rustore/иконка-512.png\` | 512×512, до 1 МБ |
| Снимки экрана | \`rustore/screenshots/\` | 1080×1920, шесть штук |

Снимки сняты тем же стендом, которым приложение проверяется, — поэтому
на них настоящий интерфейс, а не рисунок. Ни часов, ни заряда батареи,
ни обоев: это снимок экрана, а не фотография телефона.
`;
fs.writeFileSync(path.join(RUSTORE, 'карточка.md'), md, 'utf8');

console.log(`собрано в: ${OUT}`);
for (const f of made) console.log('  ', f);
console.log(`карточка обновлена: rustore/карточка.md`);
console.log(`\nнапоминание: ключ подписи лежит отдельно — скрипт его не трогает`);
