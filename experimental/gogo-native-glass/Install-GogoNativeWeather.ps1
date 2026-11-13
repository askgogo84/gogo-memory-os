param(
  [string]$TvIp="192.168.29.122",
  [string]$Project="$env:USERPROFILE\cleanyourtv",
  [string]$WeatherCity="Bengaluru",
  [double]$WeatherLat=12.9716,
  [double]$WeatherLon=77.5946,
  [switch]$BuildOnly
)
$ErrorActionPreference="Stop"
$ProgressPreference="SilentlyContinue"
if([math]::Abs($WeatherLat) -gt 90 -or [math]::Abs($WeatherLon) -gt 180){
  throw "Weather coordinates are out of range."
}
$repo="https://raw.githubusercontent.com/askgogo84/gogo-memory-os/feature/gogo-native-glass-20261111/experimental/gogo-native-glass"
$download=Join-Path $env:TEMP "GogoNativeGlass-v2"
New-Item -ItemType Directory -Force $download | Out-Null
foreach($name in @("GogoGlassClock.java","patch_native_glass_v2.py")){
  Invoke-WebRequest -UseBasicParsing -Uri "$repo/$name" -OutFile (Join-Path $download $name)
}
$adb=Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$py=Join-Path $Project "tools\venv\Scripts\python.exe"
$apk=Join-Path $Project "launcher\app\build\outputs\apk\release\app-release.apk"
foreach($path in @($adb,$py,(Join-Path $Project "launcher\gradlew.bat"))){
  if(!(Test-Path $path)){throw "Prerequisite missing: $path"}
}
$serial=$TvIp+":5555"
& $adb connect $serial | Out-Host
$model=((& $adb -s $serial shell getprop ro.product.model) | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $model -ne "BeyondTV2"){throw "TV not validated as BeyondTV2."}
$backup=Join-Path $env:USERPROFILE ("Downloads\GogoNativeWeather-Backup-"+(Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force $backup | Out-Null
$remoteApk=((@(& $adb -s $serial shell pm path com.gathin.tvhome) | Where-Object {$_ -match "^package:"} | Select-Object -First 1) -replace "^package:","").Trim()
if(!$remoteApk){throw "Cannot back up existing CleanYourTV APK."}
& $adb -s $serial pull $remoteApk (Join-Path $backup "original.apk") | Out-Null
if($LASTEXITCODE -ne 0){throw "APK backup failed."}
$uri="content://com.gathin.tvhome.theme/config.json"
& $adb -s $serial shell "content read --uri $uri > /data/local/tmp/gogo-weather-before.json" | Out-Null
$old=Join-Path $backup "config.json"
& $adb -s $serial pull "/data/local/tmp/gogo-weather-before.json" $old | Out-Null
if($LASTEXITCODE -ne 0){throw "Theme backup failed."}
$config=Get-Content $old -Raw | ConvertFrom-Json
if($config -isnot [pscustomobject]){throw "Cannot parse active theme."}
Write-Host "Backups saved: $backup" -ForegroundColor Green

& $py (Join-Path $download "patch_native_glass_v2.py") --project $Project --backup $backup --glass-source (Join-Path $download "GogoGlassClock.java")
if($LASTEXITCODE -ne 0){throw "Source patch failed; TV left unchanged."}
$jdk=Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue |
  Where-Object {$_.Name -like "jdk-17*"} | Select-Object -First 1
if(!$jdk){throw "Java 17 not found; TV unchanged."}
$env:JAVA_HOME=$jdk.FullName
$env:Path="$env:JAVA_HOME\bin;$env:Path"
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA "Android\Sdk"
Push-Location (Join-Path $Project "launcher")
try{
  & .\gradlew.bat assembleRelease --console=plain
  if($LASTEXITCODE -ne 0){throw "Weather build failed; TV unchanged."}
}finally{Pop-Location}
if(!(Test-Path $apk)){throw "Built APK missing."}
if($BuildOnly){Write-Host "Native weather APK built but not installed.";exit 0}
& $adb -s $serial install -r $apk | Out-Host
if($LASTEXITCODE -ne 0){throw "APK update rejected; backup: $backup"}
$changes=[ordered]@{
  gogo_native_clock=$true
  gogo_weather_enabled=$true
  gogo_weather_city=$WeatherCity
  gogo_weather_lat=$WeatherLat
  gogo_weather_lon=$WeatherLon
  dock_row=$true
  single_row=$true
  dock_band_all=$true
  rows_below_dock=0
  columns=7
  dock_title=$false
  cinematic_home=$false
  show_greeting=$false
  launcher_settings_button=$true
  top_menu=$false
  show_network_pill=$false
  show_inputs_pill=$false
  dock_glass=$true
  dock_even_padding=$true
  dock_opacity=55
  app_library=$true
  library_button=$true
  icon_only_buttons=$true
  advanced_effects=$false
  reduced_motion=$true
  focus_overshoot=$false
  ambient_glow=$false
  app_glow=$false
  wallpaper_rotation_minutes=10
}
foreach($key in $changes.Keys){$config|Add-Member -NotePropertyName $key -NotePropertyValue $changes[$key] -Force}
$new=Join-Path $backup "config-with-weather.json"
[System.IO.File]::WriteAllText($new,($config|ConvertTo-Json -Depth 50),(New-Object System.Text.UTF8Encoding($false)))
& $adb -s $serial push $new "/data/local/tmp/gogo-weather-new.json" | Out-Null
if($LASTEXITCODE -ne 0){throw "Theme upload failed; backup: $backup"}
& $adb -s $serial shell 'content write --uri content://com.gathin.tvhome.theme/config.json < /data/local/tmp/gogo-weather-new.json' | Out-Host
if($LASTEXITCODE -ne 0){throw "Theme application failed; backup: $backup"}
& $adb -s $serial shell "content read --uri $uri > /data/local/tmp/gogo-weather-check.json" | Out-Null
$checked=Join-Path $backup "confirmed.json"
& $adb -s $serial pull "/data/local/tmp/gogo-weather-check.json" $checked | Out-Null
$verify=Get-Content $checked -Raw | ConvertFrom-Json
if($verify.gogo_weather_enabled -ne $true -or $verify.single_row -ne $true){throw "Theme verification failed; backup: $backup"}
$env:TV_HOST=$TvIp
& $py -I (Join-Path $Project "tools\theme_restart.py")
if($LASTEXITCODE -ne 0){Write-Warning "Theme saved but Home restart not confirmed."}
Write-Host "GOGO NATIVE WEATHER INSTALLED: Left clock + weather + single-row dock" -ForegroundColor Green
Write-Host "Backup: $backup"
