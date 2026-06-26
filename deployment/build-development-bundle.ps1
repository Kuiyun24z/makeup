[CmdletBinding()]
param(
  [string]$ProjectRoot = "D:\work\makeup",
  [string]$OutputRoot = "D:\work\makeup\dist",
  [switch]$CreateArchive,
  [switch]$SkipCondaEnvironmentSnapshot
)

$ErrorActionPreference = "Stop"

function Assert-ChildPath([string]$Parent, [string]$Child) {
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd("\") + "\"
  $childFull = [IO.Path]::GetFullPath($Child)
  if (-not $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe path outside output root: $childFull"
  }
}

function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Required source directory is missing: $Source"
  }

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $excludedDirectories = @(
    ".git",
    ".logs",
    ".superpowers",
    ".uv-cache",
    ".pytest_cache",
    "__pycache__",
    "mediapipe_bridge_browser_profile",
    "dist"
  )
  $arguments = @(
    $Source,
    $Destination,
    "/E",
    "/COPY:DAT",
    "/DCOPY:DAT",
    "/R:2",
    "/W:2",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/XD"
  ) + $excludedDirectories

  & robocopy @arguments
  if ($LASTEXITCODE -ge 8) {
    throw "Robocopy failed for $Source with exit code $LASTEXITCODE"
  }
}

if ($ProjectRoot -ne "D:\work\makeup") {
  throw "The golden bundle source must be D:\work\makeup. Current value: $ProjectRoot"
}

$outputFull = [IO.Path]::GetFullPath($OutputRoot)
$bundleContainer = Join-Path $outputFull "makeup-development-bundle"
$stageRoot = Join-Path $bundleContainer "makeup"
Assert-ChildPath $outputFull $bundleContainer
Assert-ChildPath $outputFull $stageRoot

if (Test-Path -LiteralPath $bundleContainer) {
  Remove-Item -LiteralPath $bundleContainer -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

$directories = @(
  ".ohmo-beauty-studio",
  "beauty-studio-site",
  "gpupixel-main",
  "gpupixel-service",
  "local-asr-service",
  "local-tts-service",
  "models",
  "OpenHarness-main",
  "docs",
  "deployment"
)

foreach ($relativePath in $directories) {
  Write-Host "Copying $relativePath..."
  Copy-Tree (Join-Path $ProjectRoot $relativePath) (Join-Path $stageRoot $relativePath)
}

$rootFiles = @(
  "AGENTS.md",
  "DEPLOYMENT.md",
  "beauty-studio.local.ps1",
  "beauty-studio.local.example.ps1",
  "start-beauty-studio.cmd",
  "start-beauty-studio.ps1",
  "start-gpupixel-native.cmd"
)

foreach ($relativePath in $rootFiles) {
  $source = Join-Path $ProjectRoot $relativePath
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Required root file is missing: $source"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $stageRoot $relativePath) -Force
}

$offlineAssets = Join-Path $stageRoot "offline-assets"
New-Item -ItemType Directory -Force -Path $offlineAssets | Out-Null

$modelscopeSource = Join-Path $env:USERPROFILE ".cache\modelscope"
Write-Host "Copying offline FunASR ModelScope cache..."
Copy-Tree $modelscopeSource (Join-Path $offlineAssets "modelscope")

if (-not $SkipCondaEnvironmentSnapshot) {
  $condaEnvironmentSource = "C:\ProgramData\miniconda3\envs\openharness"
  Write-Host "Copying exact openharness Conda environment snapshot..."
  Copy-Tree $condaEnvironmentSource (Join-Path $offlineAssets "conda-env\openharness")
}

$bundleInfo = @(
  "Beauty Studio Golden Development Bundle",
  "Generated: $(Get-Date -Format o)",
  "Required install path: D:\work\makeup",
  "Contains a temporarily shared Ark API key.",
  "Read DEPLOYMENT.md and deployment\SECURITY-NOTICE.md before use."
)
$bundleInfo | Set-Content -LiteralPath (Join-Path $stageRoot "BUNDLE-README.txt") -Encoding utf8

Write-Host "Generating SHA-256 manifest..."
$files = Get-ChildItem -LiteralPath $stageRoot -File -Recurse -Force |
  Where-Object { $_.Name -notin @("BUNDLE-MANIFEST.csv", "BUNDLE-SHA256.txt") }

$manifestRows = foreach ($file in $files) {
  $relativePath = $file.FullName.Substring($stageRoot.Length).TrimStart("\")
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  [pscustomobject]@{
    RelativePath = $relativePath
    Length = $file.Length
    SHA256 = $hash
  }
}

$manifestPath = Join-Path $stageRoot "BUNDLE-MANIFEST.csv"
$hashPath = Join-Path $stageRoot "BUNDLE-SHA256.txt"
$manifestRows | Sort-Object RelativePath | Export-Csv -LiteralPath $manifestPath -NoTypeInformation -Encoding utf8
$manifestRows |
  Sort-Object RelativePath |
  ForEach-Object { "$($_.SHA256)  $($_.RelativePath)" } |
  Set-Content -LiteralPath $hashPath -Encoding ascii

Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $outputFull "makeup-development-bundle-manifest.csv") -Force
Copy-Item -LiteralPath $hashPath -Destination (Join-Path $outputFull "makeup-development-bundle-sha256.txt") -Force

$totalBytes = ($manifestRows | Measure-Object Length -Sum).Sum
Write-Host ("Staged bundle size: {0:N2} GB" -f ($totalBytes / 1GB))
Write-Host "Staged bundle: $stageRoot"

if ($CreateArchive) {
  $archivePath = Join-Path $outputFull "makeup-development-bundle.zip"
  Assert-ChildPath $outputFull $archivePath
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }

  $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
  if (-not $tar) {
    throw "tar.exe was not found. The staged bundle is ready, but the ZIP archive was not created."
  }

  Write-Host "Creating ZIP archive..."
  & $tar.Source -a -c -f $archivePath -C $bundleContainer "makeup"
  if ($LASTEXITCODE -ne 0) {
    throw "Archive creation failed with exit code $LASTEXITCODE"
  }
  Write-Host ("Archive size: {0:N2} GB" -f ((Get-Item -LiteralPath $archivePath).Length / 1GB))
  Write-Host "Archive: $archivePath"
}

Write-Host "Golden development bundle build completed." -ForegroundColor Green

