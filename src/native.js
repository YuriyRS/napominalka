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
   на каждый вариант, и в уведомлении указывается нужный.

   Номер версии в имени — не украшение. Канал с прежним именем уже создан
   на телефоне, и звук у него не тот: пересоздать его с новым звуком
   Android не даст, он просто оставит прежний. Чтобы смена звука дошла
   до телефона, имя должно быть другим. Прежние имена перечислены ниже
   и сносятся за ненадобностью. */
const CHANNEL_CHIME = 'domovoy-remind-chime-v2';
const CHANNEL_PLAIN = 'domovoy-remind-plain-v2';
const CHANNEL_STALE = ['domovoy-chime', 'domovoy-plain'];

/* Два вида уведомлений, и кнопки у них разные. У дела — «Готово»
   и «Позже», у подписки — «Оплачено»: события разные, и одно действие
   на оба случая только запутало бы. */
const ACTION_TASK = 'domovoy-task';
const ACTION_SUB = 'domovoy-sub';

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
    /* Имя файла без пути и без расширения — так, как назывался бы
       ресурс в коде (R.raw.domovoy_chime). Плагин сам собирает из него
       адрес android.resource://…/raw/…, и в какой бы версии он это
       ни делал, имя подставляется одно и то же.

       Здесь уже была ошибка: я передавал готовый адрес целиком, решив,
       что так надёжнее. Плагин подставил его в середину своего адреса,
       адрес вышел неразрешимый, и «свой звук» играл тишиной — уведомление
       приходило, телефон вибрировал, а звука не было. Молча. Файл кладёт
       tools/chime.mjs. */
    channel.sound = 'domovoy_chime';
  }

  await LocalNotifications.createChannel(channel);
  for (const id of [other, ...CHANNEL_STALE]) {
    try { await LocalNotifications.deleteChannel({ id }); } catch { /* лишний канал в настройках — не беда */ }
  }
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
      types: [
        {
          id: ACTION_TASK,
          actions: [
            { id: 'done', title: 'Готово', foreground: true },
            { id: 'later', title: 'Позже', foreground: true },
          ],
        },
        {
          id: ACTION_SUB,
          actions: [
            /* Одна кнопка, а не две. Вторая неизбежно была бы либо
               «отменить подписку» — слишком круто для нажатия вслепую
               из шторки, — либо повторением первой. */
            { id: 'paid', title: 'Оплачено', foreground: true },
          ],
        },
      ],
    });
  } catch { /* без кнопок уведомление всё равно работает */ }
}

/** Показать одно уведомление прямо сейчас — кнопка «Проверить» рядом
    с выбором звука. Без неё выбрать звук невозможно: оба варианта
    выглядят одинаково — одинаково тихо — пока не услышишь. */
export async function trySound(sound) {
  try {
    await ensureChannels(sound);
    await LocalNotifications.schedule({
      notifications: [{
        id: alarmId('проверка-звука'),
        title: 'Так будет звучать напоминание',
        body: 'Это проверка. Настоящее придёт в назначенную минуту',
        schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
        smallIcon: 'ic_stat_domovoy',
        ...(sound === 'chime' ? { channelId: CHANNEL_CHIME } : {}),
      }],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Пересчитать будильники целиком.

    Именно целиком, а не по одному: список дел меняется и правкой,
    и отметкой, и удалением, и повтором, который досоздаёт вхождения
    сам. Держать соответствие поштучно значило бы повторять здесь все
    правила приложения и разойтись с ними на первой же правке. Снять
    сотню будильников и назначить заново — работа на миллисекунды.

    Ошибка здесь не должна ронять приложение: без напоминаний оно
    остаётся рабочим, и молчаливо сломанным ему быть незачем. */
export async function apply({ items, sound }) {
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

    const soon = items.slice(0, MAX_ALARMS);
    if (!soon.length) return { scheduled: 0 };

    const notes = soon.map((it) => ({
      id: alarmId(it.id),
      title: it.title,
      body: it.body,
      /* allowWhileIdle — самое важное слово во всём файле. Без него
         Android откладывает будильник до момента, когда телефон
         решит, что проснулся: ночью это двадцать минут, и напоминание
         приходит «около того». */
      schedule: { at: new Date(it.at), allowWhileIdle: true },
      smallIcon: 'ic_stat_domovoy',
      actionTypeId: it.kind === 'sub' ? ACTION_SUB : ACTION_TASK,
      extra: { kind: it.kind, id: it.id },
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

/** Что у системы на самом деле стоит.

    Не украшение и не отладка: до сих пор приложение никак не показывало,
    назначены будильники или нет, и когда напоминание не приходит, отличить
    «не поставилось» от «поставилось, но система задержала» было нечем.
    Разбираться приходилось догадками. Теперь это видно в настройках. */
export async function pending() {
  try {
    const { notifications } = await LocalNotifications.getPending();
    if (!notifications.length) return { count: 0, at: null };
    /* Считаем ближайшее сами: порядок в ответе не обещан, а полагаться
       на него, не проверив, — тот же способ ошибиться, что и раньше. */
    let at = null;
    for (const n of notifications) {
      const t = n.schedule?.at ? new Date(n.schedule.at).getTime() : null;
      if (t && (at === null || t < at)) at = t;
    }
    return { count: notifications.length, at };
  } catch {
    return { count: 0, at: null };
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
      const extra = e?.notification?.extra;
      // Без опознания нажатие бессмысленно: чужое уведомление или наше,
      // но от удалённого. Молчим — приложение всё равно откроется.
      if (extra?.id) handler({ action: e.actionId, id: extra.id, kind: extra.kind });
    });
    return true;
  } catch {
    return false;
  }
}
