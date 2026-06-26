$ErrorActionPreference = "Stop"
$VoskDir = $PSScriptRoot
$Library = Join-Path $VoskDir "vosk.js"
$Model = Join-Path $VoskDir "vosk-model-small-cn.tar.gz"

$ok = $true
if (-not (Test-Path $Library)) {
  Write-Host "MISSING: vosk.js"
  $ok = $false
}
if (-not (Test-Path $Model)) {
  Write-Host "MISSING: vosk-model-small-cn.tar.gz"
  $ok = $false
} elseif ((Get-Item $Model).Length -lt 10MB) {
  Write-Host "SUSPICIOUS: model archive is smaller than 10 MB; download may be incomplete."
  $ok = $false
}

if ($ok) {
  Write-Host "Vosk local assets are present."
  exit 0
}
Write-Host "Run download_vosk_assets.cmd to fetch the missing assets."
exit 1
