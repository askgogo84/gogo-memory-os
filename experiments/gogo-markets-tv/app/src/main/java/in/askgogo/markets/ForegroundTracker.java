package in.askgogo.markets;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.os.Process;

/** Requires explicitly granted usage access; no accessibility monitoring. */
final class ForegroundTracker {
    static final String HOME_PACKAGE = "com.gathin.tvhome";
    private final Context context;
    private final UsageStatsManager usage;
    private long cursorWallMs;
    private String lastForeground = "";

    ForegroundTracker(Context context) {
        this.context = context;
        usage = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
        cursorWallMs = Math.max(0, System.currentTimeMillis() - 86400000L);
    }

    static boolean permitted(Context c) {
        AppOpsManager appOps = (AppOpsManager) c.getSystemService(Context.APP_OPS_SERVICE);
        return appOps != null && appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.getPackageName()) == AppOpsManager.MODE_ALLOWED;
    }

    boolean isHome() {
        if (!permitted(context) || usage == null) return false;
        long now = System.currentTimeMillis();
        UsageEvents events = usage.queryEvents(Math.max(0, cursorWallMs - 500), now);
        UsageEvents.Event event = new UsageEvents.Event();
        if (events != null) {
            while (events.hasNextEvent()) {
                events.getNextEvent(event);
                int kind = event.getEventType();
                if (kind == UsageEvents.Event.ACTIVITY_RESUMED || kind == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                    if (event.getPackageName() != null) lastForeground = event.getPackageName();
                }
            }
        }
        cursorWallMs = now;
        return HOME_PACKAGE.equals(lastForeground);
    }
}
