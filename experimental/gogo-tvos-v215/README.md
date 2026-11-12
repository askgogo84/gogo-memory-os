# Gogo TV companion for Android TV

Gogo TV installs as `in.askgogo.tvhub`. Open it from the existing launcher’s Apps row or pin it using the launcher’s normal dock settings. The companion has no Android Home role, accessibility service, or secure-settings permission. Its three personal profiles and Guest profile are independent of launcher profiles and wallpapers.

The [official techgenius1 v2.1.5 release](https://github.com/techgenius1/tvOS-Launcher/releases/tag/v2.1.5) and upstream default branch resolved to `463fa6c2a9b7322c4407f1d00db935ef09d20f4f` on 12 November 2026. The optional source patch builds an off-by-default dashboard tile scoped to the launcher’s current profile. Its activity can open the installed companion. CI compiles the patched launcher for source compatibility. Install only the independent companion on the TCL.

The TCL’s 12 November baseline confirmed Android 11 and Gadgetcue 2.0.5 (`com.sid.tvos`). Gadgetcue’s enabled accessibility service handles the Home key, while Android’s system Home resolves to the Google launcher. Couch TV v0.11 is already installed. These are device observations. The pinned techgenius1 source is a separate compatibility build.

## Companion features

- Markets loads [TradingView’s official ticker tape](https://www.tradingview.com/widget-docs/widgets/tickers/ticker-tape/) only when selected, with a retry and a link to TradingView if the embed fails. Verify the provider’s attribution, symbol coverage, and delay indicators on the TV WebView.
- AskGogo uses the existing AskGogo model, owner-scoped calendar reader, and saved facts. The TV credential has the server-assigned `ask:read` scope. General answers receive the question and display name. Calendar reads use the paired account’s calendar connection. Ask “What do you remember about …?” to retrieve matching recent saved facts through the existing recall filters. Account actions, conversation history, vault access, and approval execution are outside the TV API.
- In a personal profile, enable **Microphone** in Settings. **Record a question** starts a clip of up to 20 seconds. **Listen for Hey Gogo** arms the bundled offline detector for up to two minutes on the AskGogo screen. Wait for **Recording…** before speaking after wake. Use **Transcribe recording** to send the clip for transcription, then review the text before sending it as a question. The mic stops when the app leaves the foreground. Reply playback is opt-in, uses an installed offline voice, and pauses wake or recording around playback. Audio capture uses platform echo cancellation where available.
- TV controls use local media volume and hand off to the existing Couch TV app (`dev.couchtv.ontv`). The latest published [Couch TV release](https://github.com/Seagey/couch-tv/releases/tag/v0.12) was v0.12 when checked. Continue using the installed version’s paired phone remote and device-side ADB setup. If controls fail, open Couch TV’s own connection screen and check its authorization independently. The companion starts no ADB listener and carries no Couch TV token.
- In an unlocked profile, exact phrases such as “open YouTube” and “volume up” can run as local commands after on-screen confirmation. Settings has a per-profile switch for these commands. Use the physical remote’s Home key to invoke Gadgetcue’s remapping.

## Pair against an isolated preview

1. Use a preview tied to a disposable test database and test accounts. Apply `20261112100000_tv_pairing.sql` and `20261112130000_tv_pairing_qr.sql` there and set `GOGO_TV_PAIRING=1` and `GOGO_TV_RATE_KEY` to a random secret of at least 32 characters in the preview environment. Use the existing preview dashboard sign-in and test-only WhatsApp, model, and calendar configuration. The public pairing start uses Vercel’s trusted client-IP header for throttling. `GOGO_TV_LOCAL_TEST=1` is a single rate bucket for local test setups without that header.
2. Build the APK with `GOGO_TV_ORIGIN` set to the preview’s reachable HTTPS origin. The TV API blocks redirects. The CI APK uses `https://tv-preview.invalid` for guest/offline smoke tests.
3. Open **AskGogo** to display the QR. If the TV already has saved profiles, choose the personal slot to pair. Scan with your phone, or enter the eight-character code on the phone. If signed out, use the existing AskGogo WhatsApp sign-in. Compare the code on both screens, review the TV name and read-only access, then tap **Approve this TV**. The TV opens AskGogo automatically.
4. A pairing code expires after five minutes. Approval activates only the original TV’s bound credential, for up to twelve hours. Settings offers optional PIN-protected storage for that session. Otherwise the app clears its temporary credential and requests revocation when the app stops or you switch profiles. Revoke a specific TV at any time from the phone’s pairing page or the TV profile’s Settings.
5. If a profile PIN is lost, revoke that TV entry on the phone before clearing the companion’s Android app data. Clearing its app data resets all of its local profiles and toggles.

## Build and signing

Use JDK 17, Python 3.11+, Android SDK platform 34 and build-tools 36.0.0. The source compatibility build also uses upstream’s build-tools 34.0.0. From `experimental/gogo-tvos-v215/companion`, run `./build.sh` on Linux, macOS, or Git Bash with `ANDROID_HOME` pointing to the SDK. On Windows, `Build-GogoTVCompanion-Windows.ps1` runs the same build. The build verifies the offline model and native dependencies against pinned SHA-256 digests.

The default artifact is `build/gogo-tv-companion-test.apk`, signed with a local test key in `build/dev.keystore`. CI keys are disposable. Android requires the same signer for an in-place update. For a stable build, set `GOGO_TV_SIGNING_KEYSTORE`, `GOGO_TV_SIGNING_ALIAS`, `GOGO_TV_STORE_PASS`, and `GOGO_TV_KEY_PASS` in the build environment and increase `GOGO_TV_VERSION_CODE` for updates. The release artifact is `build/gogo-tv-companion-release.apk`. Keep signing material in the chosen secure store and record the APK SHA-256 and signer SHA-256 with each release.

## TCL acceptance

1. Use the physical remote to note the active launcher, selected profile, dock, wallpaper, and Home-key behavior. Use the launcher’s normal backup UI if available.
2. Run `adb devices -l`. If the TV is unauthorized, leave the TV awake, reconnect only the TCL endpoint and accept the computer’s debugging prompt on the TV. Keep existing debugging authorizations in place. On a TV exposing the Wireless debugging pairing screen, pair the computer from that screen using its displayed port and code, then connect to the separate debugging port.
3. Once the target shows `device`, record a baseline and install with the verified APK checksum and companion signer. Replace the placeholders with the observed target, launcher, APK, and SDK paths.

   ```text
   python tv_acceptance.py --adb <adb> --serial <target> probe
   python tv_acceptance.py --adb <adb> --serial <target> --launcher <existing.package> snapshot --out tv-before.json
   python tv_acceptance.py --adb <adb> --serial <target> --launcher <existing.package> install --baseline tv-before.json --apk <companion.apk> --sha256 <apk-sha256> --signer <cert-sha256> --aapt2 <aapt2> --apksigner <apksigner.jar>
   python tv_acceptance.py --adb <adb> --serial <target> launch
   ```

4. Verify D-pad navigation and Back, Markets attribution and live loading, volume/mute, and the existing phone remote’s D-pad/playback using Couch TV. Verify Home from both Markets and AskGogo. Revisit all launcher profiles and wallpapers and repeat after a reboot. Compare the launcher, resolved Home, accessibility, and Couch TV against the baseline using the script’s `verify --baseline tv-before.json`.
5. On a preview build, verify WhatsApp sign-in, one-time pairing, two different accounts in two slots, a locked profile after Home, and guest isolation. Ask each account for its calendar and verify the other account’s events are absent. Revoke one credential from the phone and verify the next TV request is rejected while the other profile still works.
6. Test the physical microphone and remote. Verify permission denial, recording stop/discard, offline wake without traffic during listening, recording with the TV playing media, absence of wake on spoken replies, mic shutdown after Home, and voice feature toggles per profile. Measure false wakes and memory/load time on the TCL.

## Rollback

- To hide the companion while preserving its data, use `tv_acceptance.py --adb <adb> --serial <target> disable`. Use `enable` to restore it. Run the baseline comparison again. Keep the original launcher and Couch TV packages installed.
- To suspend AskGogo TV access, switch the preview’s pairing flag off. Revoke credentials from the pairing page as needed. The owner/device revocation routes remain available while the flag is off. For complete backend rollback, retire the TV routes and apply the companion rollback migration to the preview database. This deletes the pairing records.

## Automated verification

The PR workflow compiles upstream with the optional patch, verifies the standalone APK and supported offline speech ABIs, checks the permission and launcher boundaries, runs the database/protocol regression suite, and type-checks the app. Its results are separate from preview account tests and TCL hardware acceptance.
