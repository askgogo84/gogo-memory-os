# Loads .env.local into the current PowerShell session so npm test can run locally.
# Usage:  . .\scripts\load-env.ps1
Get-Content "$PSScriptRoot\..\.env.local" | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    $v = $matches[2].Trim().Trim('"').Trim("'")
    [System.Environment]::SetEnvironmentVariable($matches[1], $v, 'Process')
  }
}
Write-Host "Loaded .env.local into this session" -ForegroundColor Green
