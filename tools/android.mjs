/* Готовит проект Android к сборке: значки, звук и разрешения.

   node tools/android.mjs android

   Проект android/ не хранится в репозитории — его каждый раз создаёт
   Capacitor из шаблона, и в шаблоне всего этого нет: значок от Capacitor,
   ни одного разрешения сверх интернета. Поэтому после каждого создания
   проекта сюда надо зайти и доложить своё. Один шаг вместо трёх —
   потому что забыть один из трёх легче, чем все три сразу.

   Разрешения просит Android, а не мы. Каждое из них — не галочка
   на всякий случай, а условие работы:

     RECORD_AUDIO          без него не пишется голосовая заметка
     POST_NOTIFICATIONS    с тринадцатого Android без него нет уведомлений
     SCHEDULE_EXACT_ALARM  будильник в назначенную минуту, а не «когда-нибудь»
     USE_EXACT_ALARM       то же самое, но без похода в настройки (см. ниже)
     VIBRATE               вибрация уведомления
     WAKE_LOCK             разбудить телефон ради уведомления
     RECEIVE_BOOT_COMPLETED  вернуть будильники после перезагрузки

   Про два будильника сразу. Начиная с четырнадцатого Android первое
   разрешение по умолчанию не выдаётся: человек должен сам найти
   в настройках пункт «Будильники и напоминания» и разрешить. Для
   приложения, которое только тем и занято, что будит по времени,
   это лишний шаг, о котором никто не догадывается, — и напоминания
   молча опаздывают. Второе разрешение система выдаёт сама, но только
   приложениям, у которых будильник и есть назначение. Наше — из них.
   Если однажды соберёмся в Google Play, этот пункт придётся объяснять
   на модерации: там его выдают не всем. */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ANDROID = process.argv[2];
if (!ANDROID) {
  console.error('укажите папку проекта: node tools/android.mjs android');
  process.exit(1);
}

const RES = path.join(ANDROID, 'app', 'src', 'main', 'res');
if (!fs.existsSync(RES)) throw new Error(`не похоже на проект Android: ${ANDROID}`);

for (const script of ['icon.mjs', 'chime.mjs']) {
  const run = spawnSync(process.execPath, [path.join(HERE, script), RES], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`${script} не отработал`);
}

const PERMISSIONS = [
  'android.permission.RECORD_AUDIO',
  /* Без этого одного разрешения микрофон не работает, хотя доступ выдан
     и RECORD_AUDIO на месте: WebView пишет в журнал «Requires
     MODIFY_AUDIO_SETTINGS and RECORD_AUDIO. No audio device will be
     available for recording» и отказывает в микрофоне, показывая при этом
     системный вопрос и получая согласие. В Capacitor 1–2 оно лежало
     в шаблоне, в третьей версии его убрали — и запись голоса перестала
     работать у всех, кто собирал приложение на голом шаблоне. */
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];

const manifest = path.join(ANDROID, 'app', 'src', 'main', 'AndroidManifest.xml');
let xml = fs.readFileSync(manifest, 'utf8');

/* Ставим перед <application>, а не после <manifest>: порядок внутри
   манифеста значения не имеет, но так видно, что это наши строки,
   а не часть шаблона. */
const missing = PERMISSIONS.filter((p) => !xml.includes(`"${p}"`));
if (missing.length) {
  const block = missing.map((p) => `    <uses-permission android:name="${p}" />`).join('\n');
  const at = xml.indexOf('<application');
  if (at < 0) throw new Error('в манифесте нет <application> — шаблон изменился');
  xml = xml.slice(0, at) + block + '\n\n' + xml.slice(at);
  fs.writeFileSync(manifest, xml);
}

console.log(`разрешений в манифесте: ${PERMISSIONS.length}, `
  + `дописано сейчас: ${missing.length}`);
