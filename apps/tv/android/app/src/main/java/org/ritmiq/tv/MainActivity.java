package org.ritmiq.tv;

import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        // Sin el brillo de "fin de scroll": trabajo extra de GPU en el onn.
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        // Respetar <meta viewport width=1280>: la UI se maqueta a 1280×720 y se
        // escala a la pantalla (antes 960×540 por la densidad 2x: todo enorme).
        WebSettings settings = webView.getSettings();
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        // Atrás del mando: lo decide la interfaz (cerrar ventana → overlay →
        // pantalla anterior → Inicio → doble pulsación). "exit" manda la app
        // al fondo; la música sigue sonando.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(window.__ritmiqTvBack ? window.__ritmiqTvBack() : 'exit')",
                    value -> { if ("\"exit\"".equals(value)) moveTaskToBack(true); });
            }
        });
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        String name = null;
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                name = "next";
                break;
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                name = "prev";
                break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                name = "playpause";
                break;
            default:
                break;
        }
        if (name == null) return super.dispatchKeyEvent(event);
        if (event.getAction() == KeyEvent.ACTION_UP && event.getRepeatCount() == 0) {
            getBridge().getWebView().evaluateJavascript(
                "window.__ritmiqTvKey && window.__ritmiqTvKey('" + name + "')", null);
        }
        return true;
    }
}
