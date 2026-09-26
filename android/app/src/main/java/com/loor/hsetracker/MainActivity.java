package com.loor.hsetracker;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onBackPressed() {
        try {
            android.webkit.WebView w = getBridge().getWebView();
            if (w != null && w.canGoBack()) { w.goBack(); return; }
        } catch (Exception e) {}
        super.onBackPressed();
    }
}
