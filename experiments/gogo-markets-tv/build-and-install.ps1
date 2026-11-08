# Separate, reversible Android TV add-on. No CleanYourTV changes.
param(
  [string]$TvIp = '192.168.29.122',
  [string]$CleanYourTv = "$env:USERPROFILE\cleanyourtv",
  [switch]$BuildOnly,
  [switch]$EnableTicker
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$gradle = Join-Path $CleanYourTv 'launcher\gradlew.bat'
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$api = Join-Path $sdk 'platforms\android-34\android.jar'
if (!(Test-Path $gradle)) { throw "CleanYourTV Gradle wrapper missing: $gradle" }
if (!(Test-Path $api)) { throw 'Android SDK 34 missing.' }
if (!(Test-Path $adb)) { throw 'Android SDK Platform-Tools / adb.exe missing.' }
$jdk = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'jdk-17*' } | Select-Object -First 1
if (-not $jdk) { throw 'Install Temurin JDK 17, used previously for CleanYourTV.' }
$env:JAVA_HOME = $jdk.FullName
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
Write-Host 'Building separate Gogo Markets TV app with Java 17 / SDK 34.' -ForegroundColor Cyan
& $gradle -p $root --no-daemon :app:assembleDebug
if ($LASTEXITCODE -ne 0) { throw 'Gradle build failed. TCL remains unchanged.' }
$apk = Join-Path $root 'app\build\outputs\apk\debug\app-debug.apk'
if (!(Test-Path $apk)) { throw 'Build completed without expected APK.' }
Write-Host "APK BUILT: $apk" -ForegroundColor Green
if ($BuildOnly) { return }
if ($TvIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw 'Invalid TV IP address.' }
$serial = "${TvIp}:5555"
& $adb connect $serial
if ($LASTEXITCODE -ne 0) { throw 'TV connection failed; nothing installed.' }
& $adb -s $serial shell getprop ro.product.model
if ($LASTEXITCODE -ne 0) { throw 'TV probe failed; nothing installed.' }
& $adb -s $serial install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed.' }
Write-Host 'Installed in.askgogo.markets without modifying the default launcher.' -ForegroundColor Green
if ($EnableTicker) {
  Write-Host 'Granting two special app permissions: overlay and usage access.' -ForegroundColor Yellow
  & $adb -s $serial shell appops set in.askgogo.markets SYSTEM_ALERT_WINDOW allow
  if ($LASTEXITCODE -ne 0) { throw 'Overlay permission unavailable. Grant in Android settings.' }
  & $adb -s $serial shell appops set in.askgogo.markets GET_USAGE_STATS allow
  if ($LASTEXITCODE -ne 0) { throw 'Usage permission unavailable. Grant in Android settings.' }
  & $adb -s $serial shell am start-foreground-service -n in.askgogo.markets/.TickerService -a in.askgogo.markets.START
  if ($LASTEXITCODE -ne 0) { throw 'Ticker service could not start; open Gogo Markets from TV Apps.' }
  Write-Host 'Ticker service requested. Press TV Home to test.' -ForegroundColor Green
} else {
  & $adb -s $serial shell am start -n in.askgogo.markets/.MainActivity
  Write-Host 'Open Gogo Markets on TV to grant permissions/start ticker.'
}
Write-Host 'Check: ticker visible on Home; hidden in Netflix; CleanYourTV preserved after reboot.'
