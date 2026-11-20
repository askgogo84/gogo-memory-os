[CmdletBinding()]
param(
    [string]$OutputDir,
    [string]$AndroidSdk = $env:ANDROID_HOME
)

$ErrorActionPreference = 'Stop'
if (!$AndroidSdk) { $AndroidSdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$git = (Get-Command git.exe -ErrorAction Stop).Source
$gitRoot = Split-Path (Split-Path $git)
$bash = Join-Path $gitRoot 'bin/bash.exe'
if (!(Test-Path -LiteralPath $bash)) { throw 'Install Git for Windows to use the shared companion build.' }
$python = (Get-Command python.exe -ErrorAction Stop).Source
$oldSdk = $env:ANDROID_HOME
$oldPython = $env:PYTHON
try {
    $env:ANDROID_HOME = (Resolve-Path -LiteralPath $AndroidSdk).Path.Replace('\','/')
    $env:PYTHON = $python.Replace('\','/')
    Push-Location (Join-Path $PSScriptRoot 'companion')
    try {
        & $bash ./build.sh
        if ($LASTEXITCODE -ne 0) { throw 'Companion build failed.' }
        $name = if ($env:GOGO_TV_SIGNING_KEYSTORE) { 'gogo-tv-companion-release.apk' } else { 'gogo-tv-companion-test.apk' }
        $apk = (Resolve-Path -LiteralPath (Join-Path build $name)).Path
        if ($OutputDir) {
            New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
            Copy-Item -LiteralPath $apk -Destination (Join-Path $OutputDir $name) -Force
            $apk = (Resolve-Path -LiteralPath (Join-Path $OutputDir $name)).Path
        }
        Get-FileHash -LiteralPath $apk -Algorithm SHA256
    } finally { Pop-Location }
} finally {
    $env:ANDROID_HOME = $oldSdk
    $env:PYTHON = $oldPython
}
