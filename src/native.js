/* Всё, что приложение делает через телефон, а не через браузер.

   Отдельным файлом, потому что это единственный кусок, который
   не работает в браузере: он тянет за собой плагины Capacitor, а тех
   в браузере нет. Приложение подгружает его только внутри приложения —
   динамическим импортом и под проверкой, — и в браузере файл просто
   не читается. Поэтому же он один собирается сборщиком: остальной код
   остаётся обычными модулями без единой зависимости.

   Здесь только напоминания. Всё остальное — задачи, подписки, голос —
   живёт в IndexedDB и работает одинаково и в браузере, и в телефоне.

   Про сам будильник. В браузере телефон будит служба push: приложение
   закрыто, разбудить его изнутри нечем, поэтому есть сервер-будильник.
   В приложении сервер не нужен вовсе: система разрешает приложению
   назначить будильник самой, и он сработает, даже когда приложение
   закрыто и телефон спит. Это и есть та причина, по которой мы вообще
   взялись за сборку APK. */

import { LocalNotifications } from '@capacitor/local-notifications';

/* Два канала, а не один с настройкой. Android запрещает менять звук
   у существующего канала: человек один раз выбрал — и всё, навсегда.
   Обойти это можно только новым каналом, поэтому их два, по одному
   на каждый вариант, и в уведомлении указывается нужный. */
const CHANNEL_CHIME = 'domovoy-chime';
const CHANNEL_PLAIN = 'domovoy-plain';

const ACTION_TYPE = 'domovoy-task';

/* На сколько откладывается дело по кнопке «Позже». Десять минут —
   не настройка, а догадка: столько нужно, чтобы дойти до компьютера
   или договорить по телефону. Когда появится выбор в настройках,
   сюда придёт его значение. */
export const SNOOZE_MS = 10 * 60_000;

/* Сколько будильников держим назначенными. Android не запрещает
   и больше, но у дела на каждый день за год наберётся триста
   с лишним штук, а через месяц они все равно пересчитаются при
   первом же открытии. Сотни хватает с запасом: это три месяца
   ежедневного дела или сотня обычных. */
const MAX_ALARMS = 100;

/** Номер будильника для системы.

    Android опознаёт будильник числом, а у нас номера дел — строки.
    Отсюда свёртка: из строки получается число, всегда одинаковое
    для одного и того же дела — иначе снять будильник было бы нечем.

    Совпадение двух номеров у разных дел теоретически возможно и означало
    бы, что второе дело вытеснило первое. На сотне дел вероятность
    порядка одной миллионной; проверять её дороже, чем пережить. */
function alarmId(taskId) {
  let h = 0x811c9dc5;
  for (let i = 0; i < taskId.length; i++) {
    h ^= taskId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h & 0x7fffffff) || 1;
}

/** Что показать в уведомлении, кроме названия дела.
    Заметка, если она есть: без неё напоминание повторяет название,
    которое человек и так видит. Голосовая заметка в уведомление
    не влезает — там только кнопка прослушать в самом приложении. */
function bodyOf(task) {
  const note = (task.note || '').trim();
  if (!note) return 'Пора';
  return note.length > 90 ? note.slice(0, 89).trimEnd() + '…' : note;
}

/** Разрешение на уведомления. Отдельным вызовом, потому что спрашивать
    его надо в свой момент, а не при первом запуске: сначала человек
    должен увидеть приложение и понять, что оно делает. */
export async function permission() {
  try {
    const { display } = await LocalNotifications.checkPermissions();
    return display;
  } catch {
    return 'denied';
  }
}

export async function ask() {
  try {
    const { display } = await LocalNotifications.requestPermissions();
    return display;
  } catch {
    return 'denied';
  }
}

/** Каналы уведомлений. Звук выбирает человек, и от этого зависит,
    какой канал понадобится; ненужный сносим, чтобы он не висел
    в настройках телефона лишним пунктом. */
async function ensureChannels(sound) {
  const wanted = sound === 'chime' ? CHANNEL_CHIME : CHANNEL_PLAIN;
  const other = sound === 'chime' ? CHANNEL_PLAIN : CHANNEL_CHIME;

  const channel = {
    id: wanted,
    name: 'Напоминания',
    description: 'Дела, у которых назначено время',
    /* Четвёрка — «высокая важность»: уведомление всплывает поверх
       и играет звуком. Ниже — молча лежало бы в шторке, и напоминание
       перестало бы быть напоминанием. */
    importance: 4,
    vibration: true,
    lights: true,
  };

  if (sound === 'chime') {
    /* Полный адрес ресурса, а не просто имя файла. Имя плагин толкует
       по-своему в разных версиях, а готовый android.resource://
       он обязан принять как есть — это и есть штатный способ сослаться
       на файл из res/raw. Файл кладёт tools/chime.mjs. */
    channel.sound = 'android.resource://ru.domovoy.app/raw/domovoy_chime';
  }

  await LocalNotifications.createChannel(channel);
  try { await LocalNotifications.deleteChannel({ id: other }); } catch { /* лишний канал в настройках — не беда */ }
}

