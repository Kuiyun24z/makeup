$ErrorActionPreference = "Stop"

$DemoDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $DemoDir
$Pythonw = Join-Path $ProjectRoot ".venv-openharness\Scripts\pythonw.exe"

if (-not (Test-Path -LiteralPath $Pythonw)) {
  throw "Missing Python runtime: $Pythonw"
}

# Always restart: an old process would keep serving stale backend code.
try {
  $existing = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8765 -State Listen -ErrorAction Stop
  if ($existing) {
    Write-Host "Found a running demo server; restarting it to pick up latest code..."
    & (Join-Path $DemoDir "stop_demo.ps1")
    Start-Sleep -Seconds 1
  }
} catch {
}

Start-Process -FilePath $Pythonw -ArgumentList "web_demo\server.py" -WorkingDirectory $ProjectRoot -WindowStyle Hidden
Start-Sleep -Seconds 2

$health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/api/health" -TimeoutSec 10
if (-not $health.ok) {
  throw "Demo server started, but Ollama health check failed."
}

Write-Host "Beauty Agent demo running at http://127.0.0.1:8765"
