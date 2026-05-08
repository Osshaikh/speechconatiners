#!/usr/bin/env bash
set -euo pipefail

curl -sS -X POST "http://localhost:5003/cognitiveservices/v1" \
  -H "Content-Type: application/ssml+xml" \
  -H "X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3" \
  --data '<speak version="1.0" xml:lang="en-IN"><voice name="en-IN-NeerjaNeural">Hello from the container.</voice></speak>' \
  --output tts-sample.mp3
echo "Wrote tts-sample.mp3"

if [[ -f sample.wav ]]; then
  curl -sS -X POST "http://localhost:5001/speech/recognition/conversation/cognitiveservices/v1?language=en-IN" \
    -H "Content-Type: audio/wav; codecs=audio/pcm; samplerate=16000" \
    --data-binary @sample.wav | jq .
fi

echo "---"
for p in 5001 5002 5003 5004; do
  echo "Port $p:"
  curl -sS "http://localhost:$p/status" || echo "  (down)"
  echo
done
