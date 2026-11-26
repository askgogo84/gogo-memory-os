package com.techgenius.tvoslauncher;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * tvOS Launcher 2.1.5 integration: a single opt-in, no-network, native card
 * in the existing HomeDashboard row. This component does not run in the
 * background and never changes dock/app-focus handling.
 */
final class GogoWidgets {
    private static final String PREF = "home_dashboard_prefs";
    private static final String ENABLE = "gogo_hub_widget_enabled";
    private GogoWidgets() {}

    private static String profileKey(Context context) {
        return ENABLE + ":" + Profiles.current(context).id;
    }

    static boolean enabled(Context context) {
        return context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
                .getBoolean(profileKey(context), false);
    }

    static void setEnabled(Context context, boolean value) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
                .edit().putBoolean(profileKey(context), value).apply();
    }

    static View makeCard(final MainActivity activity) {
        final FrameLayout card = new FrameLayout(activity);
        final float density = activity.getResources().getDisplayMetrics().density;
        final int radius = Math.round(15f * density);
        GradientDrawable normal = background(radius, false);
        GradientDrawable focused = background(radius, true);
        card.setBackground(normal);
        card.setFocusable(true);
        card.setClickable(true);
        card.setPadding(Math.round(13*density), Math.round(10*density),
                Math.round(13*density), Math.round(10*density));

        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_VERTICAL);
        content.addView(text(activity, "GOGO TV", 11, 0xFF9DE4F2, true));
        TextView heading = text(activity, "AskGogo + Markets", 16, Color.WHITE, false);
        LinearLayout.LayoutParams h = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        h.topMargin = Math.round(4*density);
        content.addView(heading, h);
        TextView detail = text(activity, "Open personal hub", 10, 0xFFB3C9D6, false);
        content.addView(detail);
        card.addView(content, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        card.setOnFocusChangeListener((view, on) -> {
            card.setBackground(on ? focused : normal);
            card.animate().cancel();
            card.animate().scaleX(on ? 1.025f : 1f)
                    .scaleY(on ? 1.025f : 1f).setDuration(100).start();
        });
        card.setOnClickListener(v ->
                activity.startActivity(new Intent(activity, GogoHubActivity.class)));
        return card;
    }

    private static TextView text(Context context, String label, int size, int color, boolean bold) {
        TextView t = new TextView(context);
        t.setText(label);
        t.setSingleLine(true);
        t.setTextColor(color);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, size);
        t.setTypeface(Typeface.create("sans-serif-medium",
                bold ? Typeface.BOLD : Typeface.NORMAL));
        return t;
    }

    private static GradientDrawable background(int radius, boolean focus) {
        GradientDrawable d = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{focus ? 0xE2326784 : 0xB72E4F65,
                        focus ? 0xED143B56 : 0xB9173247});
        d.setCornerRadius(radius);
        d.setStroke(1, focus ? 0xFFB7EEFF : 0x6698C6DF);
        return d;
    }
}
