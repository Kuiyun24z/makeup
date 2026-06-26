$ErrorActionPreference = "Stop"

$VendorRoot = $PSScriptRoot
$RequiredFiles = @(
  "tasks-vision\vision_bundle.mjs",
  "tasks-vision\wasm\vision_wasm_internal.js",
  "tasks-vision\wasm\vision_wasm_internal.wasm",
  "tasks-vision\wasm\vision_wasm_nosimd_internal.js",
  "tasks-vision\wasm\vision_wasm_nosimd_internal.wasm",
  "models\face_landmarker.task"
)

$Missing = @()
foreach ($RelativePath in $RequiredFiles) {
  $Path = Join-Path $VendorRoot $RelativePath
  if (-not (Test-Path -LiteralPath $Path)) {
    $Missing += $RelativePath
  }
}

if ($Missing.Count -gt 0) {
  Write-Host "Missing MediaPipe assets:"
  foreach ($Item in $Missing) {
    Write-Host "  - $Item"
  }
  exit 1
}

Write-Host "MediaPipe assets are present."
