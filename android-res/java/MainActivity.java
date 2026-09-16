package ru.domovoy.app;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/* Точка входа приложения. Этот файл заменяет собой тот, что кладёт
   Capacitor: в шаблоне он пустой (`public class MainActivity extends
   BridgeActivity {}`), а нам в него нужно одно-единственное действие —
   повесить на страницу мост к выбору звука.

   Мост, а не плагин Capacitor. Плагин пришлось бы регистрировать
   отдельным вызовом, а порядок и способ регистрации в разных версиях
   разные, и проверить это можно только на телефоне. Мост через
   addJavascriptInterface — обычный механизм Android, он одинаков
   во всех версиях и работает ровно так, как написано.

   Сам код выбора лежит в DomovoyNative.java. */
public class MainActivity extends BridgeActivity {

    private DomovoyNative bridge;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /* Мост вешаем сразу после создания: страница к этому моменту
           ещё не загружена, и объект успеет появиться в ней до того,
           как приложение начнёт им интересоваться. */
        WebView web = getBridge().getWebView();
        bridge = new DomovoyNative(this, web);
        web.addJavascriptInterface(bridge, "DomovoyNative");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        /* Сначала спрашиваем мост: он узнаёт свой запрос по номеру
           и отвечает, взял ли его. Чужие запросы уходят дальше, к
           Capacitor, — иначе мы бы сломали всё, что он делает сам. */
        if (bridge != null && bridge.onResult(requestCode, resultCode, data)) return;
        super.onActivityResult(requestCode, resultCode, data);
    }
}
