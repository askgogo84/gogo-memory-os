# Couch TV v0.11 — TCL BeyondTV2 companion evaluation

This does not replace CleanYourTV, touch the 23-wallpaper collection, or change Android TV HOME settings.

## Run from Windows PowerShell

$u = 'https://raw.githubusercontent.com/askgogo84/gogo-memory-os/feature/couch-tv-tcl-safe-install-20261108/experiments/couch-tv-tcl/Install-CouchTV-SideBySide.ps1'
$p = Join-Path $env:TEMP 'Install-CouchTV-SideBySide.ps1'
Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $p
Get-Content -LiteralPath $p
powershell -NoProfile -ExecutionPolicy Bypass -File $p -TvIp 192.168.29.122

The installer gets the official v0.11 Couch TV On-TV APK, verifies its published SHA256 digest, connects with existing Android Platform-Tools, verifies the TCL model, saves a diagnostic baseline, installs and launches the companion app. Official release: https://github.com/Seagey/couch-tv/releases/tag/v0.11.

## Configure

Open Couch TV in TV Apps (not as default Home). On your phone connected to the same Wi-Fi, open http://192.168.29.122:5400 and pair with the 6-digit code shown on the TV. On the TV choose Connect ADB if remote keys, volume or media functions require it (your TCL Android 11 previously used network debugging port 5555). In settings choose India as search region, weather location, Celsius, Night/Glass scene, your preferred app dock, household profiles, and Continue Watching. Leave Couch TV > Use as home screen OFF.

## Scope and limits

The On-TV app supports its cinematic scenes/clock, weather, app dock, phone remote, app launching, show search/deep links, basic Keep Watching, profiles, sleep timer and controls where the ADB connection allows them. An internet connection and compatible TV apps are required for some search and playback behavior.

The optional Claude assistant is off until a separately billed Anthropic key is supplied. Smart-home climate, scenes and doorbell support needs an existing Home Assistant hub and entities. AskGogo Same Brain is not integrated by default; it is a separate project.

For rich watch progress/history, taste profiles and picks, automatic streaming profiles, Moonlight/screens, picture mode and reliable Wake-on-LAN, the upstream repository documents a separate always-on Mac/Linux/Raspberry Pi bridge. The On-TV service cannot wake its own powered-down TV. Windows voice wake and custom stock ticker are separate work.

Verify streaming, casting, remote, Home-button behavior and restart. Never switch off Google system launcher/setup packages or grant Home-control permissions to Couch TV during the side-by-side test. To uninstall just this app:

& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s 192.168.29.122:5555 uninstall dev.couchtv.ontv

Security: phone pairing is only for trusted home LAN, never forward ports 5400 or 5555 on the internet. Private baseline diagnostics remain on your PC. The installer has not been run on your physical TV by ChatGPT; verify locally.
