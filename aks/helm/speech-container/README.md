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
| Defaults | STT 2.5c/4Gi, TTS 1.2c/2Gi — well below MS Learn minimums | Unified 8c/8Gi req → 8c/16Gi lim (matches MS Learn recommended for both modes) |
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
| `resources.requests.cpu` | `"8"` | Cores (unified default for STT and TTS) |
| `resources.requests.memory` | `"8Gi"` | Base memory request |
| `resources.limits.cpu` | `"8"` | Cores |
| `resources.limits.memory` | `"16Gi"` | Burstable to 16Gi (covers TTS synthesis + STT model load) |
| `concurrency.numberOfConcurrentRequest` | `5` | Sets `DECODER_MAX_COUNT` env var |
| `replicaCount` | `1` | Static replicas (ignored if HPA enabled) |
| `autoscaling.enabled` | `true` | Enable HPA v2 (CPU-based, 70% target) |
| `autoscaling.minReplicas` | `1` | |
| `autoscaling.maxReplicas` | `5` | |
| `service.type` | `ClusterIP` | Switch to `LoadBalancer` only if NOT using Ingress |
| `service.annotations` | `{}` | Add `service.beta.kubernetes.io/azure-load-balancer-internal: "true"` for internal LB |
| `ingress.enabled` | `false` | Enable shared NGINX Ingress (see Ingress section below) |
| `ingress.host` | `speech.bfl.internal` | Shared hostname across all 4 releases |
| `ingress.path` | `""` (REQUIRED if enabled) | Per-release prefix, e.g. `/stt/en-US` |
| `podDisruptionBudget.enabled` | `false` | Recommended for prod |

## Pod scheduling — split-pool by default (STT and TTS on separate nodepools)

The bundled examples now bake in the **split-pool pattern** as the default
recommendation. Each example pins its release to its own dedicated nodepool:

| Example file | Toleration / affinity target |
|---|---|
| `stt-en.yaml`, `stt-hi.yaml` | `workload=stt` |
| `tts-en.yaml`, `tts-hi.yaml` | `workload=tts` |

### Required cluster prep (one-time)

```bash
# STT nodepool — compute-optimized SKU recommended
az aks nodepool add --cluster-name <cluster> --resource-group <rg> \
  --name sttpool \
  --node-vm-size Standard_F16s_v2 \
  --node-count 2 \
  --node-taints workload=stt:NoSchedule \
  --labels workload=stt

# TTS nodepool — memory-optimized SKU recommended
az aks nodepool add --cluster-name <cluster> --resource-group <rg> \
  --name ttspool \
  --node-vm-size Standard_E16s_v5 \
  --node-count 2 \
  --node-taints workload=tts:NoSchedule \
  --labels workload=tts
```

### Why this combination

| Mechanism | Role |
|---|---|
| Taint on node (`workload=stt:NoSchedule` / `workload=tts:NoSchedule`) | Repels everything except matching pod kind |
| Toleration on pod | Lets the pod *land* on its target pool |
| Soft `preferredDuringScheduling` nodeAffinity | *Prefers* the matching pool (weight 100), falls back to any untainted node if that pool is unhealthy — no "stuck Pending" |

Hard `nodeSelector` is intentionally NOT used: it pins pods so tightly that a
cordoned/drained/down pool leaves them Pending forever.

### Want a single shared pool instead? (simpler topology)

Layer `prod-overrides.yaml` on top — it REPLACES the per-example tolerations
with a single shared `workload=speech` target:

```bash
helm install stt-en osshaikh/speech-container \
  -f stt-en.yaml \
  -f prod-overrides.yaml          # collapses to 1-pool design
```

## Resource tuning (override defaults at install / upgrade)

Defaults (8c/8Gi req, 8c/16Gi lim) are a unified safety net for both STT and
TTS. You can override any subset of `resources.*` at install or upgrade time
without modifying the chart. Helm value precedence (later wins):

```
chart values.yaml  →  -f file1.yaml  →  -f file2.yaml  →  --set flags
   (defaults)         (examples)        (env overrides)    (CLI)
```

**Pattern A — quick CLI override:**

```bash
helm upgrade --install tts-en osshaikh/speech-container \
  -f tts-en.yaml \
  --set resources.requests.cpu=12 \
  --set resources.requests.memory=12Gi \
  --set resources.limits.cpu=16 \
  --set resources.limits.memory=24Gi
```

**Pattern B — environment overrides file (recommended for production):**

Create `prod-overrides.yaml`:
```yaml
resources:
  requests: { cpu: "12", memory: "12Gi" }
  limits:   { cpu: "16", memory: "24Gi" }
```

Apply alongside the per-release values file:
```bash
helm upgrade --install tts-en osshaikh/speech-container \
  -f tts-en.yaml \
  -f prod-overrides.yaml          # later -f wins
```

Same `prod-overrides.yaml` can be reused across all 4 releases.

**Pattern C — patch one field on a running release:**

```bash
helm upgrade tts-en osshaikh/speech-container \
  --reuse-values \
  --set resources.limits.memory=24Gi
```
`--reuse-values` keeps every other value from the previous install and only
patches the field you specify. Triggers a rolling pod restart.

## Ingress (shared hostname for all 4 containers)

When `ingress.enabled=true`, each release publishes one Ingress rule on a shared
host. NGINX Ingress Controller automatically merges rules from different Ingress
objects that share the same `host`, so the 4 releases end up as one virtual site:

```
wss://speech.bfl.internal/stt/en-US/speech/recognition/...   -> svc/stt-en
wss://speech.bfl.internal/stt/hi-IN/speech/recognition/...   -> svc/stt-hi
http://speech.bfl.internal/tts/en-US/cognitiveservices/v1    -> svc/tts-en
http://speech.bfl.internal/tts/hi-IN/cognitiveservices/v1    -> svc/tts-hi
```

The path prefix (e.g. `/stt/en-US`) is **stripped before forwarding** so the
container sees its native URLs unchanged. Configured via NGINX `rewrite-target`
with a regex path.

### Prerequisites
1. NGINX Ingress Controller installed in the cluster:
   ```powershell
   helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
   helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace
   ```
2. DNS: point `speech.bfl.internal` (or your chosen host) at the ingress LB IP:
   ```powershell
   kubectl -n ingress-nginx get svc ingress-nginx-controller
   ```

### Built-in WebSocket / TTS tuning
The chart sets these annotations on every Ingress automatically:
- `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"` — long STT streams
- `nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"`
- `nginx.ingress.kubernetes.io/proxy-body-size: "10m"` — TTS SSML payloads
- `nginx.ingress.kubernetes.io/use-regex: "true"` — required by the rewrite rule

NGINX detects the `Upgrade: websocket` header automatically — no extra annotation needed.

### TLS
Disabled by default. To enable, provide a pre-existing TLS secret:
```yaml
ingress:
  enabled: true
  tls:
    enabled: true
    secretName: speech-bfl-tls   # must contain tls.crt and tls.key
```

### Switching back to per-release LoadBalancer
Set `ingress.enabled=false` and `service.type=LoadBalancer` per release. Useful
during demos or parallel cutover.

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
