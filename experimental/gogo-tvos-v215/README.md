# Gogo TV on tvOS Launcher v2.1.5 — 12 Nov 2026

## Verified upstream
Upstream: https://github.com/techgenius1/tvOS-Launcher
Latest published release: v2.1.5 (9 Nov 2026); source licensed Apache 2.0.
Features already present: native fast liquid-glass dock, two Home looks, four dashboard widgets, three user profiles, per-profile app layouts, native weather, clock alignment, unlimited wallpapers/folder shuffle, button mapping, Secure ADB and settings backup/restore.

## This experimental work
- GogoWidgets.java adds one optional, default-OFF native dashboard tile with no network polling.
- GogoHubActivity.java is a separate screen with AskGogo website shortcut, an on-demand official TradingView branded ticker, and existing Couch TV remote shortcut.
- patch_tvos_v215.py inserts the widget, Settings toggle, and activity in the upstream v2.1.5 source. Original MainActivity and Home intent remain unchanged.
- companion/AndroidManifest.xml + companion/build.sh package the same Hub as an independent, launchable app with package in.askgogo.tvhub.

## Recommended installation
Use the independent Gogo TV companion first. It is a DIFFERENT Android package from the current tvOS Launcher and has no HOME intent, so it will not take over the Home button. It appears as an app that can be pinned to the tvOS dock.
Build the companion with Android SDK API34 / build-tools34 and JDK17: from companion directory run build.sh (Linux/macOS), or use the CI artifact. Save your local dev.keystore securely if you want reliable updates. Do not upload keystore or API keys.
The GitHub Actions artifact is an ephemeral-key test build, suitable for one-time side-load testing; subsequent update builds need the same signature.
ADB must show device (not unauthorized) before installation. Last observed TLC BeyondTV2 ADB state was unauthorized at 192.168.29.122:5555. Do not revoke ADB authorizations or disable Google's original launcher.

## Why NOT install the patched upstream launcher over the current app
tvOS Launcher upstream official APK is release-signed. A newly compiled debug-signed fork cannot upgrade it in place without its release signing key, and uninstalling the official launcher risks losing its preferences and Home accessibility setup. Keep the tvOS fork build experimental; do not install over user's current launcher.

## Functional limitations
- Markets uses TradingView official branded widget. Specific instruments may be unavailable or delayed. No Twelve Data Basic prices are displayed.
- AskGogo website link will need a browser; the user's TCL previously had no browser handler. The hub reports the missing-browser state rather than claiming integration.
- This version does not include secure TV pairing, hands-free Hey Gogo wake word, microphone/echo cancellation, voice access to memory, or personal account permissions.
- Do not mistake the Couch TV remote opening for AskGogo assistant authentication.

## Tests
1. In tvOS Settings -> System/About, back up launcher preferences.
2. Verify actual installed launcher version and package once ADB authorizes.
3. Test Gogo companion APK separately, and confirm it does not replace Home.
4. Launch Markets and verify TradingView attribution/price timestamps and Back navigation.
5. Verify original tvOS weather, profiles, wallpaper rotation, focus speed, and power/reboot behavior.
6. Continue to device pairing only after identity, revocation, and consent review.
