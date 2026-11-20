param(
  [string]$TvIp = "192.168.29.122",
  [string]$Project = "$env:USERPROFILE\cleanyourtv",
  [switch]$BuildOnly
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$py = Join-Path $Project "tools\venv\Scripts\python.exe"
$clock = Join-Path $Project "launcher\app\src\main\java\com\gathin\tvhome\GogoGlassClock.java"
$apk = Join-Path $Project "launcher\app\build\outputs\apk\release\app-release.apk"
foreach ($required in @($adb,$py,$clock,(Join-Path $Project "launcher\gradlew.bat"))) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing $required. TV unchanged." }
}
$serial = $TvIp + ":5555"
& $adb connect $serial | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Cannot connect to the TV." }
$model = ((& $adb -s $serial shell getprop ro.product.model) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $model -ne "BeyondTV2") { throw "TV mismatch: $model" }
$backup = Join-Path $env:USERPROFILE ("Downloads\GogoWeatherHotfix-Backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backup -Force | Out-Null

# Save the current working APK and wallpaper config before any build/install.
$pkg = @(& $adb -s $serial shell pm path com.gathin.tvhome) | Where-Object { $_ -match "^package:" } | Select-Object -First 1
if (!$pkg) { throw "Cannot locate installed launcher APK; TV unchanged." }
$installedApk = ($pkg -replace "^package:", "").Trim()
& $adb -s $serial pull $installedApk (Join-Path $backup "previous.apk") | Out-Host
if ($LASTEXITCODE -ne 0) { throw "APK backup failed; TV unchanged." }
& $adb -s $serial shell "content read --uri content://com.gathin.tvhome.theme/config.json > /data/local/tmp/gogo-weather-hotfix-before.json" | Out-Null
& $adb -s $serial pull "/data/local/tmp/gogo-weather-hotfix-before.json" (Join-Path $backup "config.json") | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Theme backup failed; TV unchanged." }
$config = Get-Content -LiteralPath (Join-Path $backup "config.json") -Raw | ConvertFrom-Json
if (!$config.gogo_native_clock -or !$config.gogo_weather_enabled) {
  throw "Weather is not enabled in TV theme. No changes; check Home settings."
}
Copy-Item -LiteralPath $clock -Destination (Join-Path $backup "GogoGlassClock.java") -Force

# Immutable reviewed source version.
$commit = "1c9f3db437dae5be12bf01dbf6ea6944ba20f47b"
$uri = "https://raw.githubusercontent.com/askgogo84/gogo-memory-os/$commit/experimental/gogo-native-glass/GogoGlassClock.java"
$download = Join-Path $backup "GogoGlassClock.hotfix.java"
Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $download
$source = Get-Content -LiteralPath $download -Raw
if (!$source.Contains('Weather loading') -or !$source.Contains('failures < 4') -or $source.Contains('if (activity.hasWindowFocus())')) {
  throw "Downloaded source does not match the expected fix. TV unchanged."
}
Copy-Item -LiteralPath $download -Destination $clock -Force

$jdk = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue |
  Where-Object {$_.Name -like "jdk-17*"} | Select-Object -First 1
if (!$jdk) { throw "JDK 17 not found. TV unchanged; original Java saved in $backup." }
$env:JAVA_HOME=$jdk.FullName
$env:Path="$env:JAVA_HOME\bin;$env:Path"
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA "Android\Sdk"

Push-Location (Join-Path $Project "launcher")
try {
  & .\gradlew.bat assembleRelease --console=plain
  if ($LASTEXITCODE -ne 0) { throw "Build failed. TV unchanged. Previous Java saved in $backup." }
} finally { Pop-Location }
if (!(Test-Path -LiteralPath $apk)) { throw "No APK produced. TV unchanged." }
Write-Host "Weather startup hotfix compiled." -ForegroundColor Green
if ($BuildOnly) { Write-Host "BuildOnly set, no TV installation."; exit 0 }

$out = & $adb -s $serial install -r $apk 2>&1
$out | Out-Host
if ($LASTEXITCODE -ne 0 -or "$out" -notmatch "\bSuccess\b") {
  throw "APK update failed. Previous APK saved in $backup."
}
$env:TV_HOST=$TvIp
& $py -I (Join-Path $Project "tools\theme_restart.py")
if ($LASTEXITCODE -ne 0) {
  Write-Warning "APK installed, but automatic Home restart not verified."
}
Write-Host "GOGO WEATHER STARTUP FIX INSTALLED" -ForegroundColor Green
Write-Host "Theme settings and wallpapers unchanged. Backup: $backup"
