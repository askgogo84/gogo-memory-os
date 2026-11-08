# Couch TV v0.11 side-by-side installer. Does not change the current HOME or launcher.
param([string]$TvIp = '192.168.29.122')
$ErrorActionPreference = 'Stop'
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$dest = Join-Path $env:USERPROFILE 'Downloads\CouchTV-SideBySide-v011'
$apk = Join-Path $dest 'couch-tv-ontv.apk'
$serial = $TvIp + ':5555'
$url = 'https://github.com/Seagey/couch-tv/releases/download/v0.11/couch-tv-ontv.apk'
$expectedHash = 'aef0cdf2057bef96f38ddc932c0f0dec7c69c4dd64c11cd1c38868daf094bc45'
if (!(Test-Path $adb)) { throw 'Android SDK Platform-Tools missing. TV unchanged.' }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
if (Test-Path $apk) {
  $oldHash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($oldHash -ne $expectedHash) { Remove-Item $apk -Force }
}
if (!(Test-Path $apk)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $apk
}
$hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $expectedHash) { throw 'Official APK checksum mismatch. Nothing installed.' }
Write-Host 'Official Couch TV v0.11 APK hash VERIFIED.' -ForegroundColor Green
& $adb connect $serial | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'ADB connection failed. Nothing installed.' }
$model = (& $adb -s $serial shell getprop ro.product.model 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $model -ne 'BeyondTV2') {
  throw "Expected TCL BeyondTV2, got '$model'. Nothing installed."
}
$baseline = Join-Path $dest ('baseline-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
@(
  'Prior Android TV home state:',
  ((& $adb -s $serial shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME) | Out-String),
  'Prior accessibility enabled:',
  ((& $adb -s $serial shell settings get secure accessibility_enabled) | Out-String),
  'Prior accessibility services:',
  ((& $adb -s $serial shell settings get secure enabled_accessibility_services) | Out-String),
  'Prior disabled packages:',
  ((& $adb -s $serial shell pm list packages -d) | Out-String)
) | Set-Content -LiteralPath $baseline -Encoding UTF8
Write-Host "Baseline saved to $baseline."
Write-Host 'Installing Couch TV alongside CleanYourTV (NO HOME CHANGES)...'
$output = (& $adb -s $serial install -r $apk 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $output -notmatch '(?m)^Success\s*$') {
  throw "Installation not confirmed: $output"
}
$path = (& $adb -s $serial shell pm path dev.couchtv.ontv 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $path -notmatch 'package:') {
  throw 'Installed package could not be verified. Inspect Apps on the TV.'
}
Write-Host 'Couch TV companion INSTALLED.' -ForegroundColor Green
& $adb -s $serial shell monkey -p dev.couchtv.ontv -c android.intent.category.LEANBACK_LAUNCHER 1 | Out-Host
Write-Host 'Open Couch TV from Apps if it is not onscreen.'
Write-Host ('Phone remote pairing: http://' + $TvIp + ':5400 (when both devices are on the same home Wi-Fi).')
Write-Host 'Pair with the six-digit code on the TV. Never post the code.'
Write-Host 'Leave Couch TV > Use as home screen OFF. Keep CleanYourTV Home button service enabled.' -ForegroundColor Yellow
Write-Host ('Rollback: & "' + $adb + '" -s ' + $serial + ' uninstall dev.couchtv.ontv')
