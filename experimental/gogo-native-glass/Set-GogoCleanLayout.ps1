param(
  [string]$TvIp="192.168.29.122",
  [string]$Project="$env:USERPROFILE\cleanyourtv"
)
$ErrorActionPreference="Stop"
$adb=Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$py=Join-Path $Project "tools\venv\Scripts\python.exe"
foreach($path in @($adb,$py)){if(!(Test-Path $path)){throw "Not found: $path"}}
$serial=$TvIp + ":5555"
& $adb connect $serial | Out-Host
if($LASTEXITCODE -ne 0){throw "ADB connection failed; no changes made."}
$model=((& $adb -s $serial shell getprop ro.product.model)|Out-String).Trim()
if($model -ne "BeyondTV2"){throw "Wrong TV: $model; refusing configuration change."}
$backup=Join-Path $env:USERPROFILE ("Downloads\GogoCleanLayout-Backup-"+(Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force $backup | Out-Null
$provider="content://com.gathin.tvhome.theme/config.json"
$remoteOld="/data/local/tmp/gogo-clean-before.json"
& $adb -s $serial shell "content read --uri $provider > $remoteOld" | Out-Null
if($LASTEXITCODE -ne 0){throw "Could not read active TV theme."}
$old=Join-Path $backup "config-before.json"
& $adb -s $serial pull $remoteOld $old | Out-Null
if($LASTEXITCODE -ne 0 -or !(Test-Path $old)){throw "Could not back up theme; nothing changed."}
$config=Get-Content -LiteralPath $old -Raw | ConvertFrom-Json
if($config -isnot [pscustomobject]){throw "Unexpected TV configuration; nothing changed."}
$updates=[ordered]@{
  gogo_native_clock=$false
  dock_row=$true
  single_row=$true
  dock_band=$true
  dock_band_all=$true
  dock_glass=$true
  dock_even_padding=$true
  dock_opacity=55
  columns=7
  rows_below_dock=0
  dock_title=$false
  cinematic_home=$false
  show_greeting=$false
  launcher_settings_button=$true
  top_menu=$false
  show_network_pill=$false
  show_inputs_pill=$false
  app_library=$true
  library_button=$true
  icon_only_buttons=$true
  ambient_glow=$false
  app_glow=$false
  advanced_effects=$false
  reduced_motion=$true
  focus_overshoot=$false
  fade_rows=$false
  wallpaper_rotation_minutes=10
}
foreach($key in $updates.Keys){$config | Add-Member -NotePropertyName $key -NotePropertyValue $updates[$key] -Force}
$new=Join-Path $backup "config-after.json"
[System.IO.File]::WriteAllText($new,($config | ConvertTo-Json -Depth 50),(New-Object System.Text.UTF8Encoding($false)))
& $adb -s $serial push $new /data/local/tmp/gogo-clean-after.json | Out-Null
if($LASTEXITCODE -ne 0){throw "Config upload failed; original TV theme retained."}
& $adb -s $serial shell 'content write --uri content://com.gathin.tvhome.theme/config.json < /data/local/tmp/gogo-clean-after.json' | Out-Host
if($LASTEXITCODE -ne 0){throw "TV configuration write failed. Backup: $backup"}
& $adb -s $serial shell "content read --uri $provider > /data/local/tmp/gogo-clean-check.json" | Out-Null
$verified=Join-Path $backup "config-confirmed.json"
& $adb -s $serial pull /data/local/tmp/gogo-clean-check.json $verified | Out-Null
if($LASTEXITCODE -ne 0){throw "Cannot read theme verification; backup: $backup"}
$check=Get-Content -LiteralPath $verified -Raw | ConvertFrom-Json
if(($check.gogo_native_clock -ne $false) -or
  ($check.single_row -ne $true) -or
  ($check.launcher_settings_button -ne $true)){throw "Theme verification failed; backup: $backup"}
$env:TV_HOST=$TvIp
& $py -I (Join-Path $Project "tools\theme_restart.py")
if($LASTEXITCODE -ne 0){Write-Warning "Theme saved, but the Home redirect requires a check."}
Write-Host "GOGO CLEAN LAYOUT CONFIGURED" -ForegroundColor Green
Write-Host "Small left clock; one horizontal app row; top-right gear opens Launcher settings."
Write-Host "Backed up configuration: $old"
