# Running the Containers

## Pull the images (one-time)

```powershell
$reg = "mcr.microsoft.com/azure-cognitive-services/speechservices"

docker pull "$reg/speech-to-text:5.2.0-amd64-en-in"
docker pull "$reg/speech-to-text:5.2.0-amd64-hi-in"
docker pull "$reg/neural-text-to-speech:4.4.0-amd64-en-in-neerjaneural"
docker pull "$reg/neural-text-to-speech:4.4.0-amd64-hi-in-swaraneural"
```

Total disk: ~40 GB. Pulls can take 15–60 minutes on first run.

## Start everything

```powershell
.\scripts\up.ps1
```

This wraps `docker compose -f containers\docker-compose.yml up -d`, waits 25 seconds for the billing handshake, then runs `/status` smoke tests.

| Service | Image | Host port | Protocol(s) |
|---|---|---|---|
| `stt-en` | speech-to-text:5.2.0-amd64-en-in | 5001 | WebSocket + REST |
| `stt-hi` | speech-to-text:5.2.0-amd64-hi-in | 5002 | WebSocket + REST |
| `tts-en` | neural-text-to-speech:4.4.0-amd64-en-in-neerjaneural | 5003 | REST |
| `tts-hi` | neural-text-to-speech:4.4.0-amd64-hi-in-swaraneural | 5004 | REST |

## Verify

```powershell
.\scripts\smoke-status.ps1
```

A healthy container responds to `GET /status` with:
```json
{ "apiStatus": "Valid", "apiStatusMessage": "Api Key is valid." }
```

If you see `Invalid` → recheck `SPEECH_API_KEY` in `containers\.env` and that the resource is in `S0` tier.

## Stop / restart

```powershell
.\scripts\down.ps1                   # stop and remove containers
docker compose -f containers\docker-compose.yml restart stt-en   # restart one
docker compose -f containers\docker-compose.yml logs -f tts-en   # tail logs
```

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `EOF` on `docker pull` | Docker Desktop hub proxy flaky | Settings → Resources → Proxies → disable, or bypass `mcr.microsoft.com` |
| Container exits immediately | Bad billing endpoint or key | `docker compose logs <svc>` — look for `BillingHostname` errors |
| `/status` says `Invalid` | F0 (free) tier resource used | Upgrade resource SKU to S0 |
| Container OOM-killed | RAM cap too low | Raise `mem_limit` in compose, or run fewer services at once |
| Long cold start (60–120 s) | Model load on first request | Send a small warm-up request after `up.ps1` |
| TTS returns 401 | None — TTS containers don't auth client requests | If you see this, you're hitting cloud accidentally |
