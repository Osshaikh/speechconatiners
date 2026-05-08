$ErrorActionPreference = "Continue"
$compose = Join-Path $PSScriptRoot "..\containers\docker-compose.yml"
Write-Host "Stopping Azure Speech containers..." -ForegroundColor Cyan
docker compose -f $compose down
