package com.techgenius.tvoslauncher;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Gogo TV hub for tvOS Launcher 2.1.5.
 *
 * Native cards only until the user deliberately opens Markets. There are no
 * live AI requests, hidden network polling or control of the stock Home app.
 * Never stores AskGogo credentials or claims device pairing.
 */
public class GogoHubActivity extends Activity {
    protected FrameLayout root;
    private WebView markets;

    private static final String MARKETS_PAGE =
        "<!doctype html><html><head><meta name='viewport' content='width=device-width, initial-scale=1.0'/>"
      + "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline';"
      + " script-src https://s3.tradingview.com; frame-src https://*.tradingview.com https://*.tradingview-widget.com;"
      + " img-src https://*.tradingview.com https://*.tradingview-widget.com data:;\">"
      + "<style>html,body{background:#091622;color:#fff;margin:0;padding:0;font-family:Arial,sans-serif}"
      + "h1{font-size:42px;font-weight:300;margin:22px 0 10px}"
      + "p{color:#a6bccd;font-size:16px;line-height:1.5}"
      + ".box{border:1px solid #456879;background:#0c2333;border-radius:18px;margin-top:22px;padding:20px}"
      + ".tradingview-widget-container{width:100%}</style></head>"
      + "<body><main style='padding:4vh 5vw'>"
      + "<h1>Gogo Markets</h1><p>TradingView widget • availability and quote delays are provider controlled.</p>"
      + "<div class='box'><div class='tradingview-widget-container'>"
      + "<div class='tradingview-widget-container__widget'></div>"
      + "<div class='tradingview-widget-copyright'>"
      + "<a href='https://www.tradingview.com/' rel='noopener nofollow' target='_blank'>"
      + "Track all markets on TradingView</a></div>"
      + "<script type='text/javascript' src='https://s3.tradingview.com/external-embedding/"
      + "embed-widget-ticker-tape.js' async>"
      + "{\"symbols\":[{\"proName\":\"NSE:NIFTY\",\"title\":\"Nifty 50\"},"
      + "{\"proName\":\"BSE:SENSEX\",\"title\":\"Sensex\"},"
      + "{\"proName\":\"NSE:BANKNIFTY\",\"title\":\"Bank Nifty\"},"
      + "{\"proName\":\"NASDAQ:NDX\",\"title\":\"Nasdaq 100\"},"
      + "{\"proName\":\"SP:SPX\",\"title\":\"S&P 500\"},"
      + "{\"proName\":\"DJ:DJI\",\"title\":\"Dow Jones\"},"
      + "{\"proName\":\"OANDA:XAUUSD\",\"title\":\"Gold\"},"
      + "{\"proName\":\"FX_IDC:USDINR\",\"title\":\"USD/INR\"}],"
      + "\"showSymbolLogo\":true,\"isTransparent\":true,\"displayMode\":\"adaptive\","
      + "\"colorTheme\":\"dark\",\"locale\":\"en\"}</script></div></div>"
      + "<p>Some symbols may be unavailable or delayed. Press Back to return to Gogo TV.</p></main></body></html>";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0A1925);
        setContentView(root);
        showHub();
    }

    protected int dp(int amount) {
        return Math.round(amount * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable surface(boolean focus) {
        GradientDrawable bg = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{focus ? 0xFF205772 : 0xFF173B50,
                          focus ? 0xFF0C3045 : 0xFF102535});
        bg.setCornerRadius(dp(16));
        bg.setStroke(dp(1), focus ? 0xCC99DCFF : 0x6686B7D4);
        return bg;
    }

    protected TextView title(String value, int size, int color) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextColor(color);
        text.setTextSize(size);
        text.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        return text;
    }

    protected void addAction(LinearLayout column, String heading, String description, Runnable action) {
        LinearLayout button = new LinearLayout(this);
        button.setOrientation(LinearLayout.VERTICAL);
        button.setPadding(dp(18), dp(10), dp(18), dp(10));
        button.setFocusable(true);
        button.setClickable(true);
        button.setBackground(surface(false));
        button.setOnFocusChangeListener((v, focus) -> v.setBackground(surface(focus)));
        TextView name = title(heading, 22, Color.WHITE);
        TextView detail = title(description, 13, 0xCCBCD5E4);
        button.addView(name);
        LinearLayout.LayoutParams detailLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        detailLp.topMargin = dp(5);
        button.addView(detail, detailLp);
        button.setOnClickListener(v -> action.run());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(8);
        column.addView(button, lp);
    }

    protected boolean marketsOpen() { return markets != null; }

    protected void closeMarkets() {
        if (markets != null) {
            if (markets.getParent() instanceof ViewGroup)
                ((ViewGroup) markets.getParent()).removeView(markets);
            markets.stopLoading();
            markets.destroy();
            markets = null;
        }
    }

    protected void showHub() {
        closeMarkets();
        root.removeAllViews();
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(60), dp(36), dp(60), dp(24));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        root.addView(column, lp);

        TextView heading = title("Gogo TV", 42, Color.WHITE);
        column.addView(heading);
        TextView sub = title("Personal intelligence and entertainment",
                16, 0xFFB2CFDF);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(-1,-2);
        subLp.topMargin = dp(4);
        subLp.bottomMargin = dp(22);
        column.addView(sub, subLp);

        Intent companion = getPackageManager().getLeanbackLaunchIntentForPackage("in.askgogo.tvhub");
        if (companion != null) {
            addAction(column, "Open Gogo TV companion", "AskGogo, Markets and TV controls",
                    () -> {
                        try { startActivity(companion); }
                        catch (ActivityNotFoundException | SecurityException ignored) { showHub(); }
                    });
            column.getChildAt(2).requestFocus();
            return;
        }

        addAction(column, "Markets",
                "Free branded TradingView view • opens only when selected",
                this::openMarkets);

        addAction(column, "AskGogo",
                "Open the existing assistant. Secure TV voice pairing is not yet enabled.",
                this::openAskGogo);

        addAction(column, "Phone remote",
                "Open your existing Couch TV setup and paired phone remote",
                this::openCouchRemote);

        TextView note = title("This is an optional module. Your tvOS Home, weather, "
                + "wallpapers and app focus are unchanged.", 13, 0xFFA6BAC7);
        column.addView(note);
        column.getChildAt(2).requestFocus();
    }

    private void openAskGogo() {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://app.askgogo.in")));
        } catch (ActivityNotFoundException | SecurityException e) {
            new android.app.AlertDialog.Builder(this)
                    .setTitle("AskGogo")
                    .setMessage("There is no TV browser installed. For now, open "
                            + "https://app.askgogo.in on your phone. "
                            + "Secure TV pairing and hands-free voice are separate upcoming modules.")
                    .setPositiveButton(android.R.string.ok, null).show();
        }
    }

    protected void openCouchRemote() {
        try {
            Intent launch = getPackageManager().getLeanbackLaunchIntentForPackage(
                    "dev.couchtv.ontv");
            if (launch == null) launch = getPackageManager()
                    .getLaunchIntentForPackage("dev.couchtv.ontv");
            if (launch == null) {
                new android.app.AlertDialog.Builder(this)
                        .setMessage("Couch TV is unavailable on this Android TV.")
                        .setPositiveButton(android.R.string.ok, null).show();
            } else {
                startActivity(launch);
            }
        } catch (ActivityNotFoundException | SecurityException e) {
            new android.app.AlertDialog.Builder(this)
                    .setMessage("Unable to open the Couch TV remote app.")
                    .setPositiveButton(android.R.string.ok, null).show();
        }
    }

    protected void openMarkets() {
        closeMarkets();
        markets = new WebView(this);
        markets.setBackgroundColor(0xFF091622);
        markets.getSettings().setJavaScriptEnabled(true);
        markets.getSettings().setDomStorageEnabled(true);
        markets.getSettings().setAllowFileAccess(false);
        markets.getSettings().setAllowContentAccess(false);
        markets.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        markets.getSettings().setSupportMultipleWindows(false);
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(markets, false);
        markets.getSettings().setMediaPlaybackRequiresUserGesture(true);
        markets.setWebChromeClient(new WebChromeClient());
        markets.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request.isForMainFrame();
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String host = url.getHost();
                if ("https".equals(url.getScheme()) && host != null &&
                        (host.equals("tradingview.com") || host.endsWith(".tradingview.com") ||
                         host.equals("tradingview-widget.com") || host.endsWith(".tradingview-widget.com"))) return null;
                return new android.webkit.WebResourceResponse("text/plain", "UTF-8",
                        new java.io.ByteArrayInputStream(new byte[0]));
            }
        });
        root.removeAllViews();
        LinearLayout marketPage = new LinearLayout(this);
        marketPage.setOrientation(LinearLayout.VERTICAL);
        marketPage.setPadding(dp(22), dp(10), dp(22), dp(10));
        root.addView(marketPage, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout bar = new LinearLayout(this);
        marketPage.addView(bar);
        addAction(bar, "TradingView", "Open official market charts in your browser", () -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.tradingview.com/markets/"))); }
            catch (ActivityNotFoundException | SecurityException ignored) {
                android.widget.Toast.makeText(this, "Open tradingview.com/markets on your phone", android.widget.Toast.LENGTH_LONG).show();
            }
        });
        bar.getChildAt(0).requestFocus();
        marketPage.addView(markets, new LinearLayout.LayoutParams(-1, 0, 1));
        markets.loadDataWithBaseURL("https://tvhub.invalid/",
                MARKETS_PAGE, "text/html", "UTF-8", null);
    }

    @Override
    public void onBackPressed() {
        if (markets != null) {
            showHub();
        } else {
            super.onBackPressed();
        }
    }

    @Override protected void onDestroy() {
        closeMarkets();
        super.onDestroy();
    }
}
