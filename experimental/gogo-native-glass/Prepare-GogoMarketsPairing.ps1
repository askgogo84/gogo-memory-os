param(
    [string]$TvIp = "192.168.29.122",
    [string]$Project = "$env:USERPROFILE\cleanyourtv"
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$py = Join-Path $Project "tools\venv\Scripts\python.exe"
foreach ($file in @($adb, $py)) {
    if (!(Test-Path -LiteralPath $file)) { throw "Missing $file" }
}
$serial = $TvIp + ":5555"
& $adb connect $serial | Out-Host
if ($LASTEXITCODE -ne 0) { throw "ADB connection failed." }
$model = ((& $adb -s $serial shell getprop ro.product.model) | Out-String).Trim()
if ($model -ne "BeyondTV2" -or $LASTEXITCODE -ne 0) { throw "TV mismatch: $model" }

$backup = Join-Path $env:USERPROFILE ("Downloads\GogoMarketsPairing-Backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $backup | Out-Null
$provider = "content://com.gathin.tvhome.theme/config.json"
& $adb -s $serial shell "content read --uri $provider > /data/local/tmp/gogo-markets-prepair.json" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not read installed TV theme." }
$old = Join-Path $backup "config-before.json"
& $adb -s $serial pull /data/local/tmp/gogo-markets-prepair.json $old | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Theme backup failed." }
$cfg = Get-Content -LiteralPath $old -Raw | ConvertFrom-Json
if ($cfg -isnot [pscustomobject] -or $cfg.gogo_weather_enabled -ne $true) {
    throw "The working Native Weather theme was not found; nothing changed."
}

$random = New-Object Byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($random) } finally { $rng.Dispose() }
$secret = [Convert]::ToBase64String($random).TrimEnd("=").Replace("+","-").Replace("/","_")
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $digest = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($secret))
    $hash = [BitConverter]::ToString($digest).Replace("-","").ToLowerInvariant()
} finally { $sha.Dispose() }

$cfg | Add-Member -NotePropertyName "gogo_markets_enabled" -NotePropertyValue $false -Force
$cfg | Add-Member -NotePropertyName "gogo_markets_url" -NotePropertyValue "https://app.askgogo.in/api/gogo-tv/markets" -Force
$cfg | Add-Member -NotePropertyName "gogo_markets_device_token" -NotePropertyValue $secret -Force
$new = Join-Path $backup "config-private.json"
[System.IO.File]::WriteAllText($new, ($cfg | ConvertTo-Json -Depth 50),
    (New-Object System.Text.UTF8Encoding($false)))
& $adb -s $serial push $new /data/local/tmp/gogo-markets-paired.json | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not push TV config. Original still backed up." }
& $adb -s $serial shell 'content write --uri content://com.gathin.tvhome.theme/config.json < /data/local/tmp/gogo-markets-paired.json' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not save TV config. Backup preserved." }

& $adb -s $serial shell "content read --uri $provider > /data/local/tmp/gogo-markets-check.json" | Out-Null
$checkedFile = Join-Path $backup "verified-private.json"
& $adb -s $serial pull /data/local/tmp/gogo-markets-check.json $checkedFile | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not verify TV config." }
$checked = Get-Content -LiteralPath $checkedFile -Raw | ConvertFrom-Json
if ($checked.gogo_markets_device_token -ne $secret -or
    $checked.gogo_markets_enabled -ne $false -or
    $checked.gogo_weather_enabled -ne $true) {
    throw "TV config verification failed; restore original from $old"
}

& $adb -s $serial shell rm -f /data/local/tmp/gogo-markets-paired.json /data/local/tmp/gogo-markets-check.json | Out-Null
$env:TV_HOST = $TvIp
& $py -I (Join-Path $Project "tools\theme_restart.py")
if ($LASTEXITCODE -ne 0) { Write-Warning "Paired config saved; Home restart not fully verified." }

Write-Host "GOGO MARKETS TV TOKEN PREPARED (ticker stays OFF)" -ForegroundColor Green
Write-Host "Use this PUBLIC HASH in Vercel Environment Variables:"
Write-Host "GOGO_TV_MARKETS_DEVICE_TOKEN_SHA256=$hash"
Write-Host "Do NOT upload or share the config-private.json backup: it contains your private device token."
Write-Host "Your existing weather, app dock, and wallpapers were preserved."
