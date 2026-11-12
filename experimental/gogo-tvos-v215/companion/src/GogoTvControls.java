package in.askgogo.tvhub;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.content.Context;
import android.widget.Toast;

import java.util.Locale;

/**
 * Local, explicitly user-confirmed TV commands. No ADB, shell, accessibility
 * injection, account actions or arbitrary package names.
 */
final class GogoTvControls {
    private GogoTvControls() {}

    static String description(String message) {
        if (message == null) return null;
        String input = message.toLowerCase(Locale.ROOT).trim()
                .replaceAll("\\s+", " ");
        switch (input) {
            case "open youtube":
            case "launch youtube": return "Open YouTube on this TV";
            case "open netflix":
            case "launch netflix": return "Open Netflix on this TV";
            case "open prime video":
            case "open amazon prime":
            case "launch prime video": return "Open Prime Video on this TV";
            case "volume up":
            case "increase volume": return "Increase TV media volume";
            case "volume down":
            case "decrease volume": return "Decrease TV media volume";
            case "mute":
            case "mute volume": return "Mute TV media volume";
            case "unmute":
            case "unmute volume": return "Unmute TV media volume";
            default: return null;
        }
    }

    static boolean execute(Activity activity, String message) {
        String input = message.toLowerCase(Locale.ROOT).trim()
                .replaceAll("\\s+", " ");
        String pkg = null;
        if (input.equals("open youtube") || input.equals("launch youtube")) {
            pkg = "com.google.android.youtube.tv";
        } else if (input.equals("open netflix") || input.equals("launch netflix")) {
            pkg = "com.netflix.ninja";
        } else if (input.equals("open prime video") ||
                   input.equals("open amazon prime") ||
                   input.equals("launch prime video")) {
            pkg = "com.amazon.amazonvideo.livingroom";
        }
        if (pkg != null) {
            PackageManager pm = activity.getPackageManager();
            Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
            if (i == null) i = pm.getLaunchIntentForPackage(pkg);
            if (i == null) {
                Toast.makeText(activity,"The selected app isn't installed.",
                        Toast.LENGTH_LONG).show();
                return false;
            }
            try {
                activity.startActivity(i);
                return true;
            } catch (ActivityNotFoundException | SecurityException unavailable) {
                return false;
            }
        }

        AudioManager audio = (AudioManager) activity.getSystemService(Context.AUDIO_SERVICE);
        if (audio == null || audio.isVolumeFixed()) return false;
        int flags = AudioManager.FLAG_SHOW_UI;
        switch (input) {
            case "volume up":
            case "increase volume":
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                        AudioManager.ADJUST_RAISE,flags);return true;
            case "volume down":
            case "decrease volume":
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                        AudioManager.ADJUST_LOWER,flags);return true;
            case "mute":
            case "mute volume":
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                        AudioManager.ADJUST_MUTE,flags);return true;
            case "unmute":
            case "unmute volume":
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                        AudioManager.ADJUST_UNMUTE,flags);return true;
            default: return false;
        }
    }
}
