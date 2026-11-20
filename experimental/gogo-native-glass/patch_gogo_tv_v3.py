"""Patch the already-installed Gogo TV v2 source to add fast optional modules.

Idempotent, fail-closed, and NEVER talks to the TV. The Windows installer performs
backups and compilation separately. Keep the working Home/launcher untouched.
"""
from pathlib import Path
import argparse
import shutil

MAIN_ANCHOR = "        gogoNativeClock = GogoGlassClock.attach(this, root);"
MAIN_EXTRA = MAIN_ANCHOR + "\n        GogoMarketsTicker.attach(this, root);"

SETTINGS_ANCHOR = "        followThemeChoice = findViewById(R.id.followThemeChoice);"
SETTINGS_EXTRA = """        TextView gogoMarketsChoice = findViewById(R.id.gogoMarketsChoice);
        TextView gogoAskChoice = findViewById(R.id.gogoAskChoice);
        TextView gogoRemoteChoice = findViewById(R.id.gogoRemoteChoice);
        boolean feedReady = GogoTvSettings.marketFeedConfigured(this);
        gogoMarketsChoice.setText(feedReady
                ? "Markets: " + (GogoTvSettings.marketsEnabled(this) ? "On" : "Off")
                : "Markets: Connect licensed feed");
        gogoMarketsChoice.setOnClickListener(v -> {
            if (!GogoTvSettings.marketFeedConfigured(this)) {
                new AlertDialog.Builder(this)
                        .setTitle("Gogo Markets")
                        .setMessage("A licensed HTTPS market-data feed must be configured from a computer before prices are displayed. No market values are guessed or scraped.")
                        .setPositiveButton(android.R.string.ok, null).show();
                return;
            }
            boolean nowEnabled = !GogoTvSettings.marketsEnabled(this);
            choices.edit().putBoolean("gogo_markets_enabled", nowEnabled).apply();
            gogoMarketsChoice.setText("Markets: " + (nowEnabled ? "On" : "Off"));
            changed();
        });
        gogoAskChoice.setOnClickListener(v -> GogoTvSettings.openAskGogo(this));
        gogoRemoteChoice.setOnClickListener(v -> GogoTvSettings.openCouchRemoteSetup(this));

"""
LAYOUT_ANCHOR = '        <TextView\n            android:id="@+id/followThemeChoice"'
LAYOUT_EXTRA = """        <TextView
            android:id="@+id/gogoMarketsChoice"
            style="@style/SettingsRow"
            android:layout_marginTop="28dp"
            android:text="Markets: Connect licensed feed" />
        <TextView
            android:id="@+id/gogoAskChoice"
            style="@style/SettingsRow"
            android:layout_marginTop="10dp"
            android:text="Open AskGogo" />
        <TextView
            android:id="@+id/gogoRemoteChoice"
            style="@style/SettingsRow"
            android:layout_marginTop="10dp"
            android:text="Couch TV remote setup" />

"""

def one_replace(value, anchor, new, already, location):
    if already in value:
        return value
    if value.count(anchor) != 1:
        raise RuntimeError(f"Missing or ambiguous {location} anchor: {value.count(anchor)} matches")
    return value.replace(anchor, new, 1)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--backup", required=True, type=Path)
    parser.add_argument("--sources", required=True, type=Path)
    args = parser.parse_args()
    project = args.project
    src = project / "launcher/app/src/main/java/com/gathin/tvhome"
    manifest = project / "launcher/app/src/main/AndroidManifest.xml"
    main = src / "MainActivity.java"
    settings = src / "LauncherSettingsActivity.java"
    layout = project / "launcher/app/src/main/res/layout/activity_launcher_settings.xml"
    add = [("GogoMarketsTicker.java", src / "GogoMarketsTicker.java"),
           ("GogoTvSettings.java", src / "GogoTvSettings.java")]
    required = [main, settings, layout, manifest] + [args.sources / n for n, _ in add]
    for f in required:
        if not f.is_file():
            raise RuntimeError(f"Prerequisite missing: {f}")
    if 'android.permission.INTERNET' not in manifest.read_text(encoding="utf-8"):
        raise RuntimeError("Existing weather APK has no INTERNET manifest permission")
    current_main = main.read_text(encoding="utf-8")
    current_settings = settings.read_text(encoding="utf-8")
    current_layout = layout.read_text(encoding="utf-8")
    if "gogoWeatherChoice" not in current_settings or "GogoGlassClock.attach(this, root)" not in current_main:
        raise RuntimeError("Gogo Native Weather v2 source required; no changes made")
    updated_main = one_replace(current_main, MAIN_ANCHOR, MAIN_EXTRA,
                               "GogoMarketsTicker.attach(this, root);", "MainActivity")
    updated_settings = one_replace(current_settings, SETTINGS_ANCHOR,
                                   SETTINGS_EXTRA + SETTINGS_ANCHOR,
                                   "gogoMarketsChoice = findViewById", "LauncherSettings")
    updated_layout = one_replace(current_layout, LAYOUT_ANCHOR,
                                 LAYOUT_EXTRA + LAYOUT_ANCHOR,
                                 'android:id="@+id/gogoMarketsChoice"', "Settings layout")
    for name, target in add:
        new_text = (args.sources / name).read_text(encoding="utf-8")
        if f"final class {name[:-5]}" not in new_text:
            raise RuntimeError(f"Incorrect source: {name}")
        if target.exists() and target.read_text(encoding="utf-8") != new_text:
            raise RuntimeError(f"Existing {name} differs; inspect instead of overwrite")
    args.backup.mkdir(parents=True, exist_ok=True)
    edits = [(main, current_main, updated_main, "MainActivity.before-v3.java"),
             (settings, current_settings, updated_settings, "LauncherSettingsActivity.before-v3.java"),
             (layout, current_layout, updated_layout, "activity_launcher_settings.before-v3.xml")]
    for f, old, new, backup_name in edits:
        if old != new:
            saved = args.backup / backup_name
            if not saved.exists(): shutil.copy2(f, saved)
    for f, old, new, _ in edits:
        if old != new: f.write_text(new, encoding="utf-8")
    for name, target in add:
        if not target.exists():
            shutil.copy2(args.sources / name, target)
    print("Gogo TV v3 source patched. Home, wallpaper, weather and app navigation unchanged.")

if __name__ == "__main__":
    main()
