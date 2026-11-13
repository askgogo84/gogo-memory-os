# Gogo TV Native Glass Edition — experimental

An isolated source-only enhancement for the user's **CleanYourTV** launcher on TCL BeyondTV2 (Android TV 11).

The existing native RecyclerView dock, 23 wallpapers, 10-minute rotation and Home accessibility redirect are retained. Adds a large translucent native date/clock layer through an opt-in \`gogo_native_clock\` theme setting, with lightweight dock presentation. No WebView, real-time blur, network calls, weather API, or per-focus work in this clock.

## Build and install on Windows

Do not use unreliable ChatGPT ZIP downloads. From PowerShell:

\`\`\`powershell
$u = "https://raw.githubusercontent.com/askgogo84/gogo-memory-os/feature/gogo-native-glass-20261111/experimental/gogo-native-glass/Install-GogoNativeGlass.ps1"
$f = "$env:USERPROFILE\Downloads\Install-GogoNativeGlass.ps1"
Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $f
notepad $f
powershell -NoProfile -ExecutionPolicy Bypass -File $f -TvIp 192.168.29.122
\`\`\`

The installer downloads and SHA-256 checks the Java/Python source patches from this branch, confirms TV model, creates a local backup of the active CleanYourTV theme and original APK, patches only three known MainActivity anchors, builds a release APK with existing JDK 17/Android SDK, installs with ADB \`install -r\`, writes **only** the theme \`config.json\` (without clearing wallpaper files), and uses the safe Home restart utility. It never disables stock Google Home, changes Home intent resolution, or installs Couch TV. Existing TCL ADB authorization is required.

For a compile-only check add \`-BuildOnly\`.

## Rollback

Download the sibling \`Restore-GogoNativeGlass.ps1\` script from this branch, then run it with \`-Backup "<installer printed backup folder>"\`. Restores installed original APK and active theme config; source originals are also restored.

## Acceptance

Check the giant clock and bottom dock on Home, rapid D-pad movement among apps, opening Netflix/YouTube (no overlay), wallpaper rotation at 10 minutes, Home-button functionality after reboot, and streaming/casting.

**Not yet verified on the physical TCL**: APK compilation and performance. It builds on the user's existing Windows Android SDK. The native clock is optional and can be disabled by setting \`gogo_native_clock\` false in the active config, or using rollback.

Design inspired by Couch TV's large translucent clock, independently coded (no borrowed images or components). Its license is MIT; upstream source and licensing remain separate.
