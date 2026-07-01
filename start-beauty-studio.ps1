[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$StartOpenHarness = $false,
  [switch]$KeepNativeCameraClients = $false,
  [switch]$NoNativeGPUPixelClient = $false
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
  Write-Host $Message -ForegroundColor Cyan
}

function Write-Warn([string]$Message) {
  Write-Host $Message -ForegroundColor Yellow
}

function Write-Ok([string]$Message) {
  Write-Host $Message -ForegroundColor Green
}

function Test-CommandAvailable([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Resolve-Executable([string[]]$Candidates, [string]$CommandName = "") {
  foreach ($candidate in $Candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  if ($CommandName -and (Test-CommandAvailable $CommandName)) {
    return (Get-Command $CommandName -ErrorAction Stop).Source
  }

  return $null
}

function Get-ListeningProcessId([int]$Port) {
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -First 1
    return $connection.OwningProcess
  } catch {
    return $null
  }
}

function Stop-ListeningProcess([int]$Port, [string]$Label) {
  $targetPid = Get-ListeningProcessId -Port $Port
  if (-not $targetPid) {
    return
  }

  Write-Warn "$Label port $Port is already in use by process $targetPid. Restarting it."
  Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}

function Stop-NativeCameraClients {
  $clients = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -like "gpupixel_video_client*" }
  foreach ($client in $clients) {
    Write-Warn "Stopping old GPUPixel native camera client process $($client.Id)."
    Stop-Process -Id $client.Id -Force -ErrorAction SilentlyContinue
  }
  if ($clients) {
    Start-Sleep -Milliseconds 800
  }
}

function Wait-ForUrl([string]$Url, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  return $false
}

function Start-DetachedProcess(
  [string]$FilePath,
  [string[]]$ArgumentList,
  [string]$WorkingDirectory,
  [string]$StdoutLog,
  [string]$StderrLog
) {
  return Start-Process `
    -FilePath $FilePath `
    -ArgumentList $ArgumentList `
    -WorkingDirectory $WorkingDirectory `
    -WindowStyle Hidden `
    -PassThru
}

function Test-OpenHarnessLauncher([string]$WorkspaceRoot) {
  $openHarnessDir = Join-Path $WorkspaceRoot "OpenHarness-main"
  $uvExe = Resolve-Executable @(
    $env:OPENHARNESS_UV_EXE,
    "C:\ProgramData\miniconda3\envs\openharness\Scripts\uv.exe",
    "D:\Anaconda3\envs\openharness\Scripts\uv.exe"
  ) "uv"
  $condaBat = Resolve-Executable @(
    $env:OPENHARNESS_CONDA_BAT,
    "C:\ProgramData\miniconda3\condabin\conda.bat",
    "D:\Anaconda3\condabin\conda.bat"
  ) ""

  if (-not (Test-Path -LiteralPath $openHarnessDir)) {
    return @{
      Available = $false
      Reason = "OpenHarness directory was not found: $openHarnessDir"
    }
  }

  if (-not $uvExe) {
    return @{
      Available = $false
      Reason = "uv was not found for OpenHarness startup."
    }
  }

  if (-not $condaBat) {
    return @{
      Available = $false
      Reason = "conda.bat was not found for OpenHarness startup."
    }
  }

  return @{
    Available = $true
    WorkingDirectory = $openHarnessDir
    UvExecutable = $uvExe
    CondaBat = $condaBat
    Description = "conda activate openharness + uv run oh"
  }
}

$workspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$siteDir = Join-Path $workspaceRoot "beauty-studio-site"
$serverScript = Join-Path $siteDir "server.js"
$gpupixelServiceDir = Join-Path $workspaceRoot "gpupixel-service"
$gpupixelServiceScript = Join-Path $gpupixelServiceDir "server.js"
$gpupixelNativeScript = Join-Path $workspaceRoot "start-gpupixel-native.cmd"
$localAsrServiceDir = Join-Path $workspaceRoot "local-asr-service"
$localAsrServiceScript = Join-Path $localAsrServiceDir "server.py"
$localTtsServiceDir = Join-Path $workspaceRoot "local-tts-service"
$localTtsServiceScript = Join-Path $localTtsServiceDir "server.py"
$localConfig = Join-Path $workspaceRoot "beauty-studio.local.ps1"
$logDir = Join-Path $workspaceRoot ".logs"
$openHarnessDir = Join-Path $workspaceRoot "OpenHarness-main"

if (-not (Test-Path -LiteralPath $siteDir)) {
  throw "Cannot find site directory: $siteDir"
}

if (-not (Test-Path -LiteralPath $serverScript)) {
  throw "Cannot find server entry file: $serverScript"
}

if (-not (Test-Path -LiteralPath $gpupixelServiceScript)) {
  throw "Cannot find GPUPixel adapter entry file: $gpupixelServiceScript"
}

if (-not $NoNativeGPUPixelClient -and -not (Test-Path -LiteralPath $gpupixelNativeScript)) {
  throw "Cannot find GPUPixel native launcher: $gpupixelNativeScript"
}

if (-not (Test-Path -LiteralPath $localAsrServiceScript)) {
  throw "Cannot find local ASR service entry file: $localAsrServiceScript"
}

if (-not (Test-Path -LiteralPath $localTtsServiceScript)) {
  throw "Cannot find local TTS service entry file: $localTtsServiceScript"
}

if (Test-Path -LiteralPath $localConfig) {
  Write-Info "Loading local config from $localConfig"
  . $localConfig
}

if (-not $env:OPENHARNESS_BASE_URL -and $env:ARK_RESPONSES_URL) {
  $env:OPENHARNESS_BASE_URL = $env:ARK_RESPONSES_URL
}
if (-not $env:OPENHARNESS_API_KEY -and $env:ARK_API_KEY) {
  $env:OPENHARNESS_API_KEY = $env:ARK_API_KEY
}
if (-not $env:OPENHARNESS_MODEL -and $env:ARK_VISION_MODEL) {
  $env:OPENHARNESS_MODEL = $env:ARK_VISION_MODEL
}

$nodeExe = Resolve-Executable @() "node"
if (-not $nodeExe) {
  throw "Node.js was not found in PATH. Install Node.js first, then rerun this script."
}

$pythonExe = Resolve-Executable @(
  $env:LOCAL_ASR_PYTHON,
  "C:\ProgramData\miniconda3\envs\openharness\python.exe",
  "D:\Anaconda3\envs\openharness\python.exe",
  "D:\Anaconda3\python.exe"
) "python"
if (-not $pythonExe) {
  throw "Python was not found for the local ASR bridge."
}

$hostName = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$port = if ($env:PORT) { [int]$env:PORT } else { 4173 }
$gpupixelHost = if ($env:GPUPIXEL_HOST) { $env:GPUPIXEL_HOST } else { "127.0.0.1" }
$gpupixelPort = if ($env:GPUPIXEL_PORT) { [int]$env:GPUPIXEL_PORT } else { 9001 }
$localAsrHost = if ($env:LOCAL_ASR_HOST) { $env:LOCAL_ASR_HOST } else { "127.0.0.1" }
$localAsrPort = if ($env:LOCAL_ASR_PORT) { [int]$env:LOCAL_ASR_PORT } else { 9101 }
$localTtsHost = if ($env:LOCAL_TTS_HOST) { $env:LOCAL_TTS_HOST } else { "127.0.0.1" }
$localTtsPort = if ($env:LOCAL_TTS_PORT) { [int]$env:LOCAL_TTS_PORT } else { 9102 }
$ttsProvider = if ($env:TTS_PROVIDER) { $env:TTS_PROVIDER.Trim().ToLowerInvariant() } else { "local" }
$volcTtsEnabledFlag = if ($env:VOLC_TTS_ENABLED) { $env:VOLC_TTS_ENABLED.Trim().ToLowerInvariant() } else { "" }
$volcTtsEnabled = @("on", "true", "1") -contains $volcTtsEnabledFlag
$useLocalTts = -not ($ttsProvider -eq "volcengine" -or $volcTtsEnabled)

$env:GPUPIXEL_SERVICE_URL = if ($env:GPUPIXEL_SERVICE_URL) {
  $env:GPUPIXEL_SERVICE_URL
} else {
  "http://{0}:{1}" -f $gpupixelHost, $gpupixelPort
}
$env:LOCAL_ASR_SERVICE_URL = if ($env:LOCAL_ASR_SERVICE_URL) {
  $env:LOCAL_ASR_SERVICE_URL
} else {
  "http://{0}:{1}" -f $localAsrHost, $localAsrPort
}
$env:LOCAL_TTS_SERVICE_URL = if ($env:LOCAL_TTS_SERVICE_URL) {
  $env:LOCAL_TTS_SERVICE_URL
} else {
  "http://{0}:{1}" -f $localTtsHost, $localTtsPort
}
$env:LOCAL_ASR_HOST = $localAsrHost
$env:LOCAL_ASR_PORT = [string]$localAsrPort
$env:LOCAL_TTS_HOST = $localTtsHost
$env:LOCAL_TTS_PORT = [string]$localTtsPort

$siteUrl = "http://{0}:{1}" -f $hostName, $port
$healthUrl = "$siteUrl/api/health"
$gpupixelHealthUrl = "http://{0}:{1}/health" -f $gpupixelHost, $gpupixelPort
$gpupixelStreamHealthUrl = "http://127.0.0.1:8791/health"
$localAsrHealthUrl = "http://{0}:{1}/health" -f $localAsrHost, $localAsrPort
$localTtsHealthUrl = "http://{0}:{1}/health" -f $localTtsHost, $localTtsPort

Stop-ListeningProcess -Port $port -Label "Site"
Stop-ListeningProcess -Port $gpupixelPort -Label "GPUPixel"
Stop-ListeningProcess -Port $localAsrPort -Label "Local ASR"
Stop-ListeningProcess -Port $localTtsPort -Label "Local TTS"
if (-not $KeepNativeCameraClients) {
  Stop-NativeCameraClients
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdoutLog = Join-Path $logDir "beauty-studio.stdout.log"
$stderrLog = Join-Path $logDir "beauty-studio.stderr.log"
$gpupixelStdoutLog = Join-Path $logDir "gpupixel.stdout.log"
$gpupixelStderrLog = Join-Path $logDir "gpupixel.stderr.log"
$localAsrStdoutLog = Join-Path $logDir "local-asr.stdout.log"
$localAsrStderrLog = Join-Path $logDir "local-asr.stderr.log"
$localTtsStdoutLog = Join-Path $logDir "local-tts.stdout.log"
$localTtsStderrLog = Join-Path $logDir "local-tts.stderr.log"

Write-Info "Starting Beauty Studio on $siteUrl"
Write-Info "GPUPixel adapter target: $($env:GPUPIXEL_SERVICE_URL)"
Write-Info "Local ASR adapter target: $($env:LOCAL_ASR_SERVICE_URL)"
if ($useLocalTts) {
  Write-Info "Local TTS adapter target: $($env:LOCAL_TTS_SERVICE_URL)"
} else {
  Write-Info "Cloud TTS provider: $ttsProvider"
}

if ($env:ARK_API_KEY) {
  Write-Info "Ark Vision mode: enabled"
} else {
  Write-Warn "ARK_API_KEY is not set. The site will fall back to local guidance."
}

$launcher = Test-OpenHarnessLauncher -WorkspaceRoot $workspaceRoot
if ($launcher.Available) {
  Write-Info "OpenHarness runtime detected: $($launcher.Description)"
} else {
  Write-Info "OpenHarness runtime not ready: $($launcher.Reason)"
}

if ($StartOpenHarness -and $launcher.Available -and (Test-Path -LiteralPath $openHarnessDir)) {
  $ohStdoutLog = Join-Path $logDir "openharness.stdout.log"
  $ohStderrLog = Join-Path $logDir "openharness.stderr.log"
  $openHarnessCommand = ('call "{0}" activate openharness && "{1}" run oh' -f $launcher.CondaBat, $launcher.UvExecutable)
  Write-Info "Starting optional OpenHarness backend with $($launcher.Description)"
  Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList @("/c", $openHarnessCommand) `
    -WorkingDirectory $launcher.WorkingDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput $ohStdoutLog `
    -RedirectStandardError $ohStderrLog | Out-Null
}

$gpupixelProcess = Start-DetachedProcess `
  -FilePath $nodeExe `
  -ArgumentList @($gpupixelServiceScript) `
  -WorkingDirectory $gpupixelServiceDir `
  -StdoutLog $gpupixelStdoutLog `
  -StderrLog $gpupixelStderrLog

$gpupixelNativeProcess = $null
if (-not $NoNativeGPUPixelClient) {
  Write-Info "Starting GPUPixel native video client and local stream."
  $gpupixelNativeProcess = Start-Process `
    -FilePath $gpupixelNativeScript `
    -WorkingDirectory $workspaceRoot `
    -WindowStyle Normal `
    -PassThru
}

$localAsrProcess = Start-DetachedProcess `
  -FilePath $pythonExe `
  -ArgumentList @($localAsrServiceScript) `
  -WorkingDirectory $localAsrServiceDir `
  -StdoutLog $localAsrStdoutLog `
  -StderrLog $localAsrStderrLog

$localTtsProcess = $null
if ($useLocalTts) {
  $localTtsProcess = Start-DetachedProcess `
    -FilePath $pythonExe `
    -ArgumentList @($localTtsServiceScript) `
    -WorkingDirectory $localTtsServiceDir `
    -StdoutLog $localTtsStdoutLog `
    -StderrLog $localTtsStderrLog
}

$siteProcess = Start-DetachedProcess `
  -FilePath $nodeExe `
  -ArgumentList @($serverScript) `
  -WorkingDirectory $siteDir `
  -StdoutLog $stdoutLog `
  -StderrLog $stderrLog

if (-not (Wait-ForUrl -Url $localAsrHealthUrl -TimeoutSeconds 90)) {
  throw "The local ASR service did not become ready within 90 seconds. Check logs:`n$localAsrStdoutLog`n$localAsrStderrLog"
}

if ($useLocalTts -and -not (Wait-ForUrl -Url $localTtsHealthUrl -TimeoutSeconds 20)) {
  throw "The local TTS service did not become ready within 20 seconds. Check logs:`n$localTtsStdoutLog`n$localTtsStderrLog"
}

if (-not (Wait-ForUrl -Url $gpupixelHealthUrl -TimeoutSeconds 20)) {
  Write-Warn "GPUPixel adapter did not answer /health within 20 seconds. The site will still be started."
}

if (-not $NoNativeGPUPixelClient -and -not (Wait-ForUrl -Url $gpupixelStreamHealthUrl -TimeoutSeconds 45)) {
  Write-Warn "GPUPixel native stream did not answer /health within 45 seconds. The site will still be started."
}

if (-not (Wait-ForUrl -Url $healthUrl -TimeoutSeconds 20)) {
  throw "The site did not become ready within 20 seconds. Check logs:`n$stdoutLog`n$stderrLog"
}

Write-Ok "Beauty Studio is running."
Write-Host "URL: $siteUrl"
Write-Host "Site PID: $($siteProcess.Id)"
Write-Host "GPUPixel PID: $($gpupixelProcess.Id)"
if ($gpupixelNativeProcess) {
  Write-Host "GPUPixel native launcher PID: $($gpupixelNativeProcess.Id)"
  Write-Host "GPUPixel stream: http://127.0.0.1:8791/stream.mjpg"
}
Write-Host "Local ASR PID: $($localAsrProcess.Id)"
if ($localTtsProcess) {
  Write-Host "Local TTS PID: $($localTtsProcess.Id)"
} else {
  Write-Host "Local TTS PID: skipped ($ttsProvider)"
}
Write-Host "Site logs: $stdoutLog"
Write-Host "           $stderrLog"
Write-Host "GPUPixel logs: $gpupixelStdoutLog"
Write-Host "               $gpupixelStderrLog"
Write-Host "Local ASR logs: $localAsrStdoutLog"
Write-Host "                $localAsrStderrLog"
if ($useLocalTts) {
  Write-Host "Local TTS logs: $localTtsStdoutLog"
  Write-Host "                $localTtsStderrLog"
}

if (-not $NoBrowser) {
  Start-Process $siteUrl
}
