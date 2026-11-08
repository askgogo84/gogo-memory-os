package in.askgogo.markets;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/** Foreground, opt-in Android 11 overlay; visible only when CleanYourTV is foreground. */
public final class TickerService extends Service {
    static final String START = "in.askgogo.markets.START";
    private static final String CHANNEL = "gogo_markets_background";
    private final Handler main = new Handler(Looper.getMainLooper());
    private WindowManager windowManager;
    private ForegroundTracker tracker;
    private FrameLayout container;
    private WebView tickerWeb;
    private boolean attached = false;
    private boolean initialised = false;
    private final Runnable watchHome = new Runnable() {
        @Override public void run() {
            boolean allowed = Settings.canDrawOverlays(TickerService.this) && ForegroundTracker.permitted(TickerService.this);
            PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
            boolean awake = power != null && power.isInteractive();
            boolean onHome = allowed && awake && tracker != null && tracker.isHome();
            setShown(onHome);
            main.postDelayed(this, 1600L);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Gogo Markets", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Ticker runs only on CleanYourTV Home");
            nm.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, flags);
        Notification.Builder n = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        startForeground(42, n.setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentTitle("Gogo Markets")
            .setContentText("Ticker appears only on the TV Home screen")
            .setContentIntent(pending).setOngoing(true).build());
        tracker = new ForegroundTracker(this);
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (!Settings.canDrawOverlays(this) || !ForegroundTracker.permitted(this)) {
            stopSelf(); return START_NOT_STICKY;
        }
        if (!initialised) {
            initialised = true;
            main.post(watchHome);
        }
        return START_STICKY;
    }

    private void buildOverlay() {
        container = new FrameLayout(this);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] {0xE51A2635, 0xEA111824});
        bg.setCornerRadius(dp(18));
        bg.setStroke(dp(1), 0x995F7280);
        container.setBackground(bg);
        container.setClipToOutline(true);
        tickerWeb = new WebView(this);
        tickerWeb.setBackgroundColor(Color.TRANSPARENT);
        tickerWeb.setVerticalScrollBarEnabled(false);
        tickerWeb.setHorizontalScrollBarEnabled(false);
        WebSettings settings = tickerWeb.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        tickerWeb.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return true; // Prevent invisible overlay navigation to sites.
            }
        });
        container.addView(tickerWeb, new FrameLayout.LayoutParams(-1, -1));
        tickerWeb.loadDataWithBaseURL("https://www.tradingview.com/", getMarkup(), "text/html", "UTF-8", null);
    }

    private String getMarkup() {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(getAssets().open("ticker.html"), StandardCharsets.UTF_8))) {
            StringBuilder out = new StringBuilder();
            String line;
            while ((line = in.readLine()) != null) out.append(line).append('\n');
            return out.toString();
        } catch (IOException e) {
            return "<html><body style='background:#111827;color:white'>Market widget unavailable</body></html>";
        }
    }

    private int dp(int value) { return Math.round(getResources().getDisplayMetrics().density * value); }
    private void setShown(boolean show) {
        if (!show) {
            if (attached && windowManager != null) {
                try { windowManager.removeViewImmediate(container); }
                catch (IllegalArgumentException ignored) {}
                attached = false;
                if (tickerWeb != null) tickerWeb.onPause();
            }
            return;
        }
        if (attached || windowManager == null) return;
        if (container == null) buildOverlay();
        DisplayMetrics dm = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(dm);
        int maxWidth = Math.max(dp(400), dm.widthPixels - dp(60));
        int width = Math.min(maxWidth, Math.min(dp(785), Math.round(dm.widthPixels * 0.68f)));
        int height = Math.min(dp(128), Math.round(dm.heightPixels * 0.24f));
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(
            width, height, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE |
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN |
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT);
        p.gravity = Gravity.TOP | Gravity.RIGHT;
        p.x = dp(28); p.y = dp(20);
        try {
            windowManager.addView(container, p);
            attached = true;
            tickerWeb.onResume();
        } catch (RuntimeException e) {
            attached = false;
        }
    }

    @Override public void onDestroy() {
        main.removeCallbacks(watchHome);
        setShown(false);
        if (tickerWeb != null) {
            tickerWeb.stopLoading();
            tickerWeb.destroy();
        }
        tickerWeb = null;
        container = null;
        stopForeground(true);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
