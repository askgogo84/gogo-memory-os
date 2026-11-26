param(
  [Parameter(Mandatory=$true)][string]$Backup,
  [string]$TvIp = "192.168.29.122",
  [string]$Project = "$env:USERPROFILE\cleanyourtv"
)
$ErrorActionPreference="Stop"
$adb=Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$oldApk=Join-Path $Backup "original.apk"
$oldCfg=Join-Path $Backup "config.json"
$originalSource=Join-Path $Backup "MainActivity.java"
$main=Join-Path $Project "launcher\app\src\main\java\com\gathin\tvhome\MainActivity.java"
$added=Join-Path $Project "launcher\app\src\main\java\com\gathin\tvhome\GogoGlassClock.java"
foreach($file in @($oldApk,$oldCfg,$originalSource)){
  if(!(Test-Path $file)){throw "Incomplete backup: $file"}
}
$serial=$TvIp + ":5555"
& $adb connect $serial|Out-Host
$model=((& $adb -s $serial shell getprop ro.product.model)|Out-String).Trim()
if($model -ne "BeyondTV2"){throw "TV model mismatch; refusing restore."}
& $adb -s $serial install -r $oldApk|Out-Host
if($LASTEXITCODE -ne 0){throw "Original APK restore failed."}
& $adb -s $serial push $oldCfg "/data/local/tmp/gogo-restore-config.json"|Out-Host
if($LASTEXITCODE -ne 0){throw "Previous theme push failed."}
& $adb -s $serial shell 'content write --uri content://com.gathin.tvhome.theme/config.json < /data/local/tmp/gogo-restore-config.json'|Out-Host
if($LASTEXITCODE -ne 0){throw "Previous theme restore failed."}
Copy-Item -LiteralPath $originalSource -Destination $main -Force
if(Test-Path $added){Remove-Item -LiteralPath $added -Force}
$env:TV_HOST=$TvIp
$py=Join-Path $Project "tools\venv\Scripts\python.exe"
& $py -I (Join-Path $Project "tools\theme_restart.py")
if($LASTEXITCODE -ne 0){Write-Warning "Check the TCL Home-button accessibility service."}
Write-Host "Original CleanYourTV APK, config and source restored. Wallpapers not deleted." -ForegroundColor Green
