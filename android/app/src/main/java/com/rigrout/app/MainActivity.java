package com.rigrout.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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
