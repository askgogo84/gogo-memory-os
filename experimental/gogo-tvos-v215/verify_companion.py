"""Gogo TV companion v0.2 acceptance gate (static, negative-control design assertions).

Requires NO provider secrets, microphones, emulator, network or TV connection.
Android compile and actual authenticated device test remain separate gates.
"""
from pathlib import Path
import xml.etree.ElementTree as ET

root=Path(__file__).resolve().parent
manifest=root/"companion/AndroidManifest.xml"
brain=(root/"companion/GogoBrainActivity.java").read_text(encoding="utf-8")
hub=(root/"GogoHubActivity.java").read_text(encoding="utf-8")
controls=(root/"companion/GogoTvControls.java").read_text(encoding="utf-8")
xml=ET.parse(manifest).getroot()
ns="{http://schemas.android.com/apk/res/android}"
package=xml.attrib.get("package")
assert package=="in.askgogo.tvhub"
activities=xml.findall("./application/activity")
assert len(activities)==2, "Hub and Brain should be the only activities"
assert any(a.attrib.get(ns+"name")==".GogoBrainActivity" and a.attrib.get(ns+"exported")=="false" for a in activities)
for activity in activities:
    if activity.attrib.get(ns+"name")==".GogoBrainActivity":
        assert not activity.findall("intent-filter"), "Private Brain must not expose an external intent"
    for filt in activity.findall("intent-filter"):
        for category in filt.findall("category"):
            assert category.attrib.get(ns+"name") not in ("android.intent.category.HOME","android.intent.category.LEANBACK_HOME")
assert 'com.techgenius.tvoslauncher' not in str(manifest.read_text(encoding="utf-8"))
for endpoint in ("/api/mobile/link/otp/start", "/api/mobile/link/otp/verify",
                 "/api/mobile/session/exchange", "/api/mobile/session/logout",
                 "/api/agent/run"):
    assert endpoint in brain, "Missing canonical AskGogo API "+endpoint
assert 'Intent.ACTION_VIEW' not in hub[hub.index("private void openAskGogo()"):hub.index("private void openCouchRemote()")]
assert "new Intent(this, GogoBrainActivity.class)" in hub
assert "private void sendPrompt()" in brain and "new AlertDialog.Builder(this)" in brain
voice=brain[brain.index("protected void onActivityResult"):brain.index("@Override public void onInit")]
assert "prompt.setText(phrase)" in voice
assert "submit(" not in voice, "Dictation must not submit autonomously"
assert "onStop()" in brain and "accessToken = null;" in brain
assert 'putString("accessToken"' not in brain and 'putString("pollToken"' not in brain
assert "UtteranceProgressListener" in brain and "tts.stop()" in brain
assert "GogoTvControls.description(text)" in brain and "Control this TV?" in brain
assert "GogoTvControls.execute(this,text)" in brain
for pkg in ("com.google.android.youtube.tv", "com.netflix.ninja", "com.amazon.amazonvideo.livingroom"):
    assert pkg in controls
for forbidden in ("Runtime.getRuntime()", "ProcessBuilder", "exec(", "sendevent", "pm disable"):
    assert forbidden not in controls, "Privileged shell/injection forbidden: "+forbidden
assert "audio.adjustStreamVolume" in controls
assert "recordAudio" not in brain and "MicrophoneService" not in brain
print("GOGO_COMPANION_V02_SECURITY_GATE_OK")
