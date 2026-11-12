"""Fetch and package checksum-pinned, redistributable offline speech assets."""
import hashlib
import io
import re
import sys
import urllib.request
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

ASSETS = {
    "zxing-core.jar": (
        "https://repo.maven.apache.org/maven2/com/google/zxing/core/3.5.3/core-3.5.3.jar",
        "8d8064c1636fdaef7189dd9055c7d59950a8940a12f2293956446ec3c109fd82",
    ),
    "vosk.aar": (
        "https://repo.maven.apache.org/maven2/com/alphacephei/vosk-android/0.3.75/vosk-android-0.3.75.aar",
        "ab2f8b91ac8051561aa325546b35fed9a68b36b8121bac5c6fb927525c4adfad",
    ),
    "jna.aar": (
        "https://repo.maven.apache.org/maven2/net/java/dev/jna/jna/5.18.1/jna-5.18.1.aar",
        "7f053e3ec99e14dd71259c82c1c8a02738d64a13c31226b2acc170f3060951e0",
    ),
    "model.zip": (
        "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
        "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498",
    ),
    "apache.txt": (
        "https://www.apache.org/licenses/LICENSE-2.0.txt",
        "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    ),
}
NATIVE = re.compile(r"jni/(arm64-v8a|armeabi-v7a|x86|x86_64)/(libvosk|libjnidispatch)\.so")

def verified(cache, name):
    path = cache / name
    url, expected = ASSETS[name]
    if not path.is_file():
        with urllib.request.urlopen(url, timeout=45) as response:
            data = response.read(64 * 1024 * 1024 + 1)
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError(f"Unexpected {name} checksum")
        path.write_bytes(data)
    with path.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
            raise ValueError(f"Unexpected cached {name} checksum")
    return path

def prepare(build, cache):
    cache.mkdir(exist_ok=True, parents=True)
    native = set()
    with ZipFile(build / "offline.jar", "w", ZIP_DEFLATED) as jar:
        with ZipFile(verified(cache, "zxing-core.jar")) as zxing:
            for entry in zxing.namelist():
                if entry.endswith(".class") and not entry.startswith("META-INF/"):
                    jar.writestr(entry, zxing.read(entry))
        for library in ("vosk.aar", "jna.aar"):
            with ZipFile(verified(cache, library)) as aar:
                with ZipFile(io.BytesIO(aar.read("classes.jar"))) as classes:
                    for entry in classes.namelist():
                        if entry.endswith(".class"):
                            jar.writestr(entry, classes.read(entry))
                        elif re.search(r"(^|/)(license|notice|copying)[^/]*$", entry, re.I) and not entry.endswith("/"):
                            target = build / "licenses" / library / Path(entry).name
                            target.parent.mkdir(parents=True, exist_ok=True)
                            target.write_bytes(classes.read(entry))
                for entry in aar.namelist():
                    if NATIVE.fullmatch(entry):
                        native.add(entry)
                        target = build / "lib" / entry.removeprefix("jni/")
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(aar.read(entry))
    if len(native) != 8:
        raise ValueError("Vosk/JNA ABI coverage differs from the pinned build")
    verified(cache, "model.zip")

def pack(build, cache):
    with ZipFile(build / "unsigned.apk", "a") as apk:
        for path in sorted((build / "dex").glob("classes*.dex")):
            apk.write(path, path.name, ZIP_DEFLATED)
        for path in sorted((build / "lib").glob("*/*.so")):
            apk.write(path, path.relative_to(build).as_posix(), ZIP_STORED)
        apk.write(verified(cache, "model.zip"), "assets/vosk-model-small-en-us-0.15.zip", ZIP_STORED)
        apk.write(verified(cache, "apache.txt"), "assets/licenses/Apache-2.0.txt", ZIP_DEFLATED)
        for path in sorted((build / "licenses").glob("**/*")):
            if path.is_file():
                apk.write(path, "assets/" + path.relative_to(build).as_posix(), ZIP_DEFLATED)
        apk.write(Path(__file__).with_name("THIRD_PARTY.txt"), "assets/licenses/THIRD_PARTY.txt", ZIP_DEFLATED)

if __name__ == "__main__":
    action, build, cache = sys.argv[1:]
    {"prepare": prepare, "pack": pack}[action](Path(build), Path(cache))
