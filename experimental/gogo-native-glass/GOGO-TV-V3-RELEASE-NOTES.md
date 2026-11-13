# Gogo TV Native v3 — feature ledger (11 November 2026)

**TV:** TCL BeyondTV2, Android TV 11, ADB `192.168.29.122:5555`.

**Currently installed and user-confirmed:** CleanYourTV v2 with the small **left-aligned clock**, date and **working weather**; a fast, **single-row glass dock**; local 23-picture wallpaper collection; own Launcher Settings. Backup: `C:\Users\gover\Downloads\GogoNativeWeather-Backup-20261111-152707` plus separate weather hotfix backup if used.

**This branch:** `feature/gogo-native-glass-20261111`. Never disable the TCL Google TV stock launcher or remove the existing Home accessibility redirect.

## v3 modules (source complete; install only after successful Android build)

| Capability | Scope | Default |
| --- | --- | --- |
| Existing clock, weather, wallpapers, app dock | Unchanged native CleanYourTV components | ON |
| Market ticker UI | Small non-focusable 2-line panel under upper-right controls; rotate among quotes every 10 s | OFF |
| Market fetch | HTTPS only, network thread, 15-min poll, no real-time UI rendering per DPAD | OFF until licensed source connected |
| Market validation | Numeric sanity, explicit ISO8601 timestamps within 24 h, max 16 quotes; provider name and "licensedForDisplay" required; no live claims | Enforced |
| Launcher settings | Markets On/Off; Open AskGogo; Couch TV remote setup | Available in v3 |
| AskGogo access | Open `https://app.askgogo.in` in browser, if a compatible TV browser exists | On-demand; not signed in by default |
| Remote | Opens already-installed `dev.couchtv.ontv` setup; phone remote remains at the TV's :5400 address | On-demand |
| Wallpaper scene selection / app reorder | CleanYourTV's existing settings: Wallpaper, Reorder, App Library | Unchanged |

### Important: not yet live

**Real prices** require a licensed display feed. NSE prohibits redistribution without agreement, and BSE sells data feeds. A free Twelve Data Basic key is for development/internal use and does not automatically authorize third-party display. Never scrape Yahoo or call NSE unofficially. Gogo TV accepts the normalized JSON at `market-feed-contract.schema.json` once a vendor with the correct rights is connected. Supported desired categories: NIFTY 50, SENSEX, BANK NIFTY, NASDAQ, S&P 500, DOW, GOLD, USD/INR. Providers may not support all markets; never invent a missing quote.

**AskGogo hands-free voice, personal memory, Gmail and Calendar:** do not reuse retired `/api/mobile/link/start` or embed API keys in the TV. A standalone TV satellite must use the active WhatsApp OTP lifecycle (`/api/mobile/link/otp/start`, `/verify`, `/session/exchange`) after security review, with device-bound revocable credentials and user-approved actions. TV wake-word and microphone access must be tested; existing Windows echo bug is not proof of TV reliability. Cloud services cannot control the TV's private LAN directly: use an outbound, authenticated device bridge with explicit action allowlists.

**Separate family profiles:** CleanYourTV v2 currently has a single global dock and wallpaper order. Do not fake Couch TV's per-person watching history. A genuine profile feature needs separate per-profile settings and storage/consent.

### v3 build and installation

```powershell
$url = "https://raw.githubusercontent.com/askgogo84/gogo-memory-os/feature/gogo-native-glass-20261111/experimental/gogo-native-glass/Install-GogoTVNativeV3.ps1"
$file = "$env:USERPROFILE\Downloads\Install-GogoTVNativeV3.ps1"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $file

# First: compile without changing the TV
powershell -NoProfile -ExecutionPolicy Bypass -File $file -BuildOnly

# Only if the build reports SUCCESS; install updated APK
powershell -NoProfile -ExecutionPolicy Bypass -File $file -TvIp 192.168.29.122
```

An earlier v3 source/test pipeline in `.github/workflows/gogo-tv-native-v3.yml` compiles the source from a fresh upstream CleanYourTV tree. **CI success proves compilation only, not TCL hardware behavior.**

**Markets can be connected later** via `Configure-GogoMarkets.ps1 -FeedUrl "https://your-display-licensed-feed.example/quotes"`. Only deploy that after the endpoint exists and the vendor's terms authorize your intended use. `-Disable` turns the ticker off.

### Acceptance checks

1. Weather remains visible beneath the clock at top left, and city can still change in Launcher Settings.
2. Single-row dock remains smooth when repeatedly pressing DPAD right/left. No new full-screen WebView, blur, or wallpaper decode on focus.
3. No additional rows and no second giant clock.
4. Top-right gear opens Launcher Settings; new options appear and are clickable.
5. Market ticker defaults to hidden without a feed. With an authorized test endpoint, rejects missing timestamps, future/older-than-24h values, NaN, huge/malformed payloads, and `licensedForDisplay:false`.
6. Disabled market ticker must make zero network calls. Enabling weather/markets must not trigger a fetch on each app focus.
7. AskGogo shortcut opens browser if available or a clear error toast; it never silently pairs a device.
8. Remote shortcut launches Couch TV's existing app only; no Home override changes.
9. All 23 wallpapers and 10-minute rotation remain intact.
10. After reboot, Home still opens CleanYourTV; stock launcher remains enabled as fallback.
11. Backups contain the previous APK and config. Roll back with `adb install -r previous.apk` from the most recent v3 backup, followed by `tools\theme_restart.py`.

**No fake live prices, no unattended spend, no automatic login, no silent device control.**
