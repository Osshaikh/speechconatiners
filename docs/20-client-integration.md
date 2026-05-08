# Client Integration Patterns

The connected containers expose **the same APIs as the Azure Speech cloud service**, but on `localhost`. Three patterns:

| Use case | Approach | Best for |
|---|---|---|
| Continuous mic streaming, low-latency partials | Speech SDK with `fromHost` | Browser, Node, .NET, Python clients |
| Batch transcription of audio files | REST `POST /speech/recognition/conversation/cognitiveservices/v1` | Servers, IVR recording analysis |
| One-shot TTS synthesis | REST `POST /cognitiveservices/v1` | Backend voice generation, prompt baking |

The container does **not** authenticate inbound client requests — anyone who can reach the port can use it. **Do not expose container ports beyond your trusted network.** Place an API gateway (NGINX, Envoy, APIM) in front for production deployments.

---

## Pattern 1 — Speech SDK against the container

The trick: `SpeechConfig.fromHost()` instead of `fromSubscription()`. Pass an empty key.

### JavaScript / TypeScript (browser, what this demo uses)

```ts
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

// STT — note ws:// scheme
const sttConfig = SpeechSDK.SpeechConfig.fromHost(new URL("ws://localhost:5001"), "");
sttConfig.speechRecognitionLanguage = "en-IN";
const audio = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
const recognizer = new SpeechSDK.SpeechRecognizer(sttConfig, audio);
recognizer.recognized = (_s, e) => console.log(e.result.text);
recognizer.startContinuousRecognitionAsync();

// TTS — note http:// scheme
const ttsConfig = SpeechSDK.SpeechConfig.fromHost(new URL("http://localhost:5003"), "");
ttsConfig.speechSynthesisVoiceName = "en-IN-NeerjaNeural";
const synth = new SpeechSDK.SpeechSynthesizer(ttsConfig);
synth.speakTextAsync("Hello", (r) => { /* r.audioData is ArrayBuffer */ });
```

### Python

```python
import azure.cognitiveservices.speech as speechsdk

cfg = speechsdk.SpeechConfig(host="ws://localhost:5001")
cfg.speech_recognition_language = "en-IN"
recognizer = speechsdk.SpeechRecognizer(speech_config=cfg)
print(recognizer.recognize_once().text)
```

### C#

```csharp
var cfg = SpeechConfig.FromHost(new Uri("ws://localhost:5001"));
cfg.SpeechRecognitionLanguage = "en-IN";
using var recognizer = new SpeechRecognizer(cfg);
var result = await recognizer.RecognizeOnceAsync();
```

---

## Pattern 2 — STT REST (batch / short audio)

```bash
curl -X POST "http://localhost:5001/speech/recognition/conversation/cognitiveservices/v1?language=en-IN" \
  -H "Content-Type: audio/wav; codecs=audio/pcm; samplerate=16000" \
  -H "Accept: application/json" \
  --data-binary @sample.wav
```

Returns:
```json
{ "RecognitionStatus": "Success", "DisplayText": "Hello world.", "Offset": 100000, "Duration": 12000000 }
```

Audio constraints: WAV/PCM, 16 kHz mono, max 60 seconds per request. For longer audio use the streaming SDK.

---

## Pattern 3 — TTS REST (one-shot synthesis)

```bash
curl -X POST "http://localhost:5003/cognitiveservices/v1" \
  -H "Content-Type: application/ssml+xml" \
  -H "X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3" \
  -d '<speak version="1.0" xml:lang="en-IN">
        <voice name="en-IN-NeerjaNeural">Hello, your appointment is confirmed.</voice>
      </speak>' \
  --output reply.mp3
```

Output formats supported: `riff-*-pcm`, `audio-*-mp3`, `ogg-*-opus`, `webm-24khz-16bit-mono-opus`. See `samples/` folder for ready-to-run scripts.

### Voice list (`GET /cognitiveservices/voices/list`)
The TTS container exposes the standard voices-list endpoint, but only returns the voice baked into that image. Use it as a probe.

---

## Production wrapper recommendations

1. **Auth + rate limit** — front the containers with NGINX/APIM that validates a client API key, applies per-tenant rate limits, and forwards.
2. **TLS termination** — same gateway terminates HTTPS / WSS.
3. **Service discovery** — point clients at `https://stt.your-domain` and `https://tts.your-domain`; the gateway round-robins to STT/TTS replicas.
4. **Caching** — TTS responses are cacheable. Hash `(voice, ssml)` and serve repeat reminders/notifications from a Redis cache; only synthesize cache-misses.
5. **Telemetry** — gateway emits per-request latency, audio-seconds, and HTTP status to your APM. Container itself only logs to stderr.
