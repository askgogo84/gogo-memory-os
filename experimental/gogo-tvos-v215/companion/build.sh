#!/usr/bin/env bash
# Standalone Gogo TV app; never replaces tvOS Launcher.
set -euo pipefail
cd "$(dirname "$0")"
SDK="$(printenv ANDROID_HOME || true)"
if [ -z "$SDK" ]; then SDK="$HOME/Android/Sdk"; fi
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
for x in "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" "$JAR"; do
  test -f "$x" || { echo "Missing SDK component: $x" >&2; exit 1; }
done
mkdir -p build/src build/classes build/dex
sed '1s/^package com\.techgenius\.tvoslauncher;/package in.askgogo.tvhub;/' ../GogoHubActivity.java > build/src/GogoHubActivity.java
grep -q '^package in.askgogo.tvhub;' build/src/GogoHubActivity.java
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/unsigned.apk -I "$JAR" --manifest AndroidManifest.xml --min-sdk-version 24 --target-sdk-version 34 --version-code 1 --version-name 0.1.0 build/res.zip
javac -encoding UTF-8 --release 11 -classpath "$JAR" -d build/classes build/src/GogoHubActivity.java
jar cf build/classes.jar -C build/classes .
"$BT/d8" --release --min-api 24 --lib "$JAR" --output build/dex build/classes.jar
(cd build/dex && zip -q ../unsigned.apk classes.dex)
"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk
KS="$PWD/dev.keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias gogo-dev -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Gogo TV Dev" >/dev/null
fi
"$BT/apksigner" sign --ks "$KS" --ks-key-alias gogo-dev --ks-pass pass:android --key-pass pass:android --out build/gogo-tv-companion.apk build/aligned.apk
"$BT/apksigner" verify build/gogo-tv-companion.apk
echo 'GOGO_TV_COMPANION_BUILD_OK — package in.askgogo.tvhub; original launcher untouched'
