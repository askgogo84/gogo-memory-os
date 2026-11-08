package in.askgogo.markets;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context ctx, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (!ctx.getSharedPreferences("settings", Context.MODE_PRIVATE).getBoolean("autoStart", false)) return;
        if (!ForegroundTracker.permitted(ctx) || !android.provider.Settings.canDrawOverlays(ctx)) return;
        try {
            Intent start = new Intent(ctx, TickerService.class);
            start.setAction(TickerService.START);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(start);
            else ctx.startService(start);
        } catch (RuntimeException ignored) {
            // Some TCL firmware blocks background launch; user can start manually.
        }
    }
}
