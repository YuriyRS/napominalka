package ru.domovoy.app;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;

/* Выбор своей мелодии для напоминаний.

   Зачем это отдельный кусок на Java, а не строчка в приложении.

   Уведомление играет звук не само: его проигрывает система, чужими
   руками и из своего процесса. Поэтому звук обязан быть ей доступен —
   а в личную папку приложения она не заглядывает. Годятся только два
   места: звук, вшитый в приложение, и общая медиатека телефона.
   Отсюда весь этот код: выбранный человеком файл надо положить
   в общую медиатеку, и только тогда уведомление сможет его сыграть.

   Кладём в «Звонки», а не в «Музыку»: там ему и место — он теперь
   звук уведомления, и заодно он появится в системном списке звуков,
   откуда его можно будет выбрать и другим приложениям.

   Общение со страницей — через мост addJavascriptInterface, который
   вешает MainActivity. Ответ приходит вызовом window.__domovoySound. */
public class DomovoyNative {

    private static final int REQ_PICK = 4711;
    private static final String PREFS = "domovoy";
    private static final String KEY_URI = "sound_uri";
    private static final String KEY_CHANNEL = "sound_channel";

    private final Activity activity;
    private final WebView web;

    DomovoyNative(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    /** Открыть выбор файла. Вызывается из страницы. */
    @JavascriptInterface
    public void pickSound() {
        activity.runOnUiThread(() -> {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("audio/*");
            try {
                activity.startActivityForResult(intent, REQ_PICK);
            } catch (Exception e) {
                /* На телефоне может не найтись приложения, которое умеет
                   выбирать файлы. Это не поломка приложения, но человеку
                   надо сказать, а не оставить его гадать. */
                reply(error("На телефоне нет выбора файлов: " + e.getMessage()));
            }
        });
    }

    /** Снять свою мелодию: и канал, и копию файла из медиатеки. */
    @JavascriptInterface
    public void removeSound() {
        activity.runOnUiThread(() -> {
            SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String channel = prefs.getString(KEY_CHANNEL, null);
            if (channel != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = activity.getSystemService(NotificationManager.class);
                if (nm != null) nm.deleteNotificationChannel(channel);
            }
            deleteCopy(prefs.getString(KEY_URI, null));
            prefs.edit().remove(KEY_URI).remove(KEY_CHANNEL).apply();
            reply("{\"ok\":true,\"removed\":true}");
        });
    }

    /** Разбор ответа выбора файла. true — запрос наш. */
    boolean onResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_PICK) return false;

        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            // Ничего не выбрали — это не ошибка, а отмена. Молчать о ней
            // нельзя: страница ждёт ответа и без него оставит кнопку
            // в положении «выбираю» навсегда.
            reply("{\"ok\":false,\"cancelled\":true}");
            return true;
        }

        Uri source = data.getData();
        /* Копирование — в отдельный поток: файл бывает на добрых десять
           мегабайт, и делать это в потоке отрисовки значит заморозить
           приложение на время копирования. */
        new Thread(() -> {
            try {
                reply(install(source));
            } catch (Exception e) {
                reply(error(e.getMessage() == null ? e.toString() : e.getMessage()));
            }
        }).start();
        return true;
    }

    /** Положить выбранное в медиатеку и завести канал с этим звуком. */
    private String install(Uri source) throws Exception {
        ContentResolver cr = activity.getContentResolver();
        SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        /* Десятый Android — граница не случайная. До него, чтобы положить
           файл в общую медиатеку, нужно разрешение на запись во всю
           внешнюю память, а его выдают только по системе разрешений
           времени выполнения. Девятый Android вышел в 2018-м, и ради
           него одного тащить ещё одно разрешение и ещё одну ветку —
           плохой размен. Честнее сказать прямо, чем городить. */
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            throw new Exception("на этом Android своя мелодия не заведётся — "
                + "нужен Android 10 или новее");
        }

        String name = displayName(cr, source);
        String previous = prefs.getString(KEY_URI, null);

        ContentValues values = new ContentValues();
        values.put(MediaStore.Audio.Media.DISPLAY_NAME, name);
        // именно уведомление: от этого зависит, в каком системном списке
        // звук появится и как его разложит сам телефон
        values.put(MediaStore.Audio.Media.IS_NOTIFICATION, 1);
        values.put(MediaStore.Audio.Media.IS_RINGTONE, 0);
        values.put(MediaStore.Audio.Media.IS_ALARM, 0);
        values.put(MediaStore.Audio.Media.IS_MUSIC, 0);

        values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_RINGTONES);

        Uri placed = cr.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
        if (placed == null) throw new Exception("медиатека не приняла файл");

        try (InputStream in = cr.openInputStream(source);
             OutputStream out = cr.openOutputStream(placed)) {
            if (in == null || out == null) throw new Exception("файл не читается");
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
        }

        /* Канал заводим новый, а прежний сносим. Переписать звук
           у существующего канала Android не даёт: человек выбрал —
           и всё, навсегда. Поэтому имя канала своё у каждой мелодии. */
        /* Шестнадцатеричный хвост адреса, а не Math.abs от хеша:
           у самого левого хеша модуль даёт отрицательное число, и имя
           канала получило бы минус посреди строки. */
        String channelId = "domovoy-mine-" + Integer.toHexString(placed.toString().hashCode());
        NotificationChannel channel = new NotificationChannel(
            channelId, "Напоминания", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Дела, у которых назначено время");
        channel.enableVibration(true);
        channel.enableLights(true);
        channel.setSound(placed, new AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .build());
        NotificationManager nm = activity.getSystemService(NotificationManager.class);
        if (nm == null) throw new Exception("система не дала канал уведомлений");
        nm.createNotificationChannel(channel);

        String oldChannel = prefs.getString(KEY_CHANNEL, null);
        if (oldChannel != null && !oldChannel.equals(channelId)) {
            nm.deleteNotificationChannel(oldChannel);
        }

        prefs.edit().putString(KEY_URI, placed.toString())
                    .putString(KEY_CHANNEL, channelId).apply();
        deleteCopy(previous);

        JSONObject result = new JSONObject();
        result.put("ok", true);
        result.put("uri", placed.toString());
        result.put("channelId", channelId);
        result.put("name", name);
        return result.toString();
    }

    /** Имя выбранного файла, как его показывает сам телефон. */
    private String displayName(ContentResolver cr, Uri uri) {
        String name = null;
        try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME },
                                 null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int at = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (at >= 0) name = c.getString(at);
            }
        } catch (Exception ignored) { /* имя — украшение, без него обойдёмся */ }

        if (name == null || name.trim().isEmpty()) name = "Моя мелодия";
        /* Имя приходит от чужого приложения: слэши в нём превратили бы
           путь в другой путь, а длинное имя — в невидимую строку. */
        name = name.replace('/', '_').replace('\\', '_').trim();
        if (name.length() > 60) name = name.substring(0, 60);
        return name;
    }

    /** Снести прежнюю копию: иначе каждая примерка оставляла бы в телефоне
        ещё один файл, и через десяток попыток человек нашёл бы у себя
        в «Звонках» мусор, о котором не просил. */
    private void deleteCopy(String uri) {
        if (uri == null) return;
        try {
            activity.getContentResolver().delete(Uri.parse(uri), null, null);
        } catch (Exception ignored) { /* не наша запись или уже удалена */ }
    }

    private static String error(String text) {
        try {
            return new JSONObject().put("ok", false).put("error", text).toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"неизвестная ошибка\"}";
        }
    }

    /** Ответ странице. Только из потока отрисовки: evaluateJavascript
        из чужого потока молча ничего не делает. */
    private void reply(String json) {
        web.post(() -> web.evaluateJavascript(
            "window.__domovoySound && window.__domovoySound(" + json + ")", null));
    }
}
