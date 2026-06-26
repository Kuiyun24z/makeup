$ErrorActionPreference = "Stop"

$VendorRoot = $PSScriptRoot
$TasksRoot = Join-Path $VendorRoot "tasks-vision"
$WasmRoot = Join-Path $TasksRoot "wasm"
$ModelsRoot = Join-Path $VendorRoot "models"
$Version = "0.10.21"

New-Item -ItemType Directory -Force -Path $TasksRoot, $WasmRoot, $ModelsRoot | Out-Null

$Downloads = @(
  @{
    Url = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$Version/vision_bundle.mjs"
    OutFile = Join-Path $TasksRoot "vision_bundle.mjs"
  },
  @{
    Url = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$Version/wasm/vision_wasm_internal.js"
    OutFile = Join-Path $WasmRoot "vision_wasm_internal.js"
  },
  @{
    Url = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$Version/wasm/vision_wasm_internal.wasm"
    OutFile = Join-Path $WasmRoot "vision_wasm_internal.wasm"
  },
  @{
    Url = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$Version/wasm/vision_wasm_nosimd_internal.js"
    OutFile = Join-Path $WasmRoot "vision_wasm_nosimd_internal.js"
  },
  @{
    Url = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$Version/wasm/vision_wasm_nosimd_internal.wasm"
    OutFile = Join-Path $WasmRoot "vision_wasm_nosimd_internal.wasm"
  },
  @{
    Url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
    OutFile = Join-Path $ModelsRoot "face_landmarker.task"
  }
)

foreach ($Download in $Downloads) {
  Write-Host "Downloading $($Download.Url)"
  Invoke-WebRequest -UseBasicParsing -Uri $Download.Url -OutFile $Download.OutFile -TimeoutSec 180
}

Write-Host "MediaPipe assets downloaded to $VendorRoot"
