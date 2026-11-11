param(
  [string]$TvIp = "192.168.29.122",
  [string]$FeedUrl = "",
  [switch]$Disable,
  [string]$Project = "$env:USERPROFILE\cleanyourtv"
)
$ErrorActionPreference = "Stop"
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$py = Join-Path $Project "tools\venv\Scripts\python.exe"
foreach($file in @($adb, $py)){
    if(!(Test-Path -LiteralPath $file -PathType Leaf)){ throw "Missing $file" }
}
if(-not $Disable){
    if($FeedUrl.Length -lt 12 -or $FeedUrl.Length -gt 400){
        throw "Provide an HTTPS endpoint (no access tokens in the URL)."
    }
    $url = $null
    if(-not [Uri]::TryCreate($FeedUrl,[UriKind]::Absolute,[ref]$url) -or
       $url.Scheme -ne "https" -or $url.UserInfo -or $url.Fragment -or
       ($url.Port -ne 443) -or $url.Host -match "(?i)(^localhost$|\.local$|\.internal$|\.lan$|^127\.|^10\.|^192\.168\.|^169\.254\.)" -or
       $url.Host -match "^\d+\.\d+\.\d+\.\d+$"){
       throw "HTTPS public endpoint required; private network, IP address, embedded credentials and fragments are rejected."
    }
    if($url.Query -match "(?i)(apikey|api_key|token|secret|auth|password)="){
        throw "Never put provider tokens in the TV URL. Use a secured server-side proxy."
    }
}
$serial = $TvIp + ":5555"
& $adb connect $serial | Out-Host
$model = ((& $adb -s $serial shell getprop ro.product.model)|Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $model -ne "BeyondTV2"){
    throw "TV not verified as BeyondTV2."
}
$backup = Join-Path $env:USERPROFILE ("Downloads\GogoMarketConfig-Backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force $backup | Out-Null
$provider = "content://com.gathin.tvhome.theme/config.json"
& $adb -s $serial shell "content read --uri $provider > /data/local/tmp/gogo-market-before.json" | Out-Null
$old=Join-Path $backup "config-before.json"
& $adb -s $serial pull "/data/local/tmp/gogo-market-before.json" $old | Out-Host
if($LASTEXITCODE -ne 0){throw "Existing theme backup failed; TV unchanged."}
$config=Get-Content -LiteralPath $old -Raw | ConvertFrom-Json
if($config -isnot [pscustomobject]){throw "Existing TV theme is not valid JSON."}
if($Disable){
    $config|Add-Member -NotePropertyName "gogo_markets_enabled" -NotePropertyValue $false -Force
    Write-Host "Market ticker will be disabled." 
}else{
    $config|Add-Member -NotePropertyName "gogo_markets_url" -NotePropertyValue $FeedUrl -Force
    $config|Add-Member -NotePropertyName "gogo_markets_enabled" -NotePropertyValue $true -Force
    Write-Warning "Only configure feeds whose owner licenses you to display market prices."
}
$new=Join-Path $backup "config-after.json"
[System.IO.File]::WriteAllText($new,($config|ConvertTo-Json -Depth 50),(New-Object System.Text.UTF8Encoding($false)))
& $adb -s $serial push $new "/data/local/tmp/gogo-market-after.json" | Out-Host
if($LASTEXITCODE -ne 0){throw "Upload failed; theme untouched."}
& $adb -s $serial shell 'content write --uri content://com.gathin.tvhome.theme/config.json < /data/local/tmp/gogo-market-after.json' | Out-Host
if($LASTEXITCODE -ne 0){throw "Theme write failed; backup retained."}
& $adb -s $serial shell "content read --uri $provider > /data/local/tmp/gogo-market-verified.json" | Out-Null
$check=Join-Path $backup "verified.json"
& $adb -s $serial pull "/data/local/tmp/gogo-market-verified.json" $check | Out-Null
$verified=Get-Content -LiteralPath $check -Raw | ConvertFrom-Json
if($Disable -and $verified.gogo_markets_enabled -ne $false){throw "Market disable not verified."}
if(!$Disable -and ($verified.gogo_markets_url -ne $FeedUrl -or $verified.gogo_markets_enabled -ne $true)){
    throw "Market configuration verification failed."
}
$env:TV_HOST=$TvIp
& $py -I (Join-Path $Project "tools\theme_restart.py")
if($LASTEXITCODE -ne 0){Write-Warning "Theme verified, but Home restart not confirmed."}
Write-Host "GOGO MARKET CONFIG SAVED" -ForegroundColor Green
Write-Host "Wallpapers and Home redirect not disabled. Backup: $backup"
