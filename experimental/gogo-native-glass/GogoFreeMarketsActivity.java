package com.gathin.tvhome;

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.KeyEvent;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.FrameLayout;

/**
 * Free personal-use on-demand TradingView markets screen.
 *
 * The native launcher never creates a WebView. This Activity loads an official
 * branded TradingView widget ONLY when the user selects Markets in Launcher
 * Settings, and destroys it when closed.
 */
public final class GogoFreeMarketsActivity extends Activity {
    private WebView widget;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(0xFF08131B);
        setContentView(frame);

        widget = new WebView(this);
        widget.setBackgroundColor(0xFF08131B);
        widget.getSettings().setJavaScriptEnabled(true);
        widget.getSettings().setDomStorageEnabled(true);
        widget.getSettings().setAllowFileAccess(false);
        widget.getSettings().setAllowContentAccess(false);
        widget.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        widget.getSettings().setMediaPlaybackRequiresUserGesture(true);
        widget.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Never navigate away from the markets screen via an accidental remote press.
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(
                    WebView view, android.webkit.WebResourceRequest request) {
                // The official widget loads its own resources. External top-level
                // navigations are blocked, subresources remain loadable.
                return request.isForMainFrame();
            }
        });
        frame.addView(widget, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        widget.loadUrl("file:///android_asset/gogo_tv_free_markets.html");
    }

    @Override protected void onResume() {
        super.onResume();
        if (widget != null) widget.onResume();
    }

    @Override protected void onPause() {
        if (widget != null) widget.onPause();
        super.onPause();
    }

    @Override protected void onDestroy() {
        if (widget != null) {
            widget.stopLoading();
            widget.loadUrl("about:blank");
            widget.removeAllViews();
            widget.destroy();
            widget = null;
        }
        super.onDestroy();
    }
}
