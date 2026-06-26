$ErrorActionPreference = "Stop"

try {
  $listeners = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8765 -State Listen -ErrorAction Stop
} catch {
  Write-Host "No Beauty Agent demo server is listening on http://127.0.0.1:8765"
  exit 0
}

foreach ($listener in $listeners) {
  $processId = $listener.OwningProcess
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process -and ($process.ProcessName -like "python*")) {
    Stop-Process -Id $processId
    Write-Host "Stopped Beauty Agent demo server process $processId"
  } else {
    Write-Host "Port 8765 is owned by process $processId, not a Python demo process. Leaving it running."
  }
}
