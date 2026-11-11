package com.gathin.tvhome;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Gogo TV lightweight Home embellishment. The original left-hand clock/date
 * remain native CleanYourTV controls; this class only adds optional weather.
 * App focus and the RecyclerView dock never invoke weather or layout work.
 */
final class GogoGlassClock {
    private static final long UPDATE_MS = 30L * 60L * 1000L;
    private static final long CACHE_VALID_MS = 4L * 60L * 60L * 1000L;
    private GogoGlassClock() {}

    static boolean enabled(Activity activity) {
        return configuration(activity).optBoolean("gogo_native_clock", false);
    }

    static boolean attach(Activity activity, FrameLayout root) {
        JSONObject config = configuration(activity);
        if (!config.optBoolean("gogo_native_clock", false)) return false;
        if (!weatherEnabled(activity)) return true;

        View header = root.findViewById(R.id.leftBlock);
        if (!(header instanceof LinearLayout)) return true;
        LinearLayout column = (LinearLayout) header;
        TextView weather = new TextView(activity);
        weather.setTextSize(15f);
        weather.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        weather.setTextColor(0xE0FFFFFF);
        weather.setSingleLine(true);
        weather.setEllipsize(android.text.TextUtils.TruncateAt.END);
        weather.setFocusable(false);
        weather.setClickable(false);
        weather.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        weather.setPadding(dp(activity, 4), dp(activity, 5), 0, 0);
        weather.setVisibility(View.GONE);
        column.addView(weather, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        SharedPreferences choices =
                activity.getSharedPreferences(Config.SETTINGS_NAME, Context.MODE_PRIVATE);
        String city = choices.getString("gogo_weather_city",
                config.optString("gogo_weather_city", "Bengaluru")).trim();
        if (city.isEmpty() || city.length() > 60) city = "Bengaluru";
        double lat = coordinate(choices, "gogo_weather_lat",
                config.optDouble("gogo_weather_lat", 12.9716));
        double lon = coordinate(choices, "gogo_weather_lon",
                config.optDouble("gogo_weather_lon", 77.5946));
        if (!Double.isFinite(lat) || !Double.isFinite(lon)
                || Math.abs(lat) > 90 || Math.abs(lon) > 180) return true;

        final String location = city;
        final double latitude = lat;
        final double longitude = lon;
        final SharedPreferences prefs =
                activity.getSharedPreferences("gogo_weather_cache", Context.MODE_PRIVATE);
        final String cacheKey = latitude + "," + longitude + ":" + city;
        final String saved = prefs.getString(cacheKey + ":text", "");
        final long savedAt = prefs.getLong(cacheKey + ":time", 0);
        if (!saved.isEmpty() && System.currentTimeMillis() - savedAt < CACHE_VALID_MS) {
            weather.setText(saved);
            weather.setVisibility(View.VISIBLE);
        }
        final Handler main = new Handler(Looper.getMainLooper());
        final Runnable refresh = new Runnable() {
            @Override public void run() {
                if (!weather.isAttachedToWindow()) return;
                // A paused TV launcher must not poll in the background.
                if (activity.hasWindowFocus()) {
                    Thread t = new Thread(() -> {
                        String summary = requestWeather(location, latitude, longitude);
                        if (summary != null) {
                            prefs.edit().putString(cacheKey + ":text", summary)
                                    .putLong(cacheKey + ":time", System.currentTimeMillis()).apply();
                            main.post(() -> {
                                if (weather.isAttachedToWindow()) {
                                    weather.setText(summary);
                                    weather.setVisibility(View.VISIBLE);
                                }
                            });
                        }
                    }, "gogo-weather");
                    t.setDaemon(true);
                    t.start();
                }
                main.postDelayed(this, UPDATE_MS);
            }
        };
        weather.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
            @Override public void onViewAttachedToWindow(View v) { main.post(refresh); }
            @Override public void onViewDetachedFromWindow(View v) { main.removeCallbacks(refresh); }
        });
        if (weather.isAttachedToWindow()) main.post(refresh);
        return true;
    }

    static boolean weatherEnabled(Activity activity) {
        JSONObject config = configuration(activity);
        return activity.getSharedPreferences(Config.SETTINGS_NAME, Context.MODE_PRIVATE)
                .getBoolean("gogo_weather_enabled",
                        config.optBoolean("gogo_weather_enabled", false));
    }

    static String weatherCity(Activity activity) {
        JSONObject config = configuration(activity);
        return activity.getSharedPreferences(Config.SETTINGS_NAME, Context.MODE_PRIVATE)
                .getString("gogo_weather_city", config.optString("gogo_weather_city", "Bengaluru"));
    }

    static void setWeatherLocation(Activity activity, String city, double lat, double lon) {
        if (city == null || city.isEmpty() || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
        activity.getSharedPreferences(Config.SETTINGS_NAME, Context.MODE_PRIVATE)
                .edit().putString("gogo_weather_city", city)
                .putString("gogo_weather_lat", Double.toString(lat))
                .putString("gogo_weather_lon", Double.toString(lon)).apply();
    }

    private static double coordinate(SharedPreferences prefs, String key, double defaultValue) {
        try {
            return Double.parseDouble(prefs.getString(key, Double.toString(defaultValue)));
        } catch (NumberFormatException ignored) {
            return defaultValue;
        }
    }

    private static JSONObject configuration(Activity activity) {
        File dir = Config.dir(activity);
        if (dir == null) return new JSONObject();
        File json = new File(dir, Config.FILE_NAME);
        if (!json.isFile() || json.length() > 64 * 1024) return new JSONObject();
        try (FileInputStream input = new FileInputStream(json)) {
            byte[] content = new byte[(int) json.length()];
            int offset = 0;
            while (offset < content.length) {
                int n = input.read(content, offset, content.length - offset);
                if (n < 0) return new JSONObject();
                offset += n;
            }
            return new JSONObject(new String(content, StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static String requestWeather(String city, double lat, double lon) {
        HttpURLConnection connection = null;
        try {
            String uri = String.format(Locale.US,
                    "https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f"
                    + "&current=temperature_2m,weather_code&timezone=auto&forecast_days=1", lat, lon);
            connection = (HttpURLConnection) new URL(uri).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            if (connection.getResponseCode() != 200) return null;
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[1024];
                int n;
                while ((n = input.read(buffer)) >= 0) {
                    if (bytes.size() + n > 32 * 1024) return null;
                    bytes.write(buffer, 0, n);
                }
                JSONObject current = new JSONObject(bytes.toString("UTF-8"))
                        .optJSONObject("current");
                if (current == null || !current.has("temperature_2m")) return null;
                double temp = current.optDouble("temperature_2m", Double.NaN);
                if (!Double.isFinite(temp) || temp < -100 || temp > 70) return null;
                int code = current.optInt("weather_code", -1);
                return city + "  ·  " + Math.round(temp) + "°C  ·  " + weatherName(code);
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String weatherName(int code) {
        if (code == 0) return "Clear";
        if (code == 1 || code == 2) return "Partly cloudy";
        if (code == 3) return "Cloudy";
        if (code == 45 || code == 48) return "Fog";
        if (code >= 51 && code <= 57) return "Drizzle";
        if (code >= 61 && code <= 67) return "Rain";
        if (code >= 71 && code <= 77) return "Snow";
        if (code >= 80 && code <= 82) return "Showers";
        if (code >= 95) return "Thunderstorm";
        return "Weather";
    }

    private static int dp(Activity activity, float value) {
        return Math.round(activity.getResources().getDisplayMetrics().density * value);
    }
}
