# install.ps1 - Idempotent installer for the 4 Speech Helm releases on AKS
# Reads SPEECH_API_KEY and SPEECH_BILLING_ENDPOINT from ../../containers/.env
# Usage: pwsh ./install.ps1   (run from aks/helm/ directory)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $here '..\..\containers\.env'
if (-not (Test-Path $envFile)) { throw "Missing $envFile" }
$envContent = Get-Content $envFile
$apiKey  = ($envContent | Where-Object { $_ -match '^SPEECH_API_KEY=' }) -replace 'SPEECH_API_KEY=',''
$billing = ($envContent | Where-Object { $_ -match '^SPEECH_BILLING_ENDPOINT=' }) -replace 'SPEECH_BILLING_ENDPOINT=',''
if (-not $apiKey)  { throw 'SPEECH_API_KEY not found in .env' }
if (-not $billing) { throw 'SPEECH_BILLING_ENDPOINT not found in .env' }
Write-Host "Using billing endpoint: $billing"

# 1. Microsoft Helm repo
helm repo add microsoft https://microsoft.github.io/charts/repo 2>$null | Out-Null
helm repo update | Out-Null

# 2. Four releases, each in its own namespace (chart hardcodes deployment/service names)
$releases = @(
    @{ name='stt-en'; ns='speech-stt-en'; values='values/stt-en.yaml'; sub='speechToText' },
    @{ name='stt-hi'; ns='speech-stt-hi'; values='values/stt-hi.yaml'; sub='speechToText' },
    @{ name='tts-en'; ns='speech-tts-en'; values='values/tts-en.yaml'; sub='textToSpeech' },
    @{ name='tts-hi'; ns='speech-tts-hi'; values='values/tts-hi.yaml'; sub='textToSpeech' }
)
foreach ($r in $releases) {
    Write-Host "==> Installing $($r.name) into namespace $($r.ns)"
    helm upgrade --install $r.name microsoft/cognitive-services-speech-onpremise `
        --namespace $r.ns --create-namespace `
        -f (Join-Path $here $r.values) `
        --set "$($r.sub).image.args.billing=$billing" `
        --set "$($r.sub).image.args.apikey=$apiKey" `
        --wait --timeout 15m
}

Write-Host "`n==> All 4 releases installed. Services:"
foreach ($r in $releases) {
    Write-Host "--- $($r.name) ($($r.ns)) ---"
    kubectl get svc,pods -n $r.ns
}
