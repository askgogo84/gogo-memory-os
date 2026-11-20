"""Static companion security checks alongside the Android and TV API suites."""
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent / "companion"
ns = "{http://schemas.android.com/apk/res/android}"
manifest = ET.parse(root / "AndroidManifest.xml").getroot()
assert manifest.get("package") == "in.askgogo.tvhub"
assert manifest.find("application").get(ns + "allowBackup") == "false"
assert manifest.find("application").get(ns + "usesCleartextTraffic") == "false"
assert [node.get(ns + "name") for node in manifest.findall(".//activity")] == [".CompanionActivity"]
assert {node.get(ns + "name") for node in manifest.findall(".//category")} == {
    "android.intent.category.LAUNCHER", "android.intent.category.LEANBACK_LAUNCHER",
}
assert not manifest.findall(".//service"), "No background microphone or accessibility service"
app = (root / "src/CompanionActivity.java").read_text(encoding="utf-8")
api = (root / "src/TvApi.java").read_text(encoding="utf-8")
controls = (root / "src/GogoTvControls.java").read_text(encoding="utf-8")
assert "FLAG_SECURE" in app and "onStop()" in app and "stopWake()" in app
assert "Transcribe recording" in app and "Review the transcript before sending" in app
assert "UtteranceProgressListener" in app
assert '"device", "PUT", proof, "application/json",' in app and '"{}".getBytes(StandardCharsets.US_ASCII)' in app
assert "FLAG_KEEP_SCREEN_ON" in app
assert '"/api/tv/"' in api and "setInstanceFollowRedirects(false)" in api
assert "/api/mobile/" not in app + api and "/api/agent/" not in app + api
assert "GogoTvControls.description(text)" in app and "Control this TV?" in app
for pkg in ("com.google.android.youtube.tv", "com.netflix.ninja", "com.amazon.amazonvideo.livingroom"):
    assert pkg in controls
for forbidden in ("Runtime.getRuntime()", "ProcessBuilder", "sendevent", "CATEGORY_HOME", "WRITE_SECURE_SETTINGS"):
    assert forbidden not in controls, forbidden
assert "audio.adjustStreamVolume" in controls
print("Gogo TV manifest, voice lifecycle, credential boundary and control allowlist passed")
