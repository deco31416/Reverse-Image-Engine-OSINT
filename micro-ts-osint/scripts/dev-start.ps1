param(
  [int]$Port = 7102,
  [string]$ServiceToken = "dev"
)

$ErrorActionPreference = "Stop"

# Ports (avoid 7000/3000)
$env:PORT = "$Port"

# Service-to-service auth
$env:SERVICE_TOKENS = '{"auth-ia-cam":"' + $ServiceToken + '"}'

Write-Host "[notifications-ia-cam] Starting on port $env:PORT (no .env changes)" -ForegroundColor Cyan
Write-Host "[notifications-ia-cam] SERVICE_TOKENS set for auth-ia-cam" -ForegroundColor Cyan

yarn start:dev
