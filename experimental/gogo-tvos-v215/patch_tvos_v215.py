"""Non-destructive Gogo TV extension patch for tvOS Launcher upstream v2.1.5.

The parent launcher (Home, PowerService, app focus, volume controls, and stock
Home settings) remains unmodified. Only the dashboard row, the dashboard
settings submenu and Android manifest gain a small optional Gogo tile/activity.
Patch a fresh source checkout and compile separately. DO NOT install the debug
APK over a signed user's launcher: Android will reject mismatched signatures.
"""
from pathlib import Path
import argparse
import shutil

HOME_METHOD = "        return isEnabled(c) && (isWidgetPrayerEnabled(c)\n"
LAST_WIDGET = "                || isWidgetWeatherEnabled(c));"
ADD_CARD = """        if (GogoWidgets.enabled(host)) {
            cards.add(GogoWidgets.makeCard(host));
        }
"""
CARD_ANCHOR = "        if (isWidgetPrayerEnabled(host)) {\n"
SETTINGS_ANCHOR = '        section(tr("WIDGET SETTINGS", "WIDGET AYARLARI"));'
SETTINGS_ROWS = """        section(tr("GOGO TV — OPTIONAL", "GOGO TV — ISTEGE BAGLI"));
        row("Gogo TV · AskGogo + Markets",
                () -> GogoWidgets.enabled(this) ? tr("On", "Açık") : tr("Off", "Kapalı"),
                () -> {
                    GogoWidgets.setEnabled(this, !GogoWidgets.enabled(this));
                    refreshAll();
                });

"""
MANIFEST_ACT = '        <activity\n            android:name=".SettingsActivity"'
MANIFEST_ADD = '''        <!-- Optional Gogo hub, never a HOME or LAUNCHER intent receiver. -->
        <activity android:name=".GogoHubActivity"
            android:exported="false"
            android:screenOrientation="landscape" />

'''
MANIFEST_QUERY = '    </queries>'
MANIFEST_QUERY_ADD = '''        <!-- Existing local remote-control companion; optional. -->
        <package android:name="dev.couchtv.ontv" />
'''

def replace_once(text, old, new, label, already):
    if already in text:
        return text
    hits = text.count(old)
    if hits != 1:
        raise ValueError(f"{label}: expected one anchor, found {hits}")
    return text.replace(old, new, 1)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--upstream", required=True, type=Path)
    p.add_argument("--sources", required=True, type=Path)
    p.add_argument("--backup", required=True, type=Path)
    args=p.parse_args()
    root=args.upstream
    pkg=root/"src/com/techgenius/tvoslauncher"
    hd=pkg/"HomeDashboard.java"
    settings=pkg/"SettingsActivity.java"
    manifest=root/"AndroidManifest.xml"
    widgets=pkg/"GogoWidgets.java"
    hub=pkg/"GogoHubActivity.java"
    files=[hd,settings,manifest,args.sources/"GogoWidgets.java",args.sources/"GogoHubActivity.java"]
    for f in files:
        if not f.is_file(): raise ValueError(f"Missing prerequisite: {f}")

    oldHd=hd.read_text(encoding="utf-8")
    oldSettings=settings.read_text(encoding="utf-8")
    oldManifest=manifest.read_text(encoding="utf-8")
    h = replace_once(oldHd, LAST_WIDGET,
        "                || isWidgetWeatherEnabled(c)\n"
        "                 || GogoWidgets.enabled(c));",
        "dashboard enabled", "|| GogoWidgets.enabled(c));")
    h = replace_once(h, CARD_ANCHOR, ADD_CARD + CARD_ANCHOR,
        "dashboard card", "cards.add(GogoWidgets.makeCard(host));")
    if HOME_METHOD not in oldHd: raise ValueError("HomeDashboard upstream changed")
    sett = replace_once(oldSettings, SETTINGS_ANCHOR,
        SETTINGS_ROWS + SETTINGS_ANCHOR, "settings submenu", 'row("Gogo TV · AskGogo + Markets",')
    xml = replace_once(oldManifest, MANIFEST_ACT,
        MANIFEST_ADD + MANIFEST_ACT, "manifest Activity", 'android:name=".GogoHubActivity"')
    xml = replace_once(xml, MANIFEST_QUERY,
        MANIFEST_QUERY_ADD + MANIFEST_QUERY,
        "manifest package query", '<package android:name="dev.couchtv.ontv" />')

    for target,source in [(widgets,args.sources/"GogoWidgets.java"),
                          (hub,args.sources/"GogoHubActivity.java")]:
        body=source.read_text(encoding="utf-8")
        if "package com.techgenius.tvoslauncher;" not in body:
            raise ValueError(f"Bad Java package: {source}")
        if target.exists() and target.read_text(encoding="utf-8") != body:
            raise ValueError(f"Existing file differs, not replacing: {target}")
    # Back up only files that would change; never overwrite the original backup.
    args.backup.mkdir(parents=True,exist_ok=True)
    for path,old,new in [(hd,oldHd,h),(settings,oldSettings,sett),(manifest,oldManifest,xml)]:
        if old != new:
            saved=args.backup / path.name
            if saved.exists(): raise ValueError(f"Refusing to overwrite backup {saved}")
            shutil.copy2(path,saved)
    for path,old,new in [(hd,oldHd,h),(settings,oldSettings,sett),(manifest,oldManifest,xml)]:
        if old != new: path.write_text(new,encoding="utf-8")
    for target,source in [(widgets,args.sources/"GogoWidgets.java"),
                          (hub,args.sources/"GogoHubActivity.java")]:
        if not target.exists(): shutil.copy2(source,target)

    # Verify the existing launcher Home/Power code was not edited by this patch.
    assert 'android:name=".MainActivity"' in xml
    assert '<category android:name="android.intent.category.HOME" />' in xml
    assert 'android:name=".GogoHubActivity"' in xml
    assert oldHd != h or "cards.add(GogoWidgets.makeCard(host));" in h
    print("GOGO_TVOS_V215_PATCH_OK: opt-in native tile, Hub and Markets Activity; no Home-button changes")

if __name__ == "__main__":
    main()
