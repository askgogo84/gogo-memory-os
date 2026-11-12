#!/usr/bin/env bash
# Standalone Gogo TV app; never replaces tvOS Launcher.
set -euo pipefail
cd "$(dirname "$0")"
SDK="$(printenv ANDROID_HOME || true)"
if [ -z "$SDK" ]; then SDK="$HOME/Android/Sdk"; fi
BT="$SDK/build-tools/36.0.0"
JAR="$SDK/platforms/android-34/android.jar"
EXE=
CP_SEP=:
case "$(uname -s)" in MINGW*|MSYS*) EXE=.exe; CP_SEP=";";; esac
for x in "$BT/aapt2$EXE" "$BT/lib/d8.jar" "$BT/zipalign$EXE" "$BT/lib/apksigner.jar" "$JAR"; do
  test -f "$x" || { echo "Missing SDK component: $x" >&2; exit 1; }
done
ORIGIN="${GOGO_TV_ORIGIN:-https://app.askgogo.in}"
if ! [[ "$ORIGIN" =~ ^https://[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$ ]]; then
  echo "Set GOGO_TV_ORIGIN to a fixed HTTPS origin without a path" >&2
  exit 1
fi
mkdir -p build
BUILD="$(mktemp -d "$PWD/build/compile.XXXXXX")"
PY="${PYTHON:-python3}"
trap '"$PY" -c "import pathlib, shutil, sys; path = pathlib.Path(sys.argv[1]).resolve(); root = pathlib.Path(sys.argv[2]).resolve(); assert path.parent == root and path.name.startswith(\"compile.\"); shutil.rmtree(path)" "$BUILD" "$PWD/build"' EXIT
VENDOR="${GOGO_TV_OFFLINE_CACHE:-$PWD/build/offline-cache}"
mkdir -p "$BUILD"/{src,classes,dex}
sed '1s/^package com\.techgenius\.tvoslauncher;/package in.askgogo.tvhub;/' ../GogoHubActivity.java > "$BUILD/src/GogoHubActivity.java"
grep -q '^package in.askgogo.tvhub;' "$BUILD/src/GogoHubActivity.java"
printf 'package in.askgogo.tvhub; final class BuildConfig { static final String ORIGIN = "%s"; }\n' "$ORIGIN" > "$BUILD/src/BuildConfig.java"
"$BT/aapt2$EXE" compile --dir res -o "$BUILD/res.zip"
"$BT/aapt2$EXE" link -o "$BUILD/unsigned.apk" -I "$JAR" --manifest AndroidManifest.xml \
  --min-sdk-version 26 --target-sdk-version 34 --version-code "${GOGO_TV_VERSION_CODE:-3}" --version-name "${GOGO_TV_VERSION_NAME:-0.3.0}" "$BUILD/res.zip"
"$PY" offline_assets.py prepare "$BUILD" "$VENDOR"
OFFLINE_JAR="$BUILD/offline.jar"
if [ -n "$EXE" ]; then OFFLINE_JAR="$(cygpath -m "$OFFLINE_JAR")"; fi
javac -encoding UTF-8 --release 11 -classpath "$JAR$CP_SEP$OFFLINE_JAR" -d "$BUILD/classes" "$BUILD/src/"*.java src/*.java
jar cf "$BUILD/classes.jar" -C "$BUILD/classes" .
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release --min-api 26 --lib "$JAR" --output "$BUILD/dex" "$BUILD/classes.jar" "$BUILD/offline.jar"
"$PY" offline_assets.py pack "$BUILD" "$VENDOR"
"$BT/zipalign$EXE" -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"
if [ -n "${GOGO_TV_SIGNING_KEYSTORE:-}" ]; then
  : "${GOGO_TV_SIGNING_ALIAS:?Set the companion key alias}" "${GOGO_TV_STORE_PASS:?Set the companion keystore password}" "${GOGO_TV_KEY_PASS:?Set the companion key password}"
  KEYSTORE="$GOGO_TV_SIGNING_KEYSTORE"
  ALIAS="$GOGO_TV_SIGNING_ALIAS"
  STORE_PASS=env:GOGO_TV_STORE_PASS
  KEY_PASS=env:GOGO_TV_KEY_PASS
  ARTIFACT=build/gogo-tv-companion-release.apk
else
  KEYSTORE=build/dev.keystore
  ALIAS=gogo-dev
  STORE_PASS=pass:android
  KEY_PASS=pass:android
  ARTIFACT=build/gogo-tv-companion-test.apk
  if [ ! -f "$KEYSTORE" ]; then
    keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias "$ALIAS" \
      -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Gogo TV Test" >/dev/null
  fi
fi
java -jar "$BT/lib/apksigner.jar" sign --ks "$KEYSTORE" --ks-key-alias "$ALIAS" \
  --ks-pass "$STORE_PASS" --key-pass "$KEY_PASS" --out "$BUILD/signed.apk" "$BUILD/aligned.apk"
java -jar "$BT/lib/apksigner.jar" verify --print-certs "$BUILD/signed.apk"
mv -f "$BUILD/signed.apk" "$ARTIFACT"
echo "GOGO_TV_COMPANION_BUILD_OK $ARTIFACT"
