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
public final class GogoHubActivity extends Activity {
    private FrameLayout root;
    private WebView markets;

    private static final String MARKETS_PAGE =
        "<!doctype html><html><head><meta name='viewport' content='width=device-width, initial-scale=1.0'/>"
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
      + "<p>Some symbols may be unavailable or delayed. This screen does not use the Twelve Data API."
      + " Press Back to return to Gogo TV.</p></main></body></html>";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0A1925);
        setContentView(root);
        showHub();
    }

    private int dp(int amount) {
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

    private TextView title(String value, int size, int color) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextColor(color);
        text.setTextSize(size);
        text.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        return text;
    }

    private void addAction(LinearLayout column, String heading, String description, Runnable action) {
        LinearLayout button = new LinearLayout(this);
        button.setOrientation(LinearLayout.VERTICAL);
        button.setPadding(dp(18), dp(15), dp(18), dp(15));
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
        lp.bottomMargin = dp(14);
        column.addView(button, lp);
    }

    private void showHub() {
        if (markets != null) {
            root.removeView(markets);
            markets.stopLoading();
            markets.destroy();
            markets = null;
        }
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

        addAction(column, "Markets",
                "Free branded TradingView view • opens only when selected",
                this::openMarkets);

        addAction(column, "AskGogo",
                "Same Brain via WhatsApp OTP, private session and push-to-talk.",
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
        // Local, first-party TV screen: no browser app required.
        startActivity(new Intent(this, GogoBrainActivity.class));
    }

    private void openCouchRemote() {
        try {
            Intent launch = getPackageManager().getLeanbackLaunchIntentForPackage(
                    "dev.couchtv.ontv");
            if (launch == null) launch = getPackageManager()
                    .getLaunchIntentForPackage("dev.couchtv.ontv");
            if (launch == null) {
                new android.app.AlertDialog.Builder(this)
                        .setMessage("Couch TV isn't available in this launcher profile.")
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

    private void openMarkets() {
        markets = new WebView(this);
        markets.setBackgroundColor(0xFF091622);
        markets.getSettings().setJavaScriptEnabled(true);
        markets.getSettings().setDomStorageEnabled(true);
        markets.getSettings().setAllowFileAccess(false);
        markets.getSettings().setAllowContentAccess(false);
        markets.getSettings().setMediaPlaybackRequiresUserGesture(true);
        markets.setWebChromeClient(new WebChromeClient());
        markets.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request.isForMainFrame();
            }
        });
        root.removeAllViews();
        root.addView(markets, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        markets.loadDataWithBaseURL("https://www.tradingview.com/",
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
        if (markets != null) {
            markets.stopLoading();
            markets.destroy();
            markets = null;
        }
        super.onDestroy();
    }
}
