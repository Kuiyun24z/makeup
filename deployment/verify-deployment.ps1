[CmdletBinding()]
param(
  [string]$ProjectRoot = "D:\work\makeup",
  [switch]$StartServices
)

$ErrorActionPreference = "Stop"

function Invoke-CheckedStep([string]$Name, [scriptblock]$Action) {
  Write-Host ""
  Write-Host "== $Name ==" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

function Test-Health([int]$Port, [string]$Path) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}{1}" -f $Port, $Path) -TimeoutSec 5
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if ($StartServices -and -not (Test-Health 4173 "/api/health")) {
  & (Join-Path $ProjectRoot "start-beauty-studio.ps1") -NoBrowser
  if ($LASTEXITCODE -ne 0) {
    throw "The one-click startup script failed."
  }
}

$siteDir = Join-Path $ProjectRoot "beauty-studio-site"
$openHarnessDir = Join-Path $ProjectRoot "OpenHarness-main"
$uvExe = "C:\ProgramData\miniconda3\envs\openharness\Scripts\uv.exe"

Push-Location $siteDir
try {
  $testFiles = Get-ChildItem -LiteralPath $siteDir -Filter "*.test.js" -File | ForEach-Object { $_.Name }
  Invoke-CheckedStep "Beauty Studio Node tests" {
    & node --test @testFiles
  }
  Invoke-CheckedStep "Beauty Studio syntax checks" {
    & node --check server.js
    if ($LASTEXITCODE -ne 0) { throw "server.js syntax check failed." }
    & node --check public\app.js
    if ($LASTEXITCODE -ne 0) { throw "public\app.js syntax check failed." }
  }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $uvExe)) {
  throw "uv was not found: $uvExe"
}

$env:UV_CACHE_DIR = Join-Path $ProjectRoot ".uv-cache"
Push-Location $openHarnessDir
try {
  Invoke-CheckedStep "OpenHarness PLHD and FunctionCallEnd regression" {
    & $uvExe run python tests\repro_plhd_inline_tool.py
  }
  Invoke-CheckedStep "OpenHarness tool allowlist regression" {
    & $uvExe run python tests\repro_tool_allowlist.py
  }
  Invoke-CheckedStep "Beauty vision plugin tests" {
    & $uvExe run python (Join-Path $ProjectRoot ".ohmo-beauty-studio\plugins\beauty-vision\tests\test_inspect_current_beauty_frame.py") -v
  }
} finally {
  Pop-Location
}

$healthChecks = @(
  @{ Name = "Beauty Studio"; Port = 4173; Path = "/api/health" },
  @{ Name = "GPUPixel adapter"; Port = 9001; Path = "/health" },
  @{ Name = "GPUPixel stream"; Port = 8791; Path = "/health" },
  @{ Name = "Local ASR"; Port = 9101; Path = "/health" },
  @{ Name = "Local TTS"; Port = 9102; Path = "/health" }
)

$healthRows = foreach ($item in $healthChecks) {
  [pscustomobject]@{
    Service = $item.Name
    Port = $item.Port
    Status = if (Test-Health $item.Port $item.Path) { "OK" } else { "NOT RUNNING" }
  }
}
$healthRows | Format-Table -AutoSize

$cameraProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like "gpupixel_video_client*" })
Write-Host "GPUPixel camera process count: $($cameraProcesses.Count)"
if ($cameraProcesses.Count -gt 1) {
  throw "More than one GPUPixel camera process is running."
}

Write-Host ""
Write-Host "Deployment verification completed." -ForegroundColor Green
