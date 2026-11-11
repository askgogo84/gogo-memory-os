package com.gathin.tvhome;

import android.app.Activity;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextClock;

import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

/** Lightweight native clock: no WebView, network requests, per-focus work or blur. */
final class GogoGlassClock {
    private GogoGlassClock() {}

    static boolean enabled(Activity activity) {
        File dir = Config.dir(activity);
        if (dir == null) return false;
        File theme = new File(dir, Config.FILE_NAME);
        if (!theme.isFile() || theme.length() > 1024 * 1024) return false;
        try (FileInputStream input = new FileInputStream(theme)) {
            byte[] bytes = new byte[(int) theme.length()];
            int done = 0;
            while (done < bytes.length) {
                int n = input.read(bytes, done, bytes.length - done);
                if (n < 0) return false;
                done += n;
            }
            JSONObject json = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            return json.optBoolean("gogo_native_clock", false);
        } catch (Exception ignored) {
            return false;
        }
    }

    static boolean attach(Activity activity, FrameLayout root) {
        if (!enabled(activity)) return false;
        LinearLayout layer = new LinearLayout(activity);
        layer.setOrientation(LinearLayout.VERTICAL);
        layer.setGravity(Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        layer.setClickable(false);
        layer.setFocusable(false);
        layer.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        layer.setClipChildren(false);

        TextClock date = new TextClock(activity);
        date.setFormat12Hour("EEEE d MMMM");
        date.setFormat24Hour("EEEE d MMMM");
        date.setTextSize(18f);
        date.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        date.setTextColor(0xE0FFFFFF);
        date.setLetterSpacing(0.035f);
        date.setGravity(Gravity.CENTER);
        date.setShadowLayer(dp(activity, 1.5f), 0f, dp(activity, 1f), 0x88000000);
        layer.addView(date, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextClock clock = new TextClock(activity);
        clock.setFormat12Hour("h:mm");
        clock.setFormat24Hour("HH:mm");
        clock.setTextSize(148f);
        clock.setTypeface(Typeface.create("sans-serif-thin", Typeface.NORMAL));
        clock.setTextColor(0xE6FFFFFF);
        clock.setLetterSpacing(-0.045f);
        clock.setIncludeFontPadding(false);
        clock.setGravity(Gravity.CENTER);
        clock.setShadowLayer(dp(activity, 3f), 0f, dp(activity, 2f), 0xAA000000);
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cp.topMargin = dp(activity, 4f);
        layer.addView(clock, cp);

        FrameLayout.LayoutParams placement = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        placement.topMargin = dp(activity, 62f);
        placement.leftMargin = dp(activity, 30f);
        placement.rightMargin = dp(activity, 30f);
        root.addView(layer, placement);
        return true;
    }

    private static int dp(Activity activity, float value) {
        return Math.round(activity.getResources().getDisplayMetrics().density * value);
    }
}
