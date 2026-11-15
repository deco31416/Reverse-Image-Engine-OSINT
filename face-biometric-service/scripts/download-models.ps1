param([string]$Destination = (Join-Path $PSScriptRoot '..\models'))

$ErrorActionPreference = 'Stop'
$destinationPath = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null

$models = @(
  @{
    Name = 'face_detection_yunet_2023mar.onnx'
    Url = 'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx'
  },
  @{
    Name = 'face_recognition_sface_2021dec.onnx'
    Url = 'https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx'
  }
)

foreach ($model in $models) {
  $target = Join-Path $destinationPath $model.Name
  Invoke-WebRequest -Uri $model.Url -OutFile $target
  if ((Get-Item -LiteralPath $target).Length -lt 100000) {
    throw "El modelo descargado parece incompleto: $($model.Name)"
  }
  $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "$($model.Name) sha256=$hash"
}
