[CmdletBinding()]
param(
  [string]$ProjectRoot = "D:\work\makeup"
)

$ErrorActionPreference = "Stop"

function Find-FirstExistingPath([string[]]$Candidates) {
  foreach ($candidate in $Candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return $null
}

function Add-Check(
  [System.Collections.Generic.List[object]]$Results,
  [string]$Name,
  [bool]$Passed,
  [string]$Detail
) {
  $Results.Add([pscustomobject]@{
    Item = $Name
    Status = if ($Passed) { "OK" } else { "MISSING" }
    Detail = $Detail
  })
}

$results = [System.Collections.Generic.List[object]]::new()

Add-Check $results "Project path" ($ProjectRoot -eq "D:\work\makeup" -and (Test-Path -LiteralPath $ProjectRoot)) $ProjectRoot

$node = Get-Command node -ErrorAction SilentlyContinue
Add-Check $results "Node.js" ($null -ne $node) $(if ($node) { "$($node.Source) $(& node --version)" } else { "Install Node.js 24." })

$git = Get-Command git -ErrorAction SilentlyContinue
Add-Check $results "Git" ($null -ne $git) $(if ($git) { "$($git.Source) $(& git --version)" } else { "Install Git for Windows." })

$conda = Find-FirstExistingPath @(
  "C:\ProgramData\miniconda3\Scripts\conda.exe",
  "C:\ProgramData\miniconda3\condabin\conda.bat"
)
Add-Check $results "Miniconda" ($null -ne $conda) $(if ($conda) { $conda } else { "Install to C:\ProgramData\miniconda3." })

$vswhere = Find-FirstExistingPath @(
  "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
)
$vcInstall = ""
if ($vswhere) {
  $vcInstall = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
}
Add-Check $results "Visual C++ tools" (-not [string]::IsNullOrWhiteSpace($vcInstall)) $(if ($vcInstall) { $vcInstall } else { "Install Desktop development with C++." })

$cmakeCandidates = @("C:\Program Files\CMake\bin\cmake.exe")
if ($vcInstall) {
  $cmakeCandidates += Join-Path $vcInstall "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
}
$cmake = Find-FirstExistingPath $cmakeCandidates
Add-Check $results "CMake" ($null -ne $cmake) $(if ($cmake) { $cmake } else { "Install CMake or Visual Studio CMake tools." })

$browser = Find-FirstExistingPath @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
Add-Check $results "Edge or Chrome" ($null -ne $browser) $(if ($browser) { $browser } else { "Install Edge or Chrome." })

$requiredFiles = @(
  "start-beauty-studio.cmd",
  "start-beauty-studio.ps1",
  "beauty-studio.local.ps1",
  "beauty-studio-site\server.js",
  "gpupixel-main\build\windows-nmake\out\bin\gpupixel_video_client_v21.exe",
  "gpupixel-main\build\windows-nmake\out\bin\gpupixel.dll",
  "local-tts-service\piper\zh_CN-huayan-medium.onnx",
  "models\faster-whisper\model.bin",
  "OpenHarness-main\pyproject.toml",
  ".ohmo-beauty-studio\plugins\beauty-vision\plugin.json"
)

foreach ($relativePath in $requiredFiles) {
  $fullPath = Join-Path $ProjectRoot $relativePath
  Add-Check $results $relativePath (Test-Path -LiteralPath $fullPath) $fullPath
}

$results | Format-Table -Wrap -AutoSize

$failed = @($results | Where-Object { $_.Status -ne "OK" })
if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "Prerequisite check failed: $($failed.Count) item(s) missing." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "All prerequisites are ready." -ForegroundColor Green
