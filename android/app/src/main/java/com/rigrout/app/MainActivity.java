package com.rigrout.app;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Expose one narrowly-scoped native capability to the trusted local
        // app shell. Driving Mode uses it to prevent the screen from locking;
        // the flag is removed immediately when Driving Mode ends.
        getBridge().getWebView().addJavascriptInterface(new ScreenControl(), "RigRoutNative");
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
