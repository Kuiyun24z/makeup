$ErrorActionPreference = "Stop"
$VoskDir = $PSScriptRoot
$LibraryPath = Join-Path $VoskDir "vosk.js"
$ModelPath = Join-Path $VoskDir "vosk-model-small-cn.tar.gz"

$LibraryUrl = "https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js"
$ModelTarUrls = @(
  "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-cn-0.22.tar.gz",
  "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-cn-0.3.tar.gz"
)
$ModelZipUrl = "https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip"

function Download-File($Url, $Target) {
  Write-Host "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $Target -UseBasicParsing
}

# 1. vosk-browser library
if (Test-Path $LibraryPath) {
  Write-Host "vosk.js already present, skipping."
} else {
  Download-File $LibraryUrl $LibraryPath
}

# 2. Chinese small model as tar.gz (what vosk-browser createModel expects)
if (Test-Path $ModelPath) {
  Write-Host "Model archive already present, skipping."
} else {
  $downloaded = $false
  foreach ($url in $ModelTarUrls) {
    try {
      Download-File $url $ModelPath
      $downloaded = $true
      break
    } catch {
      Write-Host "Direct tar.gz not available at $url"
    }
  }

  if (-not $downloaded) {
    Write-Host "Falling back to the official zip + repack (needs Windows 10+ tar)."
    $zipPath = Join-Path $VoskDir "vosk-model-small-cn-0.22.zip"
    $extractDir = Join-Path $VoskDir "model-extract"
    Download-File $ModelZipUrl $zipPath
    if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
    Expand-Archive -Path $zipPath -DestinationPath $extractDir
    $modelFolder = Get-ChildItem -Directory $extractDir | Select-Object -First 1
    if (-not $modelFolder) { throw "Model zip extracted but no folder was found." }
    tar -czf $ModelPath -C $extractDir $modelFolder.Name
    Remove-Item -Recurse -Force $extractDir
    Remove-Item -Force $zipPath
  }
}

Write-Host ""
Write-Host "Vosk assets ready:"
Get-Item $LibraryPath, $ModelPath | ForEach-Object {
  Write-Host ("  {0}  {1:N1} MB" -f $_.Name, ($_.Length / 1MB))
}
Write-Host "Restart the demo (web_demo\start_demo.cmd) and toggle 魔镜待机 to use local wake word."
