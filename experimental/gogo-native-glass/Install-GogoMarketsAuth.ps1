param(
  [string]$TvIp = "192.168.29.122",
  [string]$Project = "$env:USERPROFILE\cleanyourtv",
  [switch]$BuildOnly
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$py = Join-Path $Project "tools\venv\Scripts\python.exe"
$base = Join-Path $Project "launcher\app\src\main\java\com\gathin\tvhome"
$apk = Join-Path $Project "launcher\app\build\outputs\apk\release\app-release.apk"
$files = @("GogoMarketsTicker.java","GogoTvSettings.java")
foreach($required in @($adb,$py,(Join-Path $Project "launcher\gradlew.bat"))) {
  if(!(Test-Path -LiteralPath $required -PathType Leaf)){throw "Missing prerequisite: $required"}
}
$serial = $TvIp + ":5555"
& $adb connect $serial | Out-Host
$model = ((& $adb -s $serial shell getprop ro.product.model)|Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $model -ne "BeyondTV2"){throw "TV model not verified. No changes."}
$backup = Join-Path $env:USERPROFILE ("Downloads\GogoMarketsAuth-Backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $backup | Out-Null
$pkg = @(& $adb -s $serial shell pm path com.gathin.tvhome) |
    Where-Object {$_ -match "^package:"} | Select-Object -First 1
if(!$pkg){throw "Could not locate previous CleanYourTV APK."}
& $adb -s $serial pull (($pkg -replace "^package:","").Trim()) (Join-Path $backup "previous.apk") | Out-Host
if($LASTEXITCODE -ne 0){throw "Failed to back up original APK."}
$uri = "content://com.gathin.tvhome.theme/config.json"
& $adb -s $serial shell "content read --uri $uri > /data/local/tmp/gogo-market-auth-before.json" | Out-Null
& $adb -s $serial pull "/data/local/tmp/gogo-market-auth-before.json" (Join-Path $backup "config.json") | Out-Null
if($LASTEXITCODE -ne 0){throw "Failed to back up current TV theme."}

# This exact immutable commit includes both authenticated Android classes.
$commit = "c54ef214a5b3a788e0661308558f015f80c428ed"
$url = "https://raw.githubusercontent.com/askgogo84/gogo-memory-os/$commit/experimental/gogo-native-glass"
$downloads = Join-Path $backup "downloaded"
New-Item -ItemType Directory -Force -Path $downloads | Out-Null
foreach($name in $files){
  $local = Join-Path $base $name
  $remote = Join-Path $downloads $name
  if(!(Test-Path -LiteralPath $local)){throw "Expected v3 source missing: $local"}
  Invoke-WebRequest -UseBasicParsing -Uri "$url/$name" -OutFile $remote
  $fresh = Get-Content $remote -Raw
  if($name -eq "GogoMarketsTicker.java" -and
     (!$fresh.Contains('conn.setRequestProperty("Authorization"') -or
      !$fresh.Contains('app.askgogo.in/api/gogo-tv/markets'))){
    throw "Authenticated market source not verified."
  }
  if($name -eq "GogoTvSettings.java" -and
     !$fresh.Contains('gogo_markets_device_token')){
    throw "Secure market settings source not verified."
  }
  Copy-Item -LiteralPath $local -Destination (Join-Path $backup $name) -Force
}
foreach($name in $files){ Copy-Item -LiteralPath (Join-Path $downloads $name) -Destination (Join-Path $base $name) -Force }
$jdk = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue |
  Where-Object {$_.Name -like "jdk-17*"} | Select-Object -First 1
if(!$jdk){throw "JDK 17 not installed. TV unchanged."}
$env:JAVA_HOME = $jdk.FullName
$env:Path = ($env:JAVA_HOME + "\bin;" + $env:Path)
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk"
Push-Location (Join-Path $Project "launcher")
try {
  & .\gradlew.bat --stop | Out-Host
  & .\gradlew.bat assembleRelease --no-daemon --max-workers=1 --console=plain
  if($LASTEXITCODE -ne 0){throw "APK build failed. TV unchanged; previous sources saved in $backup"}
} finally { Pop-Location }
if(!(Test-Path -LiteralPath $apk -PathType Leaf)){throw "APK output missing. TV unchanged."}
Write-Host "Markets auth APK BUILD SUCCESSFUL" -ForegroundColor Green
if($BuildOnly){Write-Host "BuildOnly: no TV installation."; exit 0}
$out = @(& $adb -s $serial install -r $apk 2>&1)
$out | Out-Host
if($LASTEXITCODE -ne 0 -or $out -notcontains "Success"){throw "APK installation failed; previous.apk backed up."}
$env:TV_HOST = $TvIp
& $py -I (Join-Path $Project "tools\theme_restart.py")
if($LASTEXITCODE -ne 0){Write-Warning "APK installed but Home restart verification failed."}
Write-Host "GOGO MARKETS DEVICE AUTH INSTALLED; market ticker remains OFF." -ForegroundColor Green
Write-Host "No wallpaper or theme settings were modified. Backup: $backup"
