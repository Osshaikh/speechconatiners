# Prerequisites

## 1. Azure subscription with a Speech resource

You need **one** Azure AI Services Speech resource (or a multi-service Cognitive Services resource) to provide a **billing endpoint** and **API key** that the containers send heartbeats to every 10 minutes.

Create one:

```bash
az cognitiveservices account create \
  --name <your-speech-name> \
  --resource-group <rg> \
  --kind SpeechServices \
  --sku S0 \
  --location centralindia \
  --yes
```

Then copy the endpoint and one of the keys:

```bash
az cognitiveservices account show --name <your-speech-name> --resource-group <rg> --query properties.endpoint -o tsv
az cognitiveservices account keys list --name <your-speech-name> --resource-group <rg> --query key1   -o tsv
```

Paste them into `containers\.env`:

```
SPEECH_BILLING_ENDPOINT=https://<region>.api.cognitive.microsoft.com/
SPEECH_API_KEY=<key-1>
```

> **Pricing tier S0 is required** for connected containers; F0 (free) is not supported. Connected containers are billed per the standard Speech price list — STT $1/audio-hour, Neural TTS $16/1M characters as of writing.

## 2. Docker Desktop (or Docker Engine + Compose v2)

- Windows: Docker Desktop ≥ 4.30
- Linux: Docker Engine ≥ 24 + `docker compose` plugin
- Allocate **at least 32 GB RAM and 8 vCPUs** to Docker (Settings → Resources). For smoke testing only, you can lower this and run two services at a time.

Verify:
```powershell
docker version
docker compose version
docker run --rm hello-world
```

If you sit behind a corporate proxy, configure Docker Desktop's proxy under Settings → Resources → Proxies and add `mcr.microsoft.com,*.data.mcr.microsoft.com` to the bypass list. Docker Desktop's bundled proxy on `http.docker.internal:3128` is known to intermittently EOF on MCR pulls.

## 3. Node.js 20+ and npm 10+

Required only for the frontend.
```powershell
node --version   # >= v20
npm --version    # >= 10
```

## 4. Hardware (per container, MS-published minimums)

| Container | Min CPU | Min RAM | Recommended | Image size |
|---|---|---|---|---|
| STT (one locale) | 4 cores | 4 GB + 4–8 GB model | 8 cores / 12 GB | ~16–18 GB |
| Neural TTS (one voice) | 6 cores | 12 GB | 8 cores / 16 GB | ~3 GB |
| Language Identification | 1 core | 1 GB | — | ~1 GB |

For the demo on a single workstation, plan for at least **16 cores and 32 GB RAM** total when all four containers are running.

## 5. Network egress

Containers must reach `*.cognitiveservices.azure.com` and `*.cognitive.microsoft.com` over **TCP 443** (HTTPS). They send a small JSON heartbeat every 10 minutes. If the heartbeat fails for >48 hours, the container starts refusing requests.

## 6. Image registry access

Pull from `mcr.microsoft.com/azure-cognitive-services/speechservices/*`. No authentication required; tags follow the lowercase pattern `<version>-<platform>-<locale>[-<voice>]`, e.g. `5.2.0-amd64-en-in`.
