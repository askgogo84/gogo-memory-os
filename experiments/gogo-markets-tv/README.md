# Gogo Markets TV (standalone experimental app)

This is an **isolated Android TV 11 ticker project** built for TCL BeyondTV2. It does not alter CleanYourTV, its 23 wallpapers, its 10-minute wallpaper rotation, streaming apps, casting, or Home-button accessibility redirect. This branch is not production.

## Getting it on Windows without downloading an attachment

From PowerShell (Git for Windows already installed):
```powershell
cd $env:USERPROFILE\Downloads
git clone --depth 1 --branch feature/gogo-markets-tv-standalone --single-branch --filter=blob:none --sparse https://github.com/askgogo84/gogo-memory-os.git GogoMarketsSource
cd .\GogoMarketsSource
git sparse-checkout set experiments/gogo-markets-tv
cd .\experiments\gogo-markets-tv
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-and-install.ps1 -TvIp 192.168.29.122 -EnableTicker
```

The source is inspected and testable. Android APK compilation and actual TV operation are **not yet verified on the user's Windows machine**. Java 17, SDK 34 and `C:\Users\gover\cleanyourtv\launcher\gradlew.bat` are required.

## Design and privacy

- A minimal upper-right glass ticker, cycling three instrument groups every 10 seconds.
- Symbols: BSE Sensex, Nifty 50, Bank Nifty, Nasdaq Composite, S&P 500, Dow Jones, Gold proxy and USD/INR.
- Uses TradingView's embeddable market widget, preserves attribution, and warns that prices may be delayed. It does not scrape prices or fabricate quotes.
- Requires explicit Android overlay and app-usage permissions. Tries to show **only** while `com.gathin.tvhome` is the foreground app and TV screen is interactive. On app transitions it may take ~2 seconds to disappear.
- If WebView/TradingView does not work on your TCL, report the result and uninstall rather than showing fake values.
- Optional start-after-reboot, off by default.

## Undo

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\stop-and-remove.ps1 -TvIp 192.168.29.122 -Uninstall
```

No market ticker data or API secrets are stored in the launcher. Do not reset the theme or disable any other packages.
