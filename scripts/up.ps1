$ErrorActionPreference = "Stop"
$compose = Join-Path $PSScriptRoot "..\containers\docker-compose.yml"
$envFile = Join-Path $PSScriptRoot "..\containers\.env"

if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: containers\.env not found." -ForegroundColor Red
    Write-Host "Copy containers\.env.example to containers\.env and fill in:"
    Write-Host "  SPEECH_BILLING_ENDPOINT=https://<region>.api.cognitive.microsoft.com/"
    Write-Host "  SPEECH_API_KEY=<your-key-1>"
    exit 1
}

Write-Host "Starting Azure Speech containers..." -ForegroundColor Cyan
docker compose -f $compose up -d
Write-Host ""
docker compose -f $compose ps
Write-Host ""
Write-Host "Waiting 25s for billing handshake..." -ForegroundColor Yellow
Start-Sleep -Seconds 25
& (Join-Path $PSScriptRoot "smoke-status.ps1")
