"""Upgrade an already-installed Gogo Glass v1 source tree, without touching TV state."""
from pathlib import Path
import argparse, shutil
OLD = "        clockBlock.setVisibility(gogoNativeClock ? View.INVISIBLE : (valid ? View.VISIBLE : View.INVISIBLE));"
NEW = "        clockBlock.setVisibility(valid ? View.VISIBLE : View.INVISIBLE);"
PERM = '    <uses-permission android:name="android.permission.INTERNET" />'
ANCHOR = '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--glass-source", type=Path, required=True)
    args = parser.parse_args()
    source = args.project / "launcher/app/src/main/java/com/gathin/tvhome"
    main = source / "MainActivity.java"
    clock = source / "GogoGlassClock.java"
    manifest = args.project / "launcher/app/src/main/AndroidManifest.xml"
    for f in (main, clock, manifest, args.glass_source):
        if not f.is_file():
            raise ValueError(f"Required file not found: {f}")
    original_main = main.read_text(encoding="utf-8")
    original_manifest = manifest.read_text(encoding="utf-8")
    old_clock = clock.read_text(encoding="utf-8")
    new_clock = args.glass_source.read_text(encoding="utf-8")
    if "GogoGlassClock.attach(this, root)" not in original_main:
        raise ValueError("CleanYourTV source is missing the Gogo v1 patch; cannot upgrade automatically.")
    if original_main.count(OLD) == 1:
        new_main = original_main.replace(OLD, NEW, 1)
    elif original_main.count(NEW) == 1 and OLD not in original_main:
        new_main = original_main
    else:
        raise ValueError("Clock visibility anchor differs; no source changes.")
    if "final class GogoGlassClock" not in new_clock or 'gogo_weather_enabled' not in new_clock:
        raise ValueError("Invalid weather source; no source changes.")
    if PERM not in original_manifest:
        if original_manifest.count(ANCHOR) != 1:
            raise ValueError("Manifest network permissions differ; no source changes.")
        new_manifest = original_manifest.replace(ANCHOR, PERM + "\n" + ANCHOR, 1)
    else:
        new_manifest = original_manifest
    args.backup.mkdir(parents=True, exist_ok=True)
    for file, name in ((main,"MainActivity.before-v2.java"), (clock,"GogoGlassClock.before-v2.java"),
                       (manifest,"AndroidManifest.before-v2.xml")):
        backup = args.backup / name
        if not backup.exists():
            shutil.copy2(file, backup)
    if original_main != new_main: main.write_text(new_main, encoding="utf-8")
    if original_manifest != new_manifest: manifest.write_text(new_manifest, encoding="utf-8")
    if old_clock != new_clock: clock.write_text(new_clock, encoding="utf-8")
    print("Gogo Native Glass v2 source patched. Left clock preserved, optional weather added.")
if __name__ == "__main__":
    main()
