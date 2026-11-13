"""Install the free branded TradingView view as a separate TV Activity.

No network calls and no theme modifications. All edits are validated before
writing, backed up, and idempotent. Existing native TV Home stays untouched.
"""
from pathlib import Path
import argparse, shutil

MANIFEST_ANCHOR = '        <activity\n            android:name=".MainActivity"'
MANIFEST_ADD = '''        <!-- An on-demand market view. Does not claim HOME or LAUNCHER. -->
        <activity
            android:name=".GogoFreeMarketsActivity"
            android:exported="false"
            android:screenOrientation="landscape" />

'''
SETTINGS_START = "        gogoMarketsChoice.setText(feedReady"
SETTINGS_END = "        gogoAskChoice.setOnClickListener"
SETTINGS_NEW = '''        gogoMarketsChoice.setText("Markets: Free TradingView");
        gogoMarketsChoice.setOnClickListener(v ->
                startActivity(new Intent(this, GogoFreeMarketsActivity.class)));
'''

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--project", type=Path, required=True)
    p.add_argument("--backup", type=Path, required=True)
    p.add_argument("--sources", type=Path, required=True)
    args=p.parse_args()
    root=args.project/"launcher/app"
    java=root/"src/main/java/com/gathin/tvhome"
    manifest=root/"src/main/AndroidManifest.xml"
    settings=java/"LauncherSettingsActivity.java"
    activity=java/"GogoFreeMarketsActivity.java"
    html=root/"src/main/assets/gogo_tv_free_markets.html"
    new_activity=args.sources/"GogoFreeMarketsActivity.java"
    new_html=args.sources/"gogo_tv_free_markets.html"
    required=[manifest,settings,new_activity,new_html]
    for f in required:
        if not f.is_file(): raise ValueError(f"Missing required file: {f}")
    old_manifest=manifest.read_text(encoding="utf-8")
    old_settings=settings.read_text(encoding="utf-8")
    java_source=new_activity.read_text(encoding="utf-8")
    widget_html=new_html.read_text(encoding="utf-8")
    if "GogoMarketsTicker.attach(this, root)" not in (java/"MainActivity.java").read_text(encoding="utf-8"):
        raise ValueError("Existing Gogo Native v3 source required")
    if "GogoFreeMarketsActivity extends Activity" not in java_source:
        raise ValueError("Not the expected Activity source")
    if 'https://www.tradingview-widget.com/w/en/tv-ticker-tape.js' not in widget_html:
        raise ValueError("Not the expected official widget")
    if "Widgets by TradingView" not in widget_html:
        raise ValueError("TradingView attribution missing")

    if '.GogoFreeMarketsActivity' in old_manifest:
        updated_manifest=old_manifest
    else:
        if old_manifest.count(MANIFEST_ANCHOR)!=1:
            raise ValueError("Manifest insertion anchor missing or ambiguous")
        updated_manifest=old_manifest.replace(MANIFEST_ANCHOR,MANIFEST_ADD+MANIFEST_ANCHOR,1)

    if 'gogoMarketsChoice.setText("Markets: Free TradingView")' in old_settings:
        updated_settings=old_settings
    else:
        if old_settings.count(SETTINGS_START)!=1 or old_settings.count(SETTINGS_END)!=1:
            raise ValueError("Settings insertion anchor missing or ambiguous")
        prefix,tail=old_settings.split(SETTINGS_START,1)
        discarded,suffix=tail.split(SETTINGS_END,1)
        if ("gogoMarketsChoice.setOnClickListener" not in discarded or
                "licensed HTTPS market-data feed" not in discarded):
            raise ValueError("Settings block has changed; inspect before proceeding")
        updated_settings=prefix+SETTINGS_NEW+SETTINGS_END+suffix

    if activity.exists() and activity.read_text(encoding="utf-8")!=java_source:
        raise ValueError("Existing market Activity differs")
    if html.exists() and html.read_text(encoding="utf-8")!=widget_html:
        raise ValueError("Existing Markets HTML differs")

    args.backup.mkdir(parents=True,exist_ok=True)
    for f,old,new,name in [(manifest,old_manifest,updated_manifest,"AndroidManifest.before-free-markets.xml"),
                           (settings,old_settings,updated_settings,"LauncherSettingsActivity.before-free-markets.java")]:
        if old!=new:
            shutil.copy2(f,args.backup/name)
            f.write_text(new,encoding="utf-8")

    if not activity.exists(): shutil.copy2(new_activity,activity)
    html.parent.mkdir(parents=True,exist_ok=True)
    if not html.exists(): shutil.copy2(new_html,html)
    print("Free TradingView on-demand Market Activity patched. Native Home unchanged.")

if __name__=="__main__":
    main()
