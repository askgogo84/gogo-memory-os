param(
    [string]$TvIp = "192.168.29.122",
    [string]$Project = "$env:USERPROFILE\cleanyourtv",
    [switch]$BuildOnly
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$repo = "https://raw.githubusercontent.com/askgogo84/gogo-memory-os"
$ref = "5e6e4ee7ce4d1d38ce0d27da6b714f2f000e5782"
$path = "experimental/gogo-native-glass"
$src = Join-Path $env:TEMP "GogoTvNativeV3"
New-Item -ItemType Directory -Path $src -Force | Out-Null
foreach($name in @("GogoMarketsTicker.java","GogoTvSettings.java","patch_gogo_tv_v3.py")){
    Invoke-WebRequest -UseBasicParsing -Uri "$repo/$ref/$path/$name" -OutFile (Join-Path $src $name)
}
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$py = Join-Path $Project "tools\venv\Scripts\python.exe"
$apk = Join-Path $Project "launcher\app\build\outputs\apk\release\app-release.apk"
foreach($p in @($adb,$py,(Join-Path $Project "launcher\gradlew.bat"),
                   (Join-Path $Project "launcher\app\src\main\java\com\gathin\tvhome\GogoGlassClock.java"))){
    if(!(Test-Path -LiteralPath $p -PathType Leaf)){throw "Missing prerequisite $p. TV unchanged."}
}
$serial = $TvIp + ":5555"
& $adb connect $serial | Out-Host
if($LASTEXITCODE -ne 0){throw "ADB connection failed."}
$model = ((& $adb -s $serial shell getprop ro.product.model) | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $model -ne "BeyondTV2"){throw "Wrong TV: $model. No changes."}
$backup = Join-Path $env:USERPROFILE ("Downloads\GogoNativeV3-Backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$pkg = @(& $adb -s $serial shell pm path com.gathin.tvhome) |
    Where-Object {$_ -match "^package:"} | Select-Object -First 1
if(!$pkg){throw "Cannot back up installed CleanYourTV. No changes."}
$previous = ($pkg -replace "^package:", "").Trim()
& $adb -s $serial pull $previous (Join-Path $backup "previous.apk") | Out-Host
if($LASTEXITCODE -ne 0){throw "APK backup failed. No changes."}
& $adb -s $serial shell "content read --uri content://com.gathin.tvhome.theme/config.json > /data/local/tmp/gogo-v3-before.json" | Out-Null
& $adb -s $serial pull "/data/local/tmp/gogo-v3-before.json" (Join-Path $backup "config.json") | Out-Host
if($LASTEXITCODE -ne 0){throw "Config backup failed. No changes."}
$config = Get-Content (Join-Path $backup "config.json") -Raw | ConvertFrom-Json
if($config.gogo_weather_enabled -ne $true){
    throw "Working Native Weather v2 theme not found; no changes."
}
Write-Host "Backups: $backup" -ForegroundColor Green
& $py (Join-Path $src "patch_gogo_tv_v3.py") --project $Project --backup $backup --sources $src
if($LASTEXITCODE -ne 0){throw "Native module patch failed. TV unchanged."}
$jdk = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue |
    Where-Object {$_.Name -like "jdk-17*"} | Select-Object -First 1
if(!$jdk){throw "Java 17 not found. TV unchanged."}
$env:JAVA_HOME = $jdk.FullName
$env:Path = ($env:JAVA_HOME + "\bin;" + $env:Path)
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk"
Push-Location (Join-Path $Project "launcher")
try {
    & .\gradlew.bat assembleRelease --console=plain
    if($LASTEXITCODE -ne 0){throw "Gradle build failed. TV unchanged; backup: $backup"}
} finally {Pop-Location}
if(!(Test-Path $apk)){throw "APK missing. TV unchanged."}
Write-Host "Gogo TV Native v3 APK compiled." -ForegroundColor Green
if($BuildOnly){Write-Host "BuildOnly: no TV installation.";exit 0}
$install = @(& $adb -s $serial install -r $apk 2>&1)
$install | Out-Host
if($LASTEXITCODE -ne 0 -or ($install -notcontains "Success")){
    throw "Android rejected APK. Previous APK saved: $backup"
}
$env:TV_HOST = $TvIp
& $py -I (Join-Path $Project "tools\theme_restart.py")
if($LASTEXITCODE -ne 0){Write-Warning "APK installed but Home restart not verified. No Home services changed intentionally."}
Write-Host "GOGO TV NATIVE V3 INSTALLED" -ForegroundColor Green
Write-Host "Weather, wallpaper, dock and Home redirect configuration unchanged."
Write-Host "Markets are OFF until a licensed HTTPS feed is configured."
Write-Host "Backup: $backup"
