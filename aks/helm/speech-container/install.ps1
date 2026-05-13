# Installs all 4 Speech containers (STT en/hi, TTS en/hi) using the custom chart.
# Reads Speech key + billing endpoint from containers/.env

[CmdletBinding()]
param(
  [string]$Chart = "$PSScriptRoot",
  [string]$EnvFile = "$PSScriptRoot\..\..\..\containers\.env"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $EnvFile)) {
  throw "containers/.env not found at $EnvFile — copy containers/.env.example and fill in your Speech key/endpoint."
}

$env_kv = @{}
Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') { $env_kv[$Matches[1]] = $Matches[2].Trim('"') }
}

$BILLING = $env_kv["SPEECH_BILLING"]
$APIKEY  = $env_kv["SPEECH_KEY"]

if (-not $BILLING -or -not $APIKEY) {
  throw "SPEECH_BILLING and SPEECH_KEY must be set in $EnvFile"
}

$deployments = @(
  @{ Release="speech-stt-en"; Namespace="speech-stt-en"; Values="$Chart\examples\stt-en.yaml" },
  @{ Release="speech-stt-hi"; Namespace="speech-stt-hi"; Values="$Chart\examples\stt-hi.yaml" },
  @{ Release="speech-tts-en"; Namespace="speech-tts-en"; Values="$Chart\examples\tts-en.yaml" },
  @{ Release="speech-tts-hi"; Namespace="speech-tts-hi"; Values="$Chart\examples\tts-hi.yaml" }
)

foreach ($d in $deployments) {
  Write-Host ""
  Write-Host "=== Deploying $($d.Release) ===" -ForegroundColor Cyan
  kubectl get ns $d.Namespace 2>$null || kubectl create namespace $d.Namespace | Out-Null

  helm upgrade --install $d.Release $Chart `
    --namespace $d.Namespace `
    --values $d.Values `
    --set "args.billing=$BILLING" `
    --set "args.apikey=$APIKEY" `
    --wait `
    --timeout 10m
}

Write-Host ""
Write-Host "All 4 releases deployed. Endpoints:" -ForegroundColor Green
foreach ($d in $deployments) {
  $ip = kubectl get svc -n $d.Namespace -l "app.kubernetes.io/instance=$($d.Release)" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>$null
  Write-Host ("  {0,-20} : http://{1}:5000" -f $d.Release, $ip)
}
