[CmdletBinding()]
param(
  [string]$ProjectRoot = "D:\work\makeup",
  [switch]$RebuildPythonEnvironment,
  [switch]$SkipPythonPackageSync
)

$ErrorActionPreference = "Stop"

if ($ProjectRoot -ne "D:\work\makeup") {
  throw "This golden bundle must be installed at D:\work\makeup. Current value: $ProjectRoot"
}
if (-not (Test-Path -LiteralPath $ProjectRoot)) {
  throw "Project root does not exist: $ProjectRoot"
}

$condaRoot = "C:\ProgramData\miniconda3"
$condaExe = Join-Path $condaRoot "Scripts\conda.exe"
$environmentPath = Join-Path $condaRoot "envs\openharness"
$environmentPython = Join-Path $environmentPath "python.exe"
$environmentUv = Join-Path $environmentPath "Scripts\uv.exe"
$environmentFile = Join-Path $ProjectRoot "deployment\environment\openharness-environment.yml"
$requirementsFile = Join-Path $ProjectRoot "deployment\environment\openharness-requirements.txt"
$environmentSnapshot = Join-Path $ProjectRoot "offline-assets\conda-env\openharness"
$modelscopeSnapshot = Join-Path $ProjectRoot "offline-assets\modelscope"
$modelscopeTarget = Join-Path $env:USERPROFILE ".cache\modelscope"

if (-not (Test-Path -LiteralPath $condaExe)) {
  throw "Miniconda was not found at $condaRoot. Install it there first."
}

if ($RebuildPythonEnvironment -and (Test-Path -LiteralPath $environmentPath)) {
  & $condaExe env remove -n openharness -y
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to remove the existing openharness environment."
  }
}

if (-not (Test-Path -LiteralPath $environmentPython)) {
  if (Test-Path -LiteralPath $environmentSnapshot) {
    Write-Host "Restoring the exact openharness environment snapshot..."
    New-Item -ItemType Directory -Force -Path $environmentPath | Out-Null
    & robocopy $environmentSnapshot $environmentPath /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS
    if ($LASTEXITCODE -ge 8) {
      throw "Failed to restore the openharness environment snapshot. Robocopy exit code: $LASTEXITCODE"
    }
  } else {
    Write-Host "Creating the openharness environment from the locked YAML..."
    & $condaExe env create -n openharness -f $environmentFile
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to create the openharness environment."
    }
  }
}

if (-not $SkipPythonPackageSync) {
  Write-Host "Synchronizing locked Python packages..."
  & $environmentPython -m pip install -r $requirementsFile
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to install locked Python packages."
  }

  & $environmentPython -m pip install -e (Join-Path $ProjectRoot "OpenHarness-main")
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to install OpenHarness in editable mode."
  }
}

if (-not (Test-Path -LiteralPath $environmentUv)) {
  & $environmentPython -m pip install uv==0.11.23
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to install uv."
  }
}

if (Test-Path -LiteralPath $modelscopeSnapshot) {
  Write-Host "Restoring the offline FunASR ModelScope cache..."
  New-Item -ItemType Directory -Force -Path $modelscopeTarget | Out-Null
  & robocopy $modelscopeSnapshot $modelscopeTarget /E /R:2 /W:2 /NFL /NDL /NJH /NJS
  if ($LASTEXITCODE -ge 8) {
    throw "Failed to restore the ModelScope cache. Robocopy exit code: $LASTEXITCODE"
  }
} else {
  Write-Warning "No offline ModelScope cache was included. FunASR may download its model on first use."
}

$requiredRuntimeFiles = @(
  "gpupixel-main\build\windows-nmake\out\bin\gpupixel_video_client_v21.exe",
  "gpupixel-main\build\windows-nmake\out\bin\gpupixel.dll",
  "local-tts-service\piper\zh_CN-huayan-medium.onnx",
  "models\faster-whisper\model.bin",
  "beauty-studio.local.ps1",
  ".ohmo-beauty-studio\settings.json"
)

foreach ($relativePath in $requiredRuntimeFiles) {
  $fullPath = Join-Path $ProjectRoot $relativePath
  if (-not (Test-Path -LiteralPath $fullPath)) {
    throw "Required runtime file is missing: $fullPath"
  }
}

Write-Host ""
Write-Host "Development bundle installation is complete." -ForegroundColor Green
Write-Host "Run: $ProjectRoot\start-beauty-studio.cmd"

