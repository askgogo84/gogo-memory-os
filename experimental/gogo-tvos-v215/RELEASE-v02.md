# Gogo TV Companion v0.2 — build & acceptance (12 Nov 2026)

## Delivery status
tvOS Launcher upstream v2.1.5 remains the supported home screen. Gogo TV is a separate app with Android package `in.askgogo.tvhub`, no HOME intent, no stock-launcher removal, and no alteration of existing wallpapers, profiles, CleanYourTV services or tvOS settings.
Source branch: feature/gogo-tvos-v215-hub-20261112, draft PR #1504. CI compiles a native tvOS extension and independent companion test APK. A separate Windows build workflow validates the exact PowerShell builder.

### Implemented in companion v0.2
- App launchable from the tvOS app list and pinnable to the dock.
- Native Hub with a branded, on-demand TradingView Markets screen (no Twelve Data Basic API display), AskGogo personal sign-in, and Couch TV phone remote shortcut.
- Canonical AskGogo WhatsApp OTP flow (Android platform): OTP start, verify, one-time exchange. Uses the same mobile session mechanism as AskGogo's existing Android app and the authenticated `/api/agent/run` Same Brain endpoint.
- Protected Android session: token is held in RAM only, never persisted; returning Home clears the token and conversation display. Closing app normally can issue server-side session logout. Android session lifetime on backend remains an independently governed server property.
- Typed conversation, suggested read-only queries, explicit confirmation for every Send, no microphone transcript submitted automatically.
- Voice: on-demand Android speech-recognition intent, en-IN default; TTS spoken replies OFF by default, opt-in; recognizer and TTS do not run simultaneously; 5s identical-transcript echo guard; TTS stop on exit.
- No resident background mic service, no cloud API key in APK, no stock HOME button intercept.
- Market view opens its WebView only on demand and destroys it after exit. TradingView attribution is retained; exchanges may delay/omit symbols.

### What remains hardware-dependent / NOT implemented
- True passive always-listening 'Hey Gogo' on TV and power-on from standby. Requires offline wake engine, TV microphone/remote support, battery/CPU measurement, Android foreground service consent, and echo tests. On-TV apps cannot power on a sleeping TV by themselves.
- Direct execution of arbitrary TV remote keypresses through Couch TV; that requires a separately authorized local bridge. Current companion safely opens the installed remote app.
- Per-profile permanent AskGogo sessions. Current shared-TV safety model requires WhatsApp OTP after leaving the assistant, avoiding cross-profile leakage.
- Exact market coverage of eight instruments; licensed paid API display is not enabled. Official TradingView widget controls availability and delays.
- Home dashboard overlay install on the signed official tvOS Launcher; experimental native source fork compiles but cannot replace an official-signed APK in place without its signing key. A separate companion is supported.
- End-to-end TCL installation and functional testing are NOT verified because last observed ADB was unauthorized.

## Windows install workflow
Open PowerShell and run the script from the raw branch URL. It downloads sources, builds the APK using JDK17 and SDK 34, signs it with a stable local development keystore, and installs only if the ADB device is verified and authorized.

```powershell
$url = 'https://raw.githubusercontent.com/askgogo84/gogo-memory-os/feature/gogo-tvos-v215-hub-20261112/experimental/gogo-tvos-v215/Build-GogoTVCompanion-Windows.ps1'
$file = "$env:USERPROFILE\Downloads\Build-GogoTVCompanion-Windows.ps1"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $file
# Build first without touching the TV:
powershell -NoProfile -ExecutionPolicy Bypass -File $file
# Once ready to install:
powershell -NoProfile -ExecutionPolicy Bypass -File $file -Install -TvIp 192.168.29.122
```

Output APK: `C:\Users\gover\Downloads\GogoTV-Companion-v02\build\gogo-tv-companion.apk`. Keep the signing keystore at `%USERPROFILE%\.gogo-tv\signing\companion-dev.keystore` private to update the app safely. Do not share that keystore.

## Test cases on real TCL
1. Confirm tvOS Launcher is still Home and retains bottom dock, wallpaper folder shuffle, date/time, weather, profile switch and after reboot.
2. Gogo TV icon appears in tvOS Other Apps. Open without changing the HOME/default launcher selection.
3. Markets: branded TradingView widget renders (or honest missing-data fallback), no fake prices. Back returns to Gogo Hub.
4. Remote: Couch TV app opens; existing phone pairing still works; no new accessibility permission enabled.
5. AskGogo: enter existing WhatsApp account number, request OTP, verify; zero codes/secrets logged or stored in prefs.
6. Press Send only after confirmation; response matches AskGogo Same Brain, with user-bound data.
7. Press Mic: speech fills draft, no auto-send. Turn read-aloud ON, ask then stop speaking and confirm no echo/repeated submissions.
8. Press Home/leave: return to Assistant should show OTP sign-in and no previous private reply.
9. User with another tvOS profile must not read previous user's tokens/chat; ensure full reauthentication.
10. ADB `unauthorized` must halt Windows install without touching tvOS package. No UI does Home takeover.
11. Check Android performance while navigating native tvOS dock; companion app must not be running a constant WebView.
12. Disconnect in assistant: local token cleared and server `/api/mobile/session/logout` returns `ok:true` if available.

## CI checks
- `verify_companion.py` asserts no HOME intent, private Brain activity, canonical OTP endpoints, explicit Send, echo guard and no token storage.
- CI compiles both the optional upstream tvOS fork and the independent companion APK.
- Windows workflow runs the actual PowerShell builder without installing to TV.
- CI success proves source compilation, NOT a successful TCL install or network authentication.

## Recovery
- If companion causes trouble, open Android TV Settings -> Apps -> Gogo TV -> Uninstall. The tvOS Launcher has not been replaced and retains its settings.
- Do NOT uninstall tvOS Launcher, CleanYourTV, Google TV original launcher, or revoke ADB authorizations to fix companion-only issues.
- Do NOT merge the experimental fork into AskGogo production until TV and account security tests pass.