/** Кнопки под уведомлением.

    Обе кнопки открывают приложение — так надёжнее. Если пометить
    действие как фоновое, Android выполнит его только пока приложение
    живёт; после того как система его выгрузила, нажатие пропадёт молча,
    а человек будет думать, что дело отмечено. Пусть лучше приложение
    откроется: это видно и не обманывает. */
export async function prepareActions() {
  try {
    await LocalNotifications.registerActionTypes({
      types: [{
        id: ACTION_TYPE,
        actions: [
          { id: 'done', title: 'Готово', foreground: true },
          { id: 'later', title: 'Позже', foreground: true },
        ],
      }],
    });
  } catch { /* без кнопок уведомление всё равно работает */ }
}

/** Пересчитать будильники целиком.

    Именно целиком, а не по одному: список дел меняется и правкой,
    и отметкой, и удалением, и повтором, который досоздаёт вхождения
    сам. Держать соответствие поштучно значило бы повторять здесь все
    правила приложения и разойтись с ними на первой же правке. Снять
    сотню будильников и назначить заново — работа на миллисекунды.

    Ошибка здесь не должна ронять приложение: без напоминаний оно
    остаётся рабочим, и молчаливо сломанным ему быть незачем. */
export async function apply({ tasks, sound }) {
  const now = Date.now();
  try {
    /* Канал — единственное место, где что-то может не получиться:
       например, звук не найдётся. Тогда остаёмся на системном канале:
       напоминание без нашего звука лучше, чем никакого напоминания. */
    let channelId;
    try {
      await ensureChannels(sound);
      if (sound === 'chime') channelId = CHANNEL_CHIME;
    } catch { /* системный канал подставит сам плагин */ }

    const { notifications: pending } = await LocalNotifications.getPending();
    if (pending.length) await LocalNotifications.cancel({ notifications: pending });

    const soon = tasks
      .filter((t) => !t.done && !t.skipped && t.at > now)
      .sort((a, b) => a.at - b.at)
      .slice(0, MAX_ALARMS);

    if (!soon.length) return { scheduled: 0 };

    const notes = soon.map((t) => ({
      id: alarmId(t.id),
      title: t.title,
      body: bodyOf(t),
      /* allowWhileIdle — самое важное слово во всём файле. Без него
         Android откладывает будильник до момента, когда телефон
         решит, что проснулся: ночью это двадцать минут, и напоминание
         приходит «около того». */
      schedule: { at: new Date(t.at), allowWhileIdle: true },
      smallIcon: 'ic_stat_domovoy',
      actionTypeId: ACTION_TYPE,
      extra: { taskId: t.id },
      ...(channelId ? { channelId } : {}),
    }));

    try {
      await LocalNotifications.schedule({ notifications: notes });
    } catch {
      /* Не нашёлся значок для строки состояния — а это уже повод
         не остаться без напоминаний, а показать их со значком
         приложения. Второй заход без значка. */
      await LocalNotifications.schedule({
        notifications: notes.map(({ smallIcon, ...rest }) => rest),
      });
    }
    return { scheduled: soon.length };
  } catch (e) {
    return { scheduled: 0, error: String(e?.message || e) };
  }
}

/** Снять все будильники. Так выключаются напоминания: отозвать
    разрешение обратно приложение не может, а перестать будить — может. */
export async function cancelAll() {
  try {
    const { notifications: pending } = await LocalNotifications.getPending();
    if (pending.length) await LocalNotifications.cancel({ notifications: pending });
    return { cancelled: pending.length };
  } catch (e) {
    return { cancelled: 0, error: String(e?.message || e) };
  }
}

/** Что человек нажал в уведомлении. Приходит и когда приложение было
    закрыто: система запускает его и передаёт нажатие сюда. */
export async function listen(handler) {
  try {
    await LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
      const taskId = e?.notification?.extra?.taskId;
      // Без дела нажатие бессмысленно: чужое уведомление или наше,
      // но от удалённого дела. Молчим — приложение всё равно откроется.
      if (taskId) handler({ action: e.actionId, taskId });
    });
    return true;
  } catch {
    return false;
  }
}
