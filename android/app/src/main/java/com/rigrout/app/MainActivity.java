package com.rigrout.app;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.view.WindowManager;
import java.util.Locale;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private TextToSpeech textToSpeech;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Expose one narrowly-scoped native capability to the trusted local
        // app shell. Driving Mode uses it to prevent the screen from locking;
        // the flag is removed immediately when Driving Mode ends.
        getBridge().getWebView().addJavascriptInterface(new ScreenControl(), "RigRoutNative");
        textToSpeech = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) textToSpeech.setLanguage(Locale.getDefault());
        });
    }

    private class ScreenControl {
        @JavascriptInterface
        public void setKeepScreenOn(boolean enabled) {
            runOnUiThread(() -> {
                if (enabled) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        @JavascriptInterface
        public void speak(String message) {
            if (message == null || message.trim().isEmpty()) return;
            runOnUiThread(() -> {
                if (textToSpeech != null) {
                    textToSpeech.speak(message, TextToSpeech.QUEUE_FLUSH, null, "rigrout-guidance");
                }
            });
        }

        @JavascriptInterface
        public void stopSpeaking() {
            runOnUiThread(() -> { if (textToSpeech != null) textToSpeech.stop(); });
        }
    }

    @Override
    public void onDestroy() {
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
        }
        super.onDestroy();
    }

    // Default Capacitor back-button behavior is: go back in WebView history if
    // any, else finish the activity. RigRout is a single static page with no
    // history entries, so that default always exited straight to the launcher —
    // even with a menu/panel/dialog open. Ask the page what's open first; only
    // fall through to the default (exit) behavior if nothing was closed.
    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript(
                "(function(){try{return window.handleAndroidBack?!!window.handleAndroidBack():false;}catch(e){return false;}})()",
                value -> {
                    if (!"true".equals(value)) {
                        super.onBackPressed();
                    }
                }
            );
        } else {
            super.onBackPressed();
        }
    }
}
