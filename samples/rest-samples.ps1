$ErrorActionPreference = "Stop"

$body = @'
<speak version="1.0" xml:lang="en-IN">
  <voice name="en-IN-NeerjaNeural">
    Hello! This is a test from the Azure Speech container running on your laptop.
  </voice>
</speak>
'@

Invoke-WebRequest `
  -Uri "http://localhost:5003/cognitiveservices/v1" `
  -Method Post `
  -Headers @{
    "Content-Type"             = "application/ssml+xml"
    "X-Microsoft-OutputFormat" = "audio-24khz-48kbitrate-mono-mp3"
  } `
  -Body $body `
  -OutFile (Join-Path $PSScriptRoot "tts-sample.mp3")

Write-Host "Wrote tts-sample.mp3" -ForegroundColor Green

$wav = Join-Path $PSScriptRoot "sample.wav"
if (Test-Path $wav) {
    $resp = Invoke-RestMethod `
      -Uri "http://localhost:5001/speech/recognition/conversation/cognitiveservices/v1?language=en-IN" `
      -Method Post `
      -ContentType "audio/wav; codecs=audio/pcm; samplerate=16000" `
      -InFile $wav
    Write-Host "STT result:" -ForegroundColor Green
    $resp | ConvertTo-Json
} else {
    Write-Host "Skip STT - drop a 16 kHz mono WAV at $wav to test." -ForegroundColor Yellow
}
