param(
  [string]$TvIp="192.168.29.122",
  [string]$Project="$env:USERPROFILE\cleanyourtv",
  [switch]$BuildOnly
)
$ErrorActionPreference="Stop"
$ProgressPreference="SilentlyContinue"
$root="https://raw.githubusercontent.com/askgogo84/gogo-memory-os"
$commit="c116bd6c6f3382e82ee188cc2326312e561bf745"
$repoPath="experimental/gogo-native-glass"
$temp=Join-Path $env:TEMP "GogoFreeMarketsNativeV1"
New-Item -ItemType Directory -Path $temp -Force | Out-Null
foreach($name in @("GogoFreeMarketsActivity.java","gogo_tv_free_markets.html","patch_gogo_free_markets.py")){
    Invoke-WebRequest -UseBasicParsing -Uri "$root/$commit/$repoPath/$name" -OutFile (Join-Path $temp $name)
}

$adb=Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$py=Join-Path $Project "tools\venv\Scripts\python.exe"
$gradlew=Join-Path $Project "launcher\gradlew.bat"
$apk=Join-Path $Project "launcher\app\build\outputs\apk\release\app-release.apk"
foreach($p in @($adb,$py,$gradlew)){
    if(!(Test-Path -LiteralPath $p -PathType Leaf)){throw "Missing prerequisite: $p; TV unchanged."}
}
$serial=$TvIp+":5555"
& $adb connect $serial | Out-Host
if($LASTEXITCODE -ne 0){throw "Cannot connect to TV."}
$model=((& $adb -s $serial shell getprop ro.product.model) | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $model -ne "BeyondTV2"){throw "TV model mismatch: $model. No changes made."}
$backup=Join-Path $env:USERPROFILE ("Downloads\GogoFreeMarkets-Backup-"+(Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$pkg = @(& $adb -s $serial shell pm path com.gathin.tvhome) |
    Where-Object {$_ -match "^package:"} | Select-Object -First 1
if(!$pkg){throw "Cannot identify installed CleanYourTV; no changes."}
& $adb -s $serial pull ($pkg -replace "^package:","").Trim() (Join-Path $backup "previous.apk") | Out-Host
if($LASTEXITCODE -ne 0){throw "Failed to back up existing APK."}
$uri="content://com.gathin.tvhome.theme/config.json"
& $adb -s $serial shell "content read --uri $uri > /data/local/tmp/gogo-free-before.json" | Out-Null
& $adb -s $serial pull /data/local/tmp/gogo-free-before.json (Join-Path $backup "config.json") | Out-Host
if($LASTEXITCODE -ne 0){throw "Could not back up theme."}
$theme=Get-Content -LiteralPath (Join-Path $backup "config.json") -Raw | ConvertFrom-Json
if($theme.gogo_weather_enabled -ne $true){throw "Expected working v3 weather configuration missing; TV unchanged."}

& $py (Join-Path $temp "patch_gogo_free_markets.py") --project $Project --backup $backup --sources $temp
if($LASTEXITCODE -ne 0){throw "Patch failed; TV APK unchanged."}
$jdk=Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue |
    Where-Object {$_.Name -like "jdk-17*"} | Select-Object -First 1
if(!$jdk){throw "JDK 17 not found; TV unchanged."}
$env:JAVA_HOME=$jdk.FullName
$env:Path="$env:JAVA_HOME\bin;$env:Path"
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA "Android\Sdk"
Push-Location (Join-Path $Project "launcher")
try {
    & .\gradlew.bat --stop | Out-Host
    & .\gradlew.bat assembleRelease --no-daemon --max-workers=1 --console=plain
    if($LASTEXITCODE -ne 0){throw "Gradle build failed. TV unchanged. Source backup: $backup"}
} finally { Pop-Location }
if(!(Test-Path $apk -PathType Leaf)){throw "Release APK missing. TV unchanged."}
Write-Host "FREE MARKETS APK BUILD SUCCESSFUL" -ForegroundColor Green
if($BuildOnly){Write-Host "BuildOnly: TV unchanged";exit 0}

$result=@(& $adb -s $serial install -r $apk 2>&1)
$result | Out-Host
if($LASTEXITCODE -ne 0 -or $result -notcontains "Success"){throw "TV installation failed; backup at $backup"}
$env:TV_HOST=$TvIp
& $py -I (Join-Path $Project "tools\theme_restart.py")
if($LASTEXITCODE -ne 0){Write-Warning "APK installed; Home restart not verified. Do not change Home services."}
Write-Host "GOGO FREE MARKETS INSTALLED" -ForegroundColor Green
Write-Host "Launcher, weather, theme, wallpapers and Home settings not changed."
Write-Host "Open Launcher Settings -> Markets: Free TradingView"
Write-Host "Backup: $backup"
