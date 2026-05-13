# speech-container Helm chart

A custom Helm chart for Azure AI **Speech-to-Text** and **Neural Text-to-Speech**
disconnected containers — built to replace the abandoned upstream chart
`microsoft/cognitive-services-speech-onpremise` (v0.3.3, June 2021).

## Why this chart exists

The official chart has three blocking problems:

| Issue | Upstream chart | This chart |
|---|---|---|
| Memory request/limit | **Hardcoded** in `_image.tpl` (STT 4Gi/8Gi, TTS 2Gi/3Gi) | Fully parameterised via `resources.requests.memory` / `resources.limits.memory` |
| CPU | Computed via hidden formula (`numberOfConcurrentRequest × 1250m` for STT, `× 600m` for TTS) | Direct `resources.requests.cpu` / `resources.limits.cpu` |
| Defaults | STT 2.5c/4Gi, TTS 1.2c/2Gi — well below MS Learn minimums | STT 6c/8Gi req, 8c/12Gi lim; TTS 6c/12Gi req, 8c/16Gi lim (matches MS Learn recommended) |
| Last update | June 2021 | Maintained alongside this project |
| Single chart for both modes | No — separate sub-charts | Yes — `mode: stt \| tts` switch |
| HPA API version | autoscaling/v1 | autoscaling/v2 (with behavior policies) |

## MS Learn resource recommendations (the source of truth)

https://learn.microsoft.com/azure/ai-services/speech-service/speech-container-howto

| Container | Minimum | Recommended | + Speech model |
|---|---|---|---|
| Speech-to-Text | 4 core / 4 GB | **8 core / 8 GB** | + 4-8 GB |
| Neural Text-to-Speech | 6 core / 12 GB | **8 core / 16 GB** | n/a |

This chart's defaults match the recommended values.

## Quick start

### 1. Configure credentials
Copy `containers/.env.example` to `containers/.env` and fill in:
```
SPEECH_BILLING=https://<your-resource>.cognitiveservices.azure.com/
SPEECH_KEY=<your-cognitive-services-key>
```

### 2. Deploy all 4 releases (STT en/hi, TTS en/hi)
```powershell
cd aks/helm/speech-container
./install.ps1
```

### 3. Deploy a single release manually
```bash
helm upgrade --install speech-stt-en . \
  --namespace speech-stt-en --create-namespace \
  --values examples/stt-en.yaml \
  --set args.billing=https://<resource>.cognitiveservices.azure.com/ \
  --set args.apikey=<key>
```

### 4. Use a Kubernetes secret instead of inline credentials (recommended for prod)
```bash
kubectl create namespace speech-stt-en
kubectl create secret generic speech-credentials \
  --namespace speech-stt-en \
  --from-literal=billing=https://<resource>.cognitiveservices.azure.com/ \
  --from-literal=apikey=<key>

helm upgrade --install speech-stt-en . \
  --namespace speech-stt-en \
  --values examples/stt-en.yaml \
  --set secretRef.enabled=true
```

## Configuration reference

### Required values
| Key | Description |
|---|---|
| `mode` | `stt` or `tts` — auto-derives image repository |
| `image.tag` | MCR tag (see below for examples) |
| `args.billing` OR `secretRef.enabled=true` | Billing endpoint |
| `args.apikey` OR `secretRef.enabled=true` | Speech resource key |

### Image tag reference

**STT** (`mcr.microsoft.com/azure-cognitive-services/speechservices/speech-to-text`):
| Language | Tag |
|---|---|
| English (en-US) | `5.3.0-amd64-en-us` |
| Hindi | `5.3.0-amd64-hi-in` |
| Tamil | `5.3.0-amd64-ta-in` |
| Marathi | `5.3.0-amd64-mr-in` |
| Bengali | `5.3.0-amd64-bn-in` |
| (other Indian locales) | `5.3.0-amd64-<locale>` — see [MCR tags](https://mcr.microsoft.com/product/azure-cognitive-services/speechservices/speech-to-text/tags) |

**TTS** (`mcr.microsoft.com/azure-cognitive-services/speechservices/neural-text-to-speech`):
| Voice | Tag |
|---|---|
| en-US Ava | `3.0.0-amd64-en-us-avaneural` |
| en-US Jenny | `3.0.0-amd64-en-us-jennyneural` |
| en-IN Neerja | `3.0.0-amd64-en-in-neerjaneural` |
| hi-IN Swara (F) | `3.0.0-amd64-hi-in-swaraneural` |
| hi-IN Madhur (M) | `3.0.0-amd64-hi-in-madhurneural` |

> **Note**: As of 2026-05, Neural TTS containers ship for **only en-US, en-IN, and hi-IN locales**. Tamil/Telugu/Malayalam/Kannada/Marathi/Gujarati/Assamese/Punjabi/Odia/Bengali Neural TTS are cloud-only — not available as containers.

### Common overrides

| Key | Default | Notes |
|---|---|---|
| `resources.requests.cpu` | `"6"` | Cores |
| `resources.requests.memory` | `"8Gi"` | STT default; bump to `"12Gi"` for TTS |
| `resources.limits.cpu` | `"8"` | Cores |
| `resources.limits.memory` | `"12Gi"` | STT default; bump to `"16Gi"` for TTS |
| `concurrency.numberOfConcurrentRequest` | `5` | Sets `DECODER_MAX_COUNT` env var |
| `replicaCount` | `1` | Static replicas (ignored if HPA enabled) |
| `autoscaling.enabled` | `false` | Enable HPA v2 (CPU-based) |
| `autoscaling.minReplicas` | `1` | |
| `autoscaling.maxReplicas` | `5` | |
| `service.type` | `LoadBalancer` | Use `ClusterIP` for private/APIM-fronted |
| `service.annotations` | `{}` | Add `service.beta.kubernetes.io/azure-load-balancer-internal: "true"` for internal LB |
| `podDisruptionBudget.enabled` | `false` | Recommended for prod |

## File layout

```
speech-container/
├── Chart.yaml
├── values.yaml                     ← default values (commented)
├── README.md                       ← you are here
├── install.ps1                     ← installs all 4 releases
├── examples/
│   ├── stt-en.yaml
│   ├── stt-hi.yaml
│   ├── tts-en.yaml
│   └── tts-hi.yaml
└── templates/
    ├── _helpers.tpl
    ├── deployment.yaml
    ├── service.yaml
    ├── hpa.yaml
    ├── pdb.yaml
    ├── serviceaccount.yaml
    └── NOTES.txt
```

## Validation

```powershell
# Render templates without installing (sanity check)
helm template test . --values examples/stt-en.yaml --set args.billing=https://x.cognitiveservices.azure.com/ --set args.apikey=fake

# Lint the chart
helm lint .

# Dry-run install
helm install test . --dry-run --debug --values examples/stt-en.yaml --set args.billing=https://x.cognitiveservices.azure.com/ --set args.apikey=fake
```

## Migrating from the official chart

If you currently use `microsoft/cognitive-services-speech-onpremise`:

```bash
# Uninstall the old release
helm uninstall <old-release> -n <namespace>

# Install with this chart
helm upgrade --install <new-release> ./speech-container \
  --namespace <namespace> --create-namespace \
  --values examples/<mode>-<locale>.yaml \
  --set args.billing=... --set args.apikey=...
```

The Service name will change (it'll be `<release>-speech-container`). Update any client configs accordingly.
