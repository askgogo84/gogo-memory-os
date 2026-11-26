"""Inspect a specified Android TV and operate on the Gogo companion only."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

COMPANION = "in.askgogo.tvhub"
COUCH = "dev.couchtv.ontv"
SAFE_KEYS = {
    "up": "KEYCODE_DPAD_UP", "down": "KEYCODE_DPAD_DOWN",
    "left": "KEYCODE_DPAD_LEFT", "right": "KEYCODE_DPAD_RIGHT",
    "select": "KEYCODE_DPAD_CENTER", "back": "KEYCODE_BACK",
    "play-pause": "KEYCODE_MEDIA_PLAY_PAUSE", "volume-up": "KEYCODE_VOLUME_UP",
    "volume-down": "KEYCODE_VOLUME_DOWN", "mute": "KEYCODE_VOLUME_MUTE",
}

def call(*args, timeout=15):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(result.stdout.strip() or f"Command failed ({result.returncode})")
    return result.stdout.strip()

def adb_state(output, serial):
    for line in output.splitlines():
        fields = line.split()
        if len(fields) >= 2 and fields[0] == serial:
            return fields[1]
    return "absent"

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def snapshot(adb, launcher):
    def package(name):
        installed = adb("shell", "pm", "list", "packages", "--user", "0", name)
        if f"package:{name}" not in installed.splitlines():
            return None
        paths = adb("shell", "pm", "path", name)
        if not paths.startswith("package:"):
            raise RuntimeError(f"Could not determine the installed path for {name}.")
        dump = adb("shell", "dumpsys", "package", name)
        version = re.search(r"\bversionName=([^\r\n]+)", dump)
        enabled = re.search(r"User 0:.*?\benabled=(\d+)", dump)
        return {"path": paths, "version": version[1] if version else None,
                "enabled": enabled[1] if enabled else None}

    current_launcher = package(launcher)
    if not current_launcher or not current_launcher["version"]:
        raise RuntimeError("Could not identify the specified installed launcher.")
    accessibility = adb("shell", "settings", "get", "secure", "enabled_accessibility_services")
    home = adb("shell", "cmd", "package", "resolve-activity", "--brief",
               "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME")
    return {
        "model": adb("shell", "getprop", "ro.product.model"),
        "android": adb("shell", "getprop", "ro.build.version.release"),
        "launcher_package": launcher, "launcher": current_launcher,
        "home": home.splitlines()[-1] if home else None,
        "accessibility_enabled": adb("shell", "settings", "get", "secure", "accessibility_enabled"),
        "accessibility_sha256": digest(":".join(sorted(accessibility.split(":")))),
        "companion": package(COMPANION), "couch": package(COUCH),
    }

def preserved(before, after):
    keys = ("model", "android", "launcher_package", "launcher", "home",
            "accessibility_enabled", "accessibility_sha256", "couch")
    return [key for key in keys if before.get(key) != after.get(key)]

def verify_apk(args):
    apk = str(Path(args.apk).resolve(strict=True))
    with open(apk, "rb") as handle:
        checksum = hashlib.file_digest(handle, "sha256").hexdigest()
    if checksum.lower() != args.sha256.lower():
        raise RuntimeError("APK checksum differs from the approved artifact.")
    certs = call(args.java, "-jar", args.apksigner, "verify", "--print-certs", apk)
    fingerprints = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([\da-f]+)$", certs, re.M | re.I)
    if len(fingerprints) != 1 or fingerprints[0].lower() != args.signer.lower():
        raise RuntimeError("APK signer differs from the approved companion signer.")
    info = call(args.aapt2, "dump", "badging", apk)
    package = re.search(r"^package: name='in\.askgogo\.tvhub' versionCode='\d+' versionName='([^']+)'", info, re.M)
    if not package:
        raise RuntimeError("APK package is not in.askgogo.tvhub.")
    xml = call(args.aapt2, "dump", "xmltree", "--file", "AndroidManifest.xml", apk)
    if "android.intent.category.HOME" in xml or "android.permission.BIND_ACCESSIBILITY_SERVICE" in xml:
        raise RuntimeError("APK declares an incompatible system role.")
    return apk, package[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--connect", action="store_true", help="Request ADB connection to the specified endpoint.")
    parser.add_argument("--launcher", help="Package of the launcher already installed on the TV.")
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("probe")
    record = actions.add_parser("snapshot")
    record.add_argument("--out", type=Path, required=True)
    verify = actions.add_parser("verify")
    verify.add_argument("--baseline", type=Path, required=True)
    install = actions.add_parser("install")
    install.add_argument("--baseline", type=Path, required=True)
    install.add_argument("--apk", required=True)
    install.add_argument("--aapt2", required=True)
    install.add_argument("--apksigner", required=True, help="Path to the SDK apksigner.jar")
    install.add_argument("--java", default="java")
    install.add_argument("--sha256", required=True)
    install.add_argument("--signer", required=True)
    actions.add_parser("launch")
    actions.add_parser("disable")
    actions.add_parser("enable")
    key = actions.add_parser("key")
    key.add_argument("name", choices=SAFE_KEYS)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.:\[\]-]{0,159}", args.serial):
        parser.error("Invalid serial.")
    if args.action in ("snapshot", "verify", "install"):
        if not args.launcher or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_.]{1,159}", args.launcher) or args.launcher == COMPANION:
            parser.error("Use --launcher to specify the existing launcher package.")
    if args.connect:
        if not re.fullmatch(r"(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\]):\d{1,5}", args.serial):
            parser.error("Connect requires an explicit host and port.")
        print(call(args.adb, "connect", args.serial))

    state = adb_state(call(args.adb, "devices", "-l"), args.serial)
    print(f"ADB target state: {state}")
    if state != "device":
        raise RuntimeError("Authorize this computer on the TV or connect the correct target before continuing.")
    if args.action == "probe":
        return

    def adb(*command, timeout=15):
        return call(args.adb, "-s", args.serial, *command, timeout=timeout)

    if args.action == "snapshot":
        args.out.write_text(json.dumps(snapshot(adb, args.launcher), indent=2) + "\n", encoding="utf-8")
        print(f"Saved baseline to {args.out}")
    elif args.action in ("verify", "install"):
        before = json.loads(args.baseline.read_text(encoding="utf-8"))
        changed = preserved(before, snapshot(adb, args.launcher))
        if changed:
            raise RuntimeError("TV differs from the baseline: " + ", ".join(changed))
        if args.action == "install":
            apk, version = verify_apk(args)
            installed = adb("install", "-r", apk, timeout=180)
            if not installed.splitlines() or installed.splitlines()[-1] != "Success":
                raise RuntimeError("ADB did not report a successful install.")
            after = snapshot(adb, args.launcher)
            changed = preserved(before, after)
            if changed:
                raise RuntimeError("Post-install verification failed: " + ", ".join(changed))
            if not after["companion"] or after["companion"]["version"] != version:
                raise RuntimeError("Installed companion version could not be verified.")
            print("Companion installed. Run the physical Home, profiles and wallpaper checks next.")
        else:
            print("Launcher package, version, Home resolution, accessibility and Couch TV match the baseline.")
    elif args.action == "launch":
        print(adb("shell", "am", "start", "-n", f"{COMPANION}/.CompanionActivity"))
    elif args.action in ("disable", "enable"):
        command = "disable-user" if args.action == "disable" else "enable"
        print(adb("shell", "pm", command, "--user", "0", COMPANION))
    elif args.action == "key":
        adb("shell", "input", "keyevent", SAFE_KEYS[args.name])

if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        raise SystemExit(str(error)) from None
