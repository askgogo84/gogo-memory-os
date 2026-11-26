param([string]$TvIp="192.168.29.122",[string]$Project="$env:USERPROFILE\cleanyourtv",[switch]$BuildOnly)
$ErrorActionPreference="Stop"
$ProgressPreference="SilentlyContinue"
$url="https://raw.githubusercontent.com/askgogo84/gogo-memory-os/feature/gogo-native-glass-20261111/experimental/gogo-native-glass"
$dir=Join-Path $env:TEMP "gogo-native-glass-v1"
New-Item -ItemType Directory -Force $dir | Out-Null
$checksums=@{
 "GogoGlassClock.java"="ea82854fca32a3aec861f4c55e1fab6cd3546a722e4ba2fe9f5867371e034a7e"
 "patch_native_glass.py"="a1a8943ca5b4aa1c126eb14b62a8d0a144aa70d43d6df93530defe905097f5d9"
}
foreach($file in $checksums.Keys){
 $dest=Join-Path $dir $file
 Invoke-WebRequest -UseBasicParsing -Uri "$url/$file" -OutFile $dest
 if((Get-FileHash $dest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksums[$file]){
  throw "Checksum failed: $file. No TV changes."
 }
}
$adb=Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$py=Join-Path $Project "tools\venv\Scripts\python.exe"
$main=Join-Path $Project "launcher\app\src\main\java\com\gathin\tvhome\MainActivity.java"
$apk=Join-Path $Project "launcher\app\build\outputs\apk\release\app-release.apk"
foreach($path in @($adb,$py,$main)){if(!(Test-Path $path)){throw "Missing $path. No TV changes."}}
$serial=$TvIp + ":5555"
& $adb connect $serial | Out-Host
if($LASTEXITCODE -ne 0){throw "ADB connection failed."}
$model=((& $adb -s $serial shell getprop ro.product.model)|Out-String).Trim()
if($model -ne "BeyondTV2"){throw "TV model mismatch: $model"}
$backup=Join-Path $env:USERPROFILE ("Downloads\GogoGlass-Backup-"+(Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force $backup | Out-Null
$remoteApk=((& $adb -s $serial shell pm path com.gathin.tvhome)|Select-Object -First 1)
if($remoteApk -notmatch "^package:"){throw "Cannot identify installed APK for backup."}
& $adb -s $serial pull ($remoteApk -replace "^package:","") (Join-Path $backup "original.apk")|Out-Host
if($LASTEXITCODE -ne 0){throw "Original APK backup failed."}
& $adb -s $serial shell "content read --uri content://com.gathin.tvhome.theme/config.json > /data/local/tmp/gogo-theme-old.json"|Out-Null
& $adb -s $serial pull "/data/local/tmp/gogo-theme-old.json" (Join-Path $backup "config.json")|Out-Host
if($LASTEXITCODE -ne 0){throw "Theme config backup failed."}
$config=Get-Content (Join-Path $backup "config.json") -Raw|ConvertFrom-Json
if($config -isnot [pscustomobject]){throw "Invalid TV theme JSON."}
Write-Host "Backups saved: $backup" -ForegroundColor Green
& $py (Join-Path $dir "patch_native_glass.py") --project $Project --backup $backup --glass-source (Join-Path $dir "GogoGlassClock.java")
if($LASTEXITCODE -ne 0){throw "Source patch failed; TV unchanged."}
$jdk=Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue|Where-Object {$_.Name -like "jdk-17*"}|Select-Object -First 1
if(!$jdk){throw "Temurin JDK 17 not found. TV unchanged."}
$env:JAVA_HOME=$jdk.FullName
$env:Path="$env:JAVA_HOME\bin;$env:Path"
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA "Android\Sdk"
Push-Location (Join-Path $Project "launcher")
try{
 & .\gradlew.bat assembleRelease --console=plain
 if($LASTEXITCODE -ne 0){throw "Gradle build failed; TV unchanged."}
}finally{Pop-Location}
if(!(Test-Path $apk)){throw "APK missing after build."}
Write-Host "Native Glass APK compiled." -ForegroundColor Green
if($BuildOnly){Write-Host "BuildOnly: No TV installation.";exit 0}
& $adb -s $serial install -r $apk|Out-Host
if($LASTEXITCODE -ne 0){throw "APK installation rejected; theme not changed."}
# Preserve all wallpaper files and existing layout; change only lightweight flags.
foreach($entry in @(@("gogo_native_clock",$true),@("advanced_effects",$false),@("reduced_motion",$true),@("focus_overshoot",$false),@("ambient_glow",$false),@("app_glow",$false),@("dock_glass",$true),@("wallpaper_rotation_minutes",10))){
 $config|Add-Member -NotePropertyName $entry[0] -NotePropertyValue $entry[1] -Force
}
$new=Join-Path $backup "new-config.json"
[System.IO.File]::WriteAllText($new,($config|ConvertTo-Json -Depth 50),(New-Object System.Text.UTF8Encoding($false)))
& $adb -s $serial push $new "/data/local/tmp/gogo-theme-new.json"|Out-Host
if($LASTEXITCODE -ne 0){throw "Theme upload failed; backup saved."}
& $adb -s $serial shell 'content write --uri content://com.gathin.tvhome.theme/config.json < /data/local/tmp/gogo-theme-new.json'|Out-Host
if($LASTEXITCODE -ne 0){throw "Theme update failed; backup saved."}
& $adb -s $serial shell "content read --uri content://com.gathin.tvhome.theme/config.json > /data/local/tmp/gogo-theme-check.json"|Out-Null
$checked=Join-Path $backup "confirmed-config.json"
& $adb -s $serial pull "/data/local/tmp/gogo-theme-check.json" $checked|Out-Null
$verify=Get-Content $checked -Raw|ConvertFrom-Json
if($verify.gogo_native_clock -ne $true){throw "Clock activation not confirmed."}
$env:TV_HOST=$TvIp
& $py -I (Join-Path $Project "tools\theme_restart.py")
if($LASTEXITCODE -ne 0){Write-Warning "Check launcher accessibility; restart verification failed."}
Write-Host "NATIVE GLASS INSTALLED. Existing wallpapers and Home redirect were not disabled." -ForegroundColor Green
Write-Host "Backup: $backup"
