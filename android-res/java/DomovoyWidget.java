package ru.domovoy.reminder;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/* Виджет «дела на сегодня».

   Зачем он тут, а не в приложении: напоминалка, которую видно каждый раз,
   когда берёшь телефон, — это другие отношения с ней. Открывать ради
   этого приложение никто не станет.

   Данные виджету приносит приложение. Само оно их взять не может:
   дела лежат в памяти страницы, в IndexedDB, и чужая программа туда
   не заглянет. Поэтому при каждом изменении список дел уезжает сюда
   строкой в настройки — на неделю вперёд, а не на сегодня. Тогда виджет
   сам выбирает сегодняшний день, и правильно показывает его даже в том
   случае, если приложение неделю не открывали.

   Чего виджет не умеет: отмечать дела сделанными. Нажатие открывает
   приложение — и это осознанно. Виджет живёт на чужой территории,
   его рисует чужая программа, и всё, что он умеет, ограничено тем,
   что эта программа согласна нарисовать. Кнопки в нём были бы видны
   не везде и работали бы не всегда. */
public class DomovoyWidget extends AppWidgetProvider {

    private static final int ROWS = 4;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    /** Перерисовать все плитки. Зовётся из приложения, когда дела
        изменились, и по расписанию — раз в полчаса. */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : idsOf(context)) manager.updateAppWidget(id, build(context));
    }

    /** Стоит ли виджет на рабочем столе. Спрашиваем, чтобы не учить
        человека ставить то, что уже стоит. */
    static boolean isPlaced(Context context) {
        return idsOf(context).length > 0;
    }

    private static int[] idsOf(Context context) {
        return AppWidgetManager.getInstance(context)
            .getAppWidgetIds(new ComponentName(context, DomovoyWidget.class));
    }

    /* Отрисовку заворачиваем в try целиком, и это не перестраховка.

       Виджет рисует не приложение, а рабочий стол. Если мы бросим
       исключение у него на глазах, он просто ничего не покажет — и это
       неотличимо от «виджет не поставился». Человек будет искать плитку,
       которой нет, хотя на самом деле она есть и молчит. Лучше показать
       честную надпись. */
    private static RemoteViews build(Context context) {
        try {
            return render(context);
        } catch (Throwable e) {
            RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.domovoy_widget);
            try {
                view.setViewVisibility(R.id.domovoy_widget_empty, View.VISIBLE);
                view.setTextViewText(R.id.domovoy_widget_empty, "Откройте приложение");
            } catch (Throwable ignored) { /* и это не вышло — пустая плитка */ }
            return view;
        }
    }

    private static RemoteViews render(Context context) {
        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.domovoy_widget);

        /* Нажатие в любом месте открывает приложение. Флаг IMMUTABLE
           обязателен с двенадцатого Android: без него система не примет
           намерение вовсе. */
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open != null) {
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            view.setOnClickPendingIntent(R.id.domovoy_widget_root, PendingIntent.getActivity(
                context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }

        for (int i = 1; i <= ROWS; i++) {
            view.setViewVisibility(rowId(i), View.GONE);
        }

        Today today;
        try {
            today = slice(context);
        } catch (Exception e) {
            /* Разобрать не вышло — значит, запись побита. Молчать об этом
               нельзя: пустой виджет человек прочитает как «дел нет»,
               а дел может быть полно. */
            view.setTextViewText(R.id.domovoy_widget_head, "Домовой");
            view.setTextViewText(R.id.domovoy_widget_left, "");
            view.setTextViewText(R.id.domovoy_widget_empty, "Откройте приложение");
            view.setViewVisibility(R.id.domovoy_widget_empty, View.VISIBLE);
            return view;
        }

        view.setViewVisibility(R.id.domovoy_widget_empty, View.VISIBLE);

        if (today.stale) {
            view.setTextViewText(R.id.domovoy_widget_left, "");
            view.setTextViewText(R.id.domovoy_widget_empty, "Откройте приложение");
            return view;
        }

        view.setTextViewText(R.id.domovoy_widget_left, today.left == 0 ? ""
            : "осталось " + today.left);

        if (today.items.isEmpty()) {
            view.setTextViewText(R.id.domovoy_widget_empty, context.getString(
                today.doneAny ? R.string.domovoy_widget_done_all
                              : R.string.domovoy_widget_empty));
            return view;
        }

        view.setViewVisibility(R.id.domovoy_widget_empty, View.GONE);

        SimpleDateFormat clock = new SimpleDateFormat("HH:mm", Locale.getDefault());
        int shown = Math.min(today.items.size(), ROWS);
        for (int i = 0; i < shown; i++) {
            Today.Item item = today.items.get(i);
            view.setViewVisibility(rowId(i + 1), View.VISIBLE);
            view.setTextViewText(timeId(i + 1), clock.format(new Date(item.at)));
            view.setTextViewText(titleId(i + 1), item.title);
        }
        return view;
    }

    private static int rowId(int n) {
        switch (n) {
            case 1: return R.id.domovoy_widget_row1;
            case 2: return R.id.domovoy_widget_row2;
            case 3: return R.id.domovoy_widget_row3;
            default: return R.id.domovoy_widget_row4;
        }
    }

    private static int timeId(int n) {
        switch (n) {
            case 1: return R.id.domovoy_widget_time1;
            case 2: return R.id.domovoy_widget_time2;
            case 3: return R.id.domovoy_widget_time3;
            default: return R.id.domovoy_widget_time4;
        }
    }

    private static int titleId(int n) {
        switch (n) {
            case 1: return R.id.domovoy_widget_title1;
            case 2: return R.id.domovoy_widget_title2;
            case 3: return R.id.domovoy_widget_title3;
            default: return R.id.domovoy_widget_title4;
        }
    }

    /** Сегодняшний день из того, что прислало приложение. */
    private static Today slice(Context context) throws Exception {
        SharedPreferences prefs = DomovoyNative.prefs(context);
        Today today = new Today();

        String raw = prefs.getString(DomovoyNative.KEY_WIDGET, null);
        if (raw == null) {
            today.stale = true;
            return today;
        }

        JSONArray rows = new JSONObject(raw).optJSONArray("rows");
        if (rows == null) {
            today.stale = true;
            return today;
        }

        Calendar start = Calendar.getInstance();
        start.set(Calendar.HOUR_OF_DAY, 0);
        start.set(Calendar.MINUTE, 0);
        start.set(Calendar.SECOND, 0);
        start.set(Calendar.MILLISECOND, 0);
        long from = start.getTimeInMillis();
        long to = from + 24L * 60 * 60 * 1000;

        long newest = 0;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            long at = row.optLong("at");
            if (at > newest) newest = at;
            if (at < from || at >= to) continue;

            if (row.optInt("done") == 1) { today.doneAny = true; continue; }
            today.left++;
            today.items.add(new Today.Item(at, row.optString("title")));
        }

        /* Ничего впереди — значит, присланное кончилось. Показывать
           вместо этого пустоту значило бы сказать «дел нет» там, где
           их просто не видно. Список приходит на неделю вперёд, так что
           до этого доходит только приложение, забытое на неделю. */
        if (newest < System.currentTimeMillis()) today.stale = true;
        return today;
    }

    private static class Today {
        final java.util.List<Item> items = new java.util.ArrayList<>();
        int left;
        boolean doneAny;
        boolean stale;

        static class Item {
            final long at;
            final String title;

            Item(long at, String title) {
                this.at = at;
                this.title = title == null || title.isEmpty() ? "Без названия" : title;
            }
        }
    }
}
