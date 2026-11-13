package com.gathin.tvhome;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.widget.Toast;
import android.content.SharedPreferences;

import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;

/** Optional Gogo TV switches and safe companion shortcuts. No background service. */
final class GogoTvSettings {
    static final String ASK_GOGO_URL = "https://app.askgogo.in";
    private GogoTvSettings() {}

    static JSONObject readConfig(Activity activity) {
        File dir=Config.dir(activity);
        if(dir==null) return new JSONObject();
        File file=new File(dir,Config.FILE_NAME);
        if(!file.isFile() || file.length()>64*1024) return new JSONObject();
        try (FileInputStream stream=new FileInputStream(file)) {
            byte[] b=new byte[(int)file.length()];
            int read=0;
            while(read < b.length) {
                int n=stream.read(b,read,b.length-read);
                if(n<0) return new JSONObject();
                read+=n;
            }
            return new JSONObject(new String(b, StandardCharsets.UTF_8));
        } catch(Exception ignored) {
            return new JSONObject();
        }
    }

    static boolean marketsEnabled(Activity activity) {
        JSONObject config=readConfig(activity);
        return activity.getSharedPreferences(Config.SETTINGS_NAME, Context.MODE_PRIVATE)
                .getBoolean("gogo_markets_enabled",
                        config.optBoolean("gogo_markets_enabled", false));
    }

    static boolean marketFeedConfigured(Activity activity) {
        JSONObject json=readConfig(activity);
        SharedPreferences prefs=activity.getSharedPreferences(Config.SETTINGS_NAME,Context.MODE_PRIVATE);
        String feed = prefs.getString("gogo_markets_url", json.optString("gogo_markets_url",""));
        String token = json.optString("gogo_markets_device_token", "");
        return "https://app.askgogo.in/api/gogo-tv/markets".equals(feed)
                && token.matches("[A-Za-z0-9_-]{32,128}");
    }

    static boolean isSafeFeedUrl(String raw) {
        if(raw==null || raw.length()<12 || raw.length()>400) return false;
        try {
            URI uri=new URI(raw);
            if(!"https".equalsIgnoreCase(uri.getScheme())) return false;
            if(uri.getRawUserInfo()!=null || uri.getRawFragment()!=null) return false;
            String host=uri.getHost();
            if(host==null || host.length()<4 || host.length()>200) return false;
            String lower=host.toLowerCase(java.util.Locale.ROOT);
            if(lower.equals("localhost") || lower.endsWith(".local") || lower.endsWith(".internal")
                    || lower.endsWith(".lan") || lower.endsWith(".onion") || lower.equals("::1")
                    || lower.startsWith("127.") || lower.startsWith("10.") || lower.startsWith("192.168.")
                    || lower.startsWith("172.16.") || lower.startsWith("172.17.")
                    || lower.startsWith("172.18.") || lower.startsWith("172.19.")
                    || lower.startsWith("172.2") || lower.startsWith("172.30.") || lower.startsWith("172.31.")
                    || lower.startsWith("169.254.")) return false;
            if(lower.contains(":") || lower.matches("[0-9.]+")) return false;
            if(uri.getPort()!=-1 && uri.getPort()!=443) return false;
            String query=uri.getRawQuery();
            if(query!=null && query.toLowerCase(java.util.Locale.ROOT)
                    .matches(".*(apikey|api_key|token|secret|auth|password)=.*")) return false;
            return true;
        } catch(Exception ignored) {
            return false;
        }
    }

    static void openAskGogo(Activity activity) {
        try {
            Intent link=new Intent(Intent.ACTION_VIEW,Uri.parse(ASK_GOGO_URL));
            activity.startActivity(link);
        } catch (ActivityNotFoundException | SecurityException e) {
            Toast.makeText(activity, "A TV browser is needed to open AskGogo",
                    Toast.LENGTH_LONG).show();
        }
    }

    static void openCouchRemoteSetup(Activity activity) {
        try {
            PackageManager pm=activity.getPackageManager();
            Intent launch=pm.getLeanbackLaunchIntentForPackage("dev.couchtv.ontv");
            if(launch==null) launch=pm.getLaunchIntentForPackage("dev.couchtv.ontv");
            if(launch==null) {
                Toast.makeText(activity, "Couch TV remote app is not installed",
                        Toast.LENGTH_LONG).show();
                return;
            }
            activity.startActivity(launch);
        } catch(ActivityNotFoundException | SecurityException e) {
            Toast.makeText(activity, "Cannot open the TV remote setup",
                    Toast.LENGTH_LONG).show();
        }
    }
}
