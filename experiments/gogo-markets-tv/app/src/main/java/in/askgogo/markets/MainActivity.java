package in.askgogo.markets;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.net.Uri;
import android.view.Gravity;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private TextView status;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout frame = new LinearLayout(this);
        frame.setPadding(dp(54), dp(30), dp(54), dp(24));
        frame.setOrientation(LinearLayout.VERTICAL);
        frame.setBackgroundColor(Color.rgb(15, 23, 42));
        frame.setGravity(Gravity.TOP);
        setContentView(frame);
        frame.addView(line("Gogo Markets TV", 36, Color.WHITE, true));
        frame.addView(line("Minimal stock ticker · visible only on CleanYourTV Home", 17, 0xFFABBDC9, false));
        status = line("Checking special permissions…", 17, 0xFFB2E1F3, false);
        status.setPadding(0, dp(16), 0, dp(10));
        frame.addView(status);
        add(frame, "1 · Grant usage access", () -> openSettings(Settings.ACTION_USAGE_ACCESS_SETTINGS));
        add(frame, "2 · Allow display over other apps", () -> {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
            try { startActivity(i); } catch (Exception ex) { openSettings(Settings.ACTION_SETTINGS); }
        });
        add(frame, "3 · Start ticker", () -> {
            if (!ForegroundTracker.permitted(this) || !Settings.canDrawOverlays(this)) {
                status.setText("Grant Usage Access and Display over other apps first. No overlay shown.");
                return;
            }
            Intent i = new Intent(this, TickerService.class);
            i.setAction(TickerService.START);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
            status.setText("Ticker started. Press Home to see it; open Netflix to confirm it hides.");
        });
        add(frame, "Stop ticker", () -> {
            stopService(new Intent(this, TickerService.class));
            status.setText("Ticker stopped. Your original launcher and wallpapers are unchanged.");
        });
        CheckBox boot = new CheckBox(this);
        boot.setText("Start ticker again after TV reboot (optional)");
        boot.setTextColor(Color.WHITE);
        boot.setTextSize(16);
        boot.setChecked(getSharedPreferences("settings", 0).getBoolean("autoStart", false));
        boot.setOnCheckedChangeListener((btn, checked) ->
            getSharedPreferences("settings", 0).edit().putBoolean("autoStart", checked).apply());
        frame.addView(boot);
        frame.addView(line("Quotes supplied by TradingView · may be delayed or unavailable. TradingView attribution remains visible.", 14, 0xFFA5AEC2, false));
        updateStatus();
    }
    private int dp(int i) { return Math.round(getResources().getDisplayMetrics().density * i); }
    private TextView line(String s, int size, int color, boolean bold) {
        TextView v = new TextView(this);
        v.setText(s); v.setTextColor(color); v.setTextSize(size);
        if (bold) v.setTypeface(null, android.graphics.Typeface.BOLD);
        v.setPadding(0, dp(7), 0, dp(7));
        return v;
    }
    private void add(LinearLayout root, String label, Runnable onClick) {
        Button b = new Button(this);
        b.setAllCaps(false); b.setText(label);
        b.setOnClickListener(v -> onClick.run());
        root.addView(b, new LinearLayout.LayoutParams(-1, dp(55)));
    }
    private void openSettings(String action) {
        try { startActivity(new Intent(action)); }
        catch (Exception ex) { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
    }
    private void updateStatus() {
        boolean usage = ForegroundTracker.permitted(this);
        boolean overlay = Settings.canDrawOverlays(this);
        status.setText("Usage access: " + (usage ? "Allowed" : "Needed") + "   ·   Overlay: " + (overlay ? "Allowed" : "Needed"));
    }
    @Override protected void onResume() {
        super.onResume();
        if (status != null) status.postDelayed(this::updateStatus, 300);
    }
}
