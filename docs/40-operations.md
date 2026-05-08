# Operations

## Health endpoints

| Endpoint | What it tells you |
|---|---|
| `GET /status` | Billing key valid? Container reachable? |
| `GET /ready` (TTS only) | Voice model loaded and warm |
| `GET /swagger` | Live OpenAPI spec for the container's endpoints |

## Logs

```powershell
docker compose -f containers\docker-compose.yml logs -f stt-en
docker compose -f containers\docker-compose.yml logs --tail=200 tts-en
```

Container logs go to stderr. To ship them to Log Analytics, run with `--log-driver=fluentd` or sidecar a Fluent Bit container. Logs include billing handshakes (every 10 min), per-request latency, and any model-loader errors.

## Metrics worth scraping

The containers don't expose Prometheus directly. Either:
1. Use the **API gateway in front** (NGINX `stub_status`, Envoy `/stats`) for request-rate and latency.
2. Use **cAdvisor + Prometheus + Grafana** for per-container CPU/RAM/network.
3. Mirror the same metrics that the Azure portal shows for cloud Speech: audio-seconds, character-count, error rate, latency p50/p95.

## Scaling

- **Horizontal**: spin up more replicas of the same container; round-robin from the gateway. Each container is stateless.
- **Vertical**: bump CPU first (concurrency scales linearly with cores up to recommended max). RAM beyond min adds nothing.
- **Auto-scale signals**: queue depth at the gateway, p95 latency on `/v1` endpoints, container CPU > 70% sustained for 5 min.

## Upgrades

```powershell
# Pull the new tag, change docker-compose.yml, restart
docker pull mcr.microsoft.com/azure-cognitive-services/speechservices/speech-to-text:5.3.0-amd64-en-in
# edit containers\docker-compose.yml: change "5.2.0" to "5.3.0"
docker compose -f containers\docker-compose.yml up -d stt-en   # rolling restart for that one
```

Pin to a specific version tag in production (never `:latest`); test in staging first. Microsoft publishes new STT images roughly every 3–4 months with model improvements.

## Cost control

- Cache deterministic TTS prompts (appointment confirmations, OTP messages) in Redis keyed by `(voice, ssml-hash)`. 70%+ hit rate is realistic for IVR.
- Use `riff-16khz-16bit-mono-pcm` instead of MP3 for lowest container CPU; transcode at the edge if your client needs MP3.
- For STT, send only the **caller's** audio (not the bot's TTS playback) — saves 80%+ of audio-hours.
- Audit billing weekly: `Invoke-RestMethod http://localhost:5001/billing` shows the local audio-hours that have been counted toward your Azure bill.

## Disaster recovery

- All four containers are stateless. Lose them all and you lose nothing — `up.ps1` recreates them in seconds.
- Models are baked into the image; no separate persistence layer.
- The only state that matters is the **API key + endpoint** in `.env`. Back that up to your secret store.

## Air-gapped / disconnected option

If your environment requires no outbound internet:
1. Get gating approval at `aka.ms/csgate`.
2. Purchase a commitment tier on the Speech resource (e.g., "Speech to text — 5,000 hours/month").
3. Download the license file: `docker run --rm -v $LIC:/licenseMount <image> eula=accept Billing=<endpoint> ApiKey=<key> DownloadLicense=True Mounts:License=/licenseMount`
4. Re-run with `Mounts:License` mounted and **no** internet egress required afterward.

This is the path for hospitals, banks, and other regulated workloads. See [the Microsoft Learn doc](https://learn.microsoft.com/azure/ai-services/speech-service/speech-container-howto-on-premises) for full steps.
