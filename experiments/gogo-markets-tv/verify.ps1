param([string]$TvIp='192.168.29.122')
$ErrorActionPreference = 'Stop'
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (!(Test-Path $adb)) { throw 'ADB not found.' }
$serial = "${TvIp}:5555"
& $adb connect $serial
if ($LASTEXITCODE -ne 0) { throw 'TV connection failed.' }
Write-Host 'Installed ticker package:'
& $adb -s $serial shell pm list packages in.askgogo.markets
Write-Host 'Special permissions:'
& $adb -s $serial shell appops get in.askgogo.markets
Write-Host 'Active TV home:'
& $adb -s $serial shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME
Write-Host 'Also test manually: press Home, then open Netflix and return Home.'
