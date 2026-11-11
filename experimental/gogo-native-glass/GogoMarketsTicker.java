package com.gathin.tvhome;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Locale;

/**
 * GogoTV markets: a tiny non-focusable status label, NOT a WebView. Never
 * fetches data or performs expensive work in the app dock's focus callback.
 *
 * Disabled by default. Only HTTPS JSON supplied by a separately licensed
 * feed is displayed. No scraping of stock exchanges or invented market quotes.
 */
final class GogoMarketsTicker {
    private static final long REFRESH_MS = 15L * 60_000L;
    private static final long ROTATE_MS = 10_000L;
    private static final long LIMIT_AGE_MS = 24L * 60L * 60_000L;
    private static final String TAG = "GogoMarkets";
    private static final DateTimeFormatter AS_OF =
            DateTimeFormatter.ofPattern("d MMM h:mm a", Locale.ENGLISH)
                    .withZone(ZoneId.of("Asia/Kolkata"));

    private GogoMarketsTicker() {}

    static void attach(Activity activity, FrameLayout root) {
        JSONObject config = GogoTvSettings.readConfig(activity);
        SharedPreferences settings =
                activity.getSharedPreferences(Config.SETTINGS_NAME, Context.MODE_PRIVATE);
        boolean enabled = settings.getBoolean("gogo_markets_enabled",
                config.optBoolean("gogo_markets_enabled", false));
        if (!enabled) return;
        String endpoint = settings.getString("gogo_markets_url",
                config.optString("gogo_markets_url", "")).trim();
        if (!GogoTvSettings.isSafeFeedUrl(endpoint)) {
            Log.w(TAG, "Markets enabled but no HTTPS endpoint configured");
            return;
        }

        TextView label = new TextView(activity);
        label.setTextColor(Color.WHITE);
        label.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        label.setTextSize(14f);
        label.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        label.setPadding(dp(activity, 12), dp(activity, 7), dp(activity, 12), dp(activity, 7));
        label.setMaxLines(2);
        label.setFocusable(false);
        label.setClickable(false);
        label.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        label.setText("Markets · Connecting");
        GradientDrawable background = new GradientDrawable();
        background.setColor(0x7D101C28);
        background.setCornerRadius(dp(activity, 12));
        background.setStroke(dp(activity, 1), 0x44FFFFFF);
        label.setBackground(background);
        FrameLayout.LayoutParams placement = new FrameLayout.LayoutParams(
                dp(activity, 330), ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.END);
        placement.topMargin = dp(activity, 102);
        placement.rightMargin = dp(activity, 55);
        root.addView(label, placement);

        Ticker ticker = new Ticker(activity, label, endpoint);
        label.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
            @Override public void onViewAttachedToWindow(View v) { ticker.start(); }
            @Override public void onViewDetachedFromWindow(View v) { ticker.stop(); }
        });
        if (label.isAttachedToWindow()) ticker.start();
    }

    private static final class Quote {
        final String symbol, source, stamp;
        final double value, pct;
        Quote(String symbol, double value, double pct, String source, String stamp) {
            this.symbol=symbol; this.value=value; this.pct=pct;
            this.source=source; this.stamp=stamp;
        }
    }

    private static final class Ticker {
        private final Activity activity;
        private final TextView label;
        private final String endpoint;
        private final Handler main = new Handler(Looper.getMainLooper());
        private final ArrayList<Quote> quotes = new ArrayList<>();
        private int nextIndex;
        private boolean started, inFlight;
        private long lastFetch;
        private int failures;
        private final Runnable cycle = new Runnable() {
            @Override public void run() {
                if (!started || !label.isAttachedToWindow()) return;
                if (!quotes.isEmpty()) {
                    Quote quote = quotes.get(nextIndex % quotes.size());
                    nextIndex++;
                    String value = new DecimalFormat("#,##0.00",
                            DecimalFormatSymbols.getInstance(Locale.US)).format(quote.value);
                    String delta = (quote.pct >= 0 ? "+" : "") +
                            new DecimalFormat("0.00",
                                    DecimalFormatSymbols.getInstance(Locale.US)).format(quote.pct);
                    label.setText(quote.symbol + "  " + value + "  " + delta + "%\n" +
                            quote.source + " · As of " + quote.stamp + " IST");
                }
                if (!inFlight && (lastFetch == 0L ||
                        System.currentTimeMillis()-lastFetch >= REFRESH_MS)) {
                    fetchAsync();
                }
                main.postDelayed(this, ROTATE_MS);
            }
        };

        Ticker(Activity activity, TextView label, String endpoint) {
            this.activity=activity; this.label=label; this.endpoint=endpoint;
        }
        void start() {
            if (started) return;
            started=true;
            main.post(cycle);
        }
        void stop() {
            started=false;
            main.removeCallbacks(cycle);
        }
        void fetchAsync() {
            inFlight=true;
            lastFetch=System.currentTimeMillis();
            Thread worker = new Thread(() -> {
                ArrayList<Quote> fresh = read(endpoint);
                main.post(() -> {
                    inFlight=false;
                    if (!started || !label.isAttachedToWindow()) return;
                    if (fresh != null && !fresh.isEmpty()) {
                        quotes.clear();
                        quotes.addAll(fresh);
                        failures=0;
                        nextIndex=0;
                        main.removeCallbacks(cycle);
                        main.post(cycle);
                    } else {
                        failures++;
                        if (quotes.isEmpty()) label.setText("Markets · Feed unavailable\nNo prices displayed");
                        if (failures < 4) lastFetch = System.currentTimeMillis() - REFRESH_MS + 30_000L;
                    }
                });
            }, "gogo-markets-fetch");
            worker.setDaemon(true);
            worker.start();
        }
    }

    static ArrayList<Quote> read(String endpoint) {
        if (!GogoTvSettings.isSafeFeedUrl(endpoint)) return null;
        HttpURLConnection conn=null;
        try {
            conn = (HttpURLConnection) new URL(endpoint).openConnection();
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(5000);
            conn.setInstanceFollowRedirects(false);
            if (conn.getResponseCode() != 200) {
                Log.w(TAG, "Markets feed HTTP " + conn.getResponseCode());
                return null;
            }
            JSONObject json;
            try (InputStream stream=conn.getInputStream();
                 ByteArrayOutputStream bytes=new ByteArrayOutputStream()) {
                byte[] chunk=new byte[2048];
                int n;
                while ((n=stream.read(chunk)) >= 0) {
                    if (bytes.size()+n > 64*1024) return null;
                    bytes.write(chunk, 0, n);
                }
                json=new JSONObject(bytes.toString("UTF-8"));
            }
            if (!json.optBoolean("licensedForDisplay", false)) {
                Log.w(TAG, "Provider must mark feed licensedForDisplay");
                return null;
            }
            String source = json.optString("source","").trim();
            if (source.isEmpty() || source.length()>30) return null;
            JSONArray items=json.optJSONArray("quotes");
            if (items==null || items.length()>16) return null;
            ArrayList<Quote> out=new ArrayList<>();
            for (int i=0; i<items.length();i++) {
                JSONObject item=items.optJSONObject(i);
                if(item==null) continue;
                String symbol=item.optString("symbol","").trim();
                String stamped=item.optString("asOf","").trim();
                if(symbol.isEmpty() || symbol.length()>22 ||
                        !item.has("value") || !item.has("changePct")) continue;
                double value=item.optDouble("value", Double.NaN);
                double pct=item.optDouble("changePct", Double.NaN);
                if(!Double.isFinite(value) || value <= 0 ||
                        !Double.isFinite(pct) || Math.abs(pct)>100) continue;
                try {
                    Instant ts=OffsetDateTime.parse(stamped).toInstant();
                    long age=System.currentTimeMillis()-ts.toEpochMilli();
                    if(age < -5*60_000L || age > LIMIT_AGE_MS) continue;
                    out.add(new Quote(symbol,value,pct,source,AS_OF.format(ts)));
                } catch(Exception ignored) { /* Never mislabel an undated quote as live. */ }
            }
            return out;
        } catch(Exception e) {
            Log.w(TAG,"Market fetch failed",e);
            return null;
        } finally {
            if(conn!=null) conn.disconnect();
        }
    }

    private static int dp(Activity activity,int n) {
        return Math.round(n*activity.getResources().getDisplayMetrics().density);
    }
}
