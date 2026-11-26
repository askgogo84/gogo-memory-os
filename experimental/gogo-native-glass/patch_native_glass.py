"""Fail-closed patcher for existing CleanYourTV MainActivity."""
from pathlib import Path
import argparse, shutil

FIELD = "    private View clockBlock;"
FIELD_NEW = FIELD + "\n    private boolean gogoNativeClock;"
INIT = "        clockBlock = findViewById(R.id.leftBlock);"
INIT_NEW = INIT + "\n        gogoNativeClock = GogoGlassClock.attach(this, root);"
VIS = "        clockBlock.setVisibility(valid ? View.VISIBLE : View.INVISIBLE);"
VIS_NEW = "        clockBlock.setVisibility(gogoNativeClock ? View.INVISIBLE : (valid ? View.VISIBLE : View.INVISIBLE));"

def make_patch(content: str) -> str:
    olds = [FIELD, INIT, VIS]
    news = [FIELD_NEW, INIT_NEW, VIS_NEW]
    if all(n in content for n in news):
        return content
    if any(n in content for n in news):
        raise ValueError("Partial Gogo patch detected; inspect before retrying")
    for old in olds:
        if content.count(old) != 1:
            raise ValueError(f"Expected exactly one anchor, got {content.count(old)}: {old}")
    for old, new in zip(olds, news):
        content = content.replace(old, new, 1)
    return content

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--backup", required=True, type=Path)
    parser.add_argument("--glass-source", required=True, type=Path)
    args = parser.parse_args()
    folder = args.project / "launcher/app/src/main/java/com/gathin/tvhome"
    target = folder / "MainActivity.java"
    dest = folder / "GogoGlassClock.java"
    original = target.read_text(encoding="utf-8")
    updated = make_patch(original)
    java = args.glass_source.read_text(encoding="utf-8")
    if "final class GogoGlassClock {" not in java:
        raise ValueError("Invalid Java source")
    if dest.exists() and dest.read_text(encoding="utf-8") != java:
        raise ValueError("Existing GogoGlassClock.java differs; refusing overwrite")
    args.backup.mkdir(parents=True, exist_ok=True)
    backup = args.backup / "MainActivity.java"
    if not backup.exists():
        shutil.copy2(target, backup)
    if original != updated:
        target.write_text(updated, encoding="utf-8")
    if not dest.exists():
        dest.write_text(java, encoding="utf-8")
    print("Native Glass source patched and backed up. No TV changes.")

if __name__ == "__main__":
    main()
