# Gogo TV Native Weather v2 (TCL BeyondTV2 / Android TV 11)

This patch overlays weather under the **existing CleanYourTV left-aligned clock/date** and keeps the original native RecyclerView dock. It does NOT emulate Couch TV's gigantic centered glass clock and does NOT use a WebView.

## Current verified status

- Source files committed to feature/gogo-native-glass-20261111.
- Gogo Glass v1 was compiled and installed successfully on the user's TV (user-supplied console output).
- Gogo v2 weather build, runtime behaviour, scrolling and reboot persistence have NOT been hardware-verified.

## Sequence

1. Apply Set-GogoCleanLayout.ps1 if you want the safe config-only fix now.
2. Review Install-GogoNativeWeather.ps1, then execute it from Windows with the repo at C:\Users\gover\cleanyourtv.
3. Confirm BUILD SUCCESSFUL, Performing Streamed Install / Success, and GOGO NATIVE WEATHER INSTALLED.
4. On Home, confirm the date/time stay in the top-left and the bottom row is single-row; weather appears under date when Open-Meteo responds.
5. Open the top-right gear -> Launcher Settings. New rows: Weather On/Off and Weather location (Bengaluru/Hubballi/Mysuru/Mumbai/Delhi/Chennai).
6. Test focus navigation; inspect the saved backup directory. Do not remove Google's launcher or Home accessibility redirect.

## Features this patch DOES include

- Clock left by retaining the original 52sp TextClock.
- Seven-across dock and horizontal single-row scrolling.
- Native Launcher Settings shortcut rather than Android system settings.
- Optional asynchronously fetched weather cached for up to 4 hours, refreshed at most every 30min when the app is in focus, using Open-Meteo (API key-free for personal non-commercial use).
- Existing 23 wallpaper files retained. Existing wallpapers rotate every 10 minutes.

## Not yet implemented

- Live market ticker (needs a dependable licensed provider; do not display made-up values).
- AskGogo wake-word, voice streaming and TV control integration.
- Per-profile watch history / Couch TV's People profiles.
- More elaborate liquid-glass distortion, animated scenery or Weather Sun-sync (performance risks).
- Dedicated on-TV settings for those future modules.

All future modules should be opt-in and off the critical app-focus/navigation path.

## Rollback

Backups are saved locally by each script. For the configuration-only patch, the backup contains config-before.json; restore it with Android content provider **write**, then use tools/theme_restart.py. For the v2 APK, restore the prior APK from the backup directory with adb install -r, then the config.json backup and theme_restart.py. Avoid launchers' stock disable/setup scripts.

Licensed source: CleanYourTV and Couch TV are separate upstream projects. Retain relevant copyright notices when borrowing code.

Weather API: https://open-meteo.com/en/docs (check terms before commercial use).
