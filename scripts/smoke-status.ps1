# Smoke-tests all four containers' /status endpoints
$ports = @{
  "STT en-IN" = 5001
  "STT hi-IN" = 5002
  "TTS en-IN (Neerja)" = 5003
  "TTS hi-IN (Swara)"  = 5004
}

foreach ($name in $ports.Keys) {
  $port = $ports[$name]
  Write-Host "`n--- $name (localhost:$port) ---" -ForegroundColor Cyan
  try {
    $r = Invoke-RestMethod -Uri "http://localhost:$port/status" -TimeoutSec 5 -ErrorAction Stop
    $r | ConvertTo-Json -Depth 3
  } catch {
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  }
}
