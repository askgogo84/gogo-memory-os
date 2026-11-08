param([string]$TvIp='192.168.29.122', [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (!(Test-Path $adb)) { throw 'ADB not found.' }
$serial = "${TvIp}:5555"
& $adb connect $serial
if ($LASTEXITCODE -ne 0) { throw 'TV unreachable.' }
& $adb -s $serial shell am force-stop in.askgogo.markets
if ($LASTEXITCODE -ne 0) { throw 'Could not stop ticker.' }
if ($Uninstall) {
  & $adb -s $serial uninstall in.askgogo.markets
  if ($LASTEXITCODE -ne 0) { throw 'Could not uninstall.' }
  Write-Host 'Gogo Markets removed. CleanYourTV and wallpapers unchanged.'
} else {
  Write-Host 'Gogo Markets stopped. CleanYourTV and wallpapers unchanged.'
}
