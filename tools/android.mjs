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
  /* Право попросить телефон не экономить на нас. Приложение только тем
     и занято, что будит по времени, а экономия заряда ровно это и
     откладывает: свежеустановленное приложение Android считает редким
     гостем и придерживает его будильники, пока человек им не попользуется.
     Отсюда и «первые напоминания с опозданием, потом вовремя». */
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];

/* ---------- Наш код на Java ----------

   Шаблон Capacitor приходит с пустой MainActivity и без единого класса
   сверх него. Выбор своей мелодии умеет только Android — звук уведомления
   проигрывает система, и файл обязан лежать там, куда она заглядывает.
   Значит, нужен свой код, и кладём мы его прямо в собранный проект:
   android/ не хранится в репозитории, он каждый раз создаётся заново.

   Пакет в наших файлах записан руками, а рядом лежит appId из настроек
   Capacitor. Разойтись они могут только по недосмотру, и тогда проект
   не соберётся с невнятной ошибкой компилятора — поэтому сверяем сами,
   здесь, и говорим человеческими словами. */
const appId = JSON.parse(
  fs.readFileSync(path.join(HERE, '..', 'capacitor.config.json'), 'utf8')).appId;

{
  const JAVA = path.join(HERE, '..', 'android-res', 'java');
  const dir = path.join(ANDROID, 'app', 'src', 'main', 'java', ...appId.split('.'));

  for (const name of fs.readdirSync(JAVA)) {
    const code = fs.readFileSync(path.join(JAVA, name), 'utf8');
    const declared = code.match(/^package\s+([\w.]+);/m)?.[1];
    if (declared !== appId) {
      throw new Error(`${name}: пакет ${declared}, а приложение ${appId}`);
    }
  }

  fs.mkdirSync(dir, { recursive: true });

  /* Что лежало в MainActivity до нас — печатаем. Шаблон может однажды
     перестать быть пустым, и молча стереть чужую строку было бы худшим
     из возможных решений: она бы просто исчезла, и никто бы не заметил. */
  for (const name of ['MainActivity.java', 'MainActivity.kt']) {
    const old = path.join(dir, name);
    if (!fs.existsSync(old)) continue;
    console.log(`--- было в ${name} ---`);
    console.log(fs.readFileSync(old, 'utf8').trim());
    console.log('--- конец ---');
    fs.rmSync(old);   // .kt рядом с нашим .java дал бы два класса с одним именем
  }

  for (const name of fs.readdirSync(JAVA)) {
    fs.copyFileSync(path.join(JAVA, name), path.join(dir, name));
  }
  console.log(`своего кода на Java: ${fs.readdirSync(JAVA).length} файла в ${appId}`);

  /* Разметка и цвета виджета — это ресурсы, и лежат они там же, где
     ресурсы Capacitor. Имена файлов у нас свои (domovoy_widget*),
     поэтому ничего чужого не затирается; совпади они — сборка упала бы
     на двух одинаковых ресурсах, и это лучше, чем тихая подмена. */
  const RES_SRC = path.join(HERE, '..', 'android-res', 'res');
  let res = 0;
  const walk = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); walk(src, dst); continue; }
      if (fs.existsSync(dst)) throw new Error(`ресурс уже занят: ${dst}`);
      fs.copyFileSync(src, dst);
      res++;
    }
  };
  if (fs.existsSync(RES_SRC)) walk(RES_SRC, RES);
  console.log(`ресурсов виджета: ${res}`);
}

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
}

/* Приёмник виджета. Система будит его, когда виджет пора перерисовать,
   и по этому же приёмнику видно, что виджет вообще существует. Без
   записи в манифесте виджет не появится в списке, и гадать, почему,
   придётся долго.

   Имя класса — полное, а не с точкой впереди: точка отсчитывается
   от пакета, а пакет в манифесте теперь не пишут, он задан в сборке. */
const receiver = `<receiver
        android:name="${appId}.DomovoyWidget"
        android:exported="false"
        android:label="@string/domovoy_widget_label">
        <intent-filter>
            <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
        </intent-filter>
        <meta-data
            android:name="android.appwidget.provider"
            android:resource="@xml/domovoy_widget_info" />
    </receiver>`;

if (!xml.includes('DomovoyWidget')) {
  const close = xml.lastIndexOf('</application>');
  if (close < 0) throw new Error('в манифесте нет </application> — шаблон изменился');
  xml = xml.slice(0, close) + '    ' + receiver + '\n\n' + xml.slice(close);
}

fs.writeFileSync(manifest, xml);

console.log(`разрешений в манифесте: ${PERMISSIONS.length}, `
  + `дописано сейчас: ${missing.length}`);
