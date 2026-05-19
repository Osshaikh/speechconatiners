# speech-container — Azure AI Speech Disconnected Containers on AKS

A production-ready Helm chart for deploying **Azure AI Speech disconnected containers** (Speech-to-Text and Neural Text-to-Speech) on Azure Kubernetes Service.

Replaces the abandoned `microsoft/cognitive-services-speech-onpremise` chart (v0.3.3, June 2021) with parameterised CPU/memory, modern Kubernetes APIs, taint+toleration scheduling, and secret-based credentials.

- **Chart repo**: `https://osshaikh.github.io/speechconatiners/`
- **Source**: `https://github.com/Osshaikh/speechconatiners`
- **App version**: 5.3.0 (STT) / 4.6.0 (TTS)
- **Chart version**: 1.1.4

---

## Table of Contents

1. [Architecture overview](#architecture-overview)
2. [Capacity planning](#capacity-planning)
3. [Prerequisites](#prerequisites)
   - [Azure AI Speech resource](#1-azure-ai-speech-resource-billing-endpoint--api-key)
   - [Network whitelisting](#2-network--firewall-whitelisting)
   - [Taints & labels](#3-node-taints--labels-split-pool-pattern)
   - [Kubernetes secret](#4-kubernetes-secret-for-speech-credentials)
   - [Ingress controller](#5-ingress-controller)
3. [Installing the chart](#installing-the-chart)
4. [Configurable values reference](#configurable-values-reference)
5. [Install command examples](#install-command-examples)
6. [Adding additional language containers](#adding-additional-language-containers)
7. [Verifying the install](#verifying-the-install)
8. [Upgrading & rolling back](#upgrading--rolling-back)
9. [Uninstalling](#uninstalling)
10. [Troubleshooting](#troubleshooting)

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       AKS Cluster                                │
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐          │
│  │   syspool    │   │   sttpool    │   │   ttspool    │          │
│  │  (system)    │   │ taint=stt    │   │ taint=tts    │          │
│  │              │   │              │   │              │          │
│  │  CoreDNS     │   │  STT pod(s)  │   │  TTS pod(s)  │          │
│  │  Ingress     │   │  4c / 4Gi    │   │  6c / 12Gi   │          │
│  │  addons      │   │              │   │              │          │
│  └──────────────┘   └──────────────┘   └──────────────┘          │
│         │                  │                   │                  │
│         └──────────────────┴───────────────────┘                  │
│                            │                                      │
│                       Speech secret                               │
│                  (billing URL + API key)                          │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
                ┌────────────────────────────┐
                │ <name>.cognitiveservices   │
                │     .azure.com             │
                │   (billing / license)      │
                └────────────────────────────┘
```

**Why split pools?** STT is CPU-bound, TTS is memory-bound (neural voice models load ~10 GB). Putting each workload on its own SKU family avoids over-provisioning.

---

## Capacity planning

Use these throughput figures (validated by Microsoft Speech engineering, confirmed against in-field deployments) to size your cluster for a target call volume.

### Per-container resource requirements

Microsoft Learn — disconnected container host sizing per pod:

| Workload | **Minimum** | **Recommended** | Notes |
|---|---|---|---|
| **STT** (Speech-to-Text) | **4 cores / 4 GB** | **8 cores / 8 GB** | + 4–8 GB headroom for speech model load at startup |
| **Neural TTS** | **6 cores / 12 GB** | **8 cores / 16 GB** | Larger voice models = more RAM; synthesis bursts at 16 GB |

Chart 1.1.4 ships with **minimums** as the example request values; limits stay at the chart default `8c / 16Gi` so the container can burst to recommended sizing under load without rejection.

### Recommended node SKU families

| Pool | SKU | Why | Density (1.1.4 requests) |
|---|---|---|---|
| **System** (`syspool`) | D4ds_v5 (4c / 16 GB) | General purpose, runs CoreDNS, ingress, addons | n/a |
| **STT** (`sttpool`) | **F16s_v2** (16c / 32 GB) | Compute-optimized — STT is CPU-bound | 2 pods/node safe (req 4c each) |
| **TTS** (`ttspool`) | **E16s_v5** (16c / 128 GB) | Memory-optimized — neural voices need RAM | 2 pods/node safe (req 6c, 12Gi each) |

### Per-pod throughput

| Workload | Concurrency rule | 8-core pod | Pod throughput @ 30s/call |
|---|---|---|---|
| **STT** | **2 sessions per CPU core** | 8 × 2 = **16 concurrent sessions** | 16 × (3600/30) = **1,920 calls/hour** |
| **TTS** | **5 sessions per 8-core pod** | 5 concurrent sessions | 5 × (3600/30) = **600 calls/hour** |

> Assumes **average call duration of 30 seconds** (typical for IVR/voicebot turns). Adjust proportionally for your real traffic mix.

### Sizing for a target volume

Worked example — **100,000 calls/month**:

```
Average load     = 100,000 calls / 30 days / 24 hr ≈ 139 calls/hour
Peak load (3×)   ≈ 420 calls/hour during business-hour peaks
```

**STT pods needed:**
```
Peak calls / pod throughput = 420 / 1,920 ≈ 1 pod active at peak
Recommended: 2 pods minimum  (HA + headroom for traffic spikes)
```

**TTS pods needed:**
```
Peak calls / pod throughput = 420 / 600 ≈ 1 pod active at peak
Recommended: 2 pods minimum  (HA + headroom)
```

### Reference sizing table

| Monthly calls | Peak calls/hr (3×) | STT pods (req 4c/4Gi) | TTS pods (req 6c/12Gi) | Min sttpool | Min ttspool |
|---|---|---|---|---|---|
| 10 k    | ~42   | 1 (+ 1 HA) | 1 (+ 1 HA) | 1 × F16s_v2 | 1 × E16s_v5 |
| 100 k   | ~420  | 2          | 2          | 2 × F16s_v2 | 2 × E16s_v5 |
| 500 k   | ~2,100| 2          | 4          | 2 × F16s_v2 | 4 × E16s_v5 |
| 1 M     | ~4,200| 3          | 7          | 3 × F16s_v2 | 7 × E16s_v5 |
| 5 M     | ~21 k | 11         | 35         | 11 × F16s_v2| 35 × E16s_v5|

> Node count = pod count when using chart minimum requests (1 pod/node fit on F16s_v2/E16s_v5 with our 4c-STT / 6c-TTS requests — see [density math](#configurable-values-reference)).
> Increase peak multiplier (× factor) if your traffic profile is spikier (e.g., 5× for retail flash events, 10× for emergency campaigns).

### Tunable assumptions in this model

| Variable | Default | Where to change |
|---|---|---|
| Average call duration | 30 s | Multiply formula by `(your_avg_seconds / 30)` |
| STT concurrency/core | 2 sessions | `numberOfConcurrentRequest` env var (also `DECODER_MAX_COUNT`) |
| TTS concurrency/8-core pod | 5 sessions | `numberOfConcurrentRequest` env var |
| Peak-to-average ratio | 3× | Depends on traffic shape (BFSI ≈ 2×, retail ≈ 3–5×) |
| HA replicas | +1 baseline | Maintain at least 2 pods per workload always |

---

## Prerequisites

### 1. Azure AI Speech resource (billing endpoint + API key)

You need a regular Azure AI Speech resource that the disconnected container "checks back" to (only during initial license activation, then runs fully offline).

```bash
# Create resource group
az group create -n <rg> -l <region>

# Create Speech resource (S0 SKU minimum; disconnected commitment is purchased separately)
az cognitiveservices account create \
  --name <speech-resource-name> \
  --resource-group <rg> \
  --kind SpeechServices \
  --sku S0 \
  --location <region> \
  --yes

# Capture endpoint + key
ENDPOINT=$(az cognitiveservices account show \
  -n <speech-resource-name> -g <rg> --query properties.endpoint -o tsv)
KEY=$(az cognitiveservices account keys list \
  -n <speech-resource-name> -g <rg> --query key1 -o tsv)

echo "Endpoint: $ENDPOINT"
echo "Key:      $KEY"
```

Then purchase a **disconnected container commitment** via the Azure portal: Speech resource → Commitment Tiers → choose STT hours and/or TTS characters tier → enable **disconnected** mode.

> ⚠️ Self-service trial keys won't work for offline use — disconnected containers require an active commitment tier or EA approval.

### 2. Network / firewall whitelisting

Disconnected containers need network access only at specific moments. Egress rules:

| Endpoint | Port | Purpose | When required |
|---|---|---|---|
| `mcr.microsoft.com` | 443 | Container image registry | First pull only — cache after |
| `*.data.mcr.microsoft.com` | 443 | Image blob backing store | First pull only |
| `<resource>.cognitiveservices.azure.com` | 443 | License activation + periodic call-home | **Always** (every 7 days max) |
| AKS control plane (managed) | 443 | API server, leader election | Always (AKS-managed) |

**Minimum production firewall rules** = only `<resource>.cognitiveservices.azure.com:443` (after the image is cached locally or in an ACR).

**No inbound from the public internet is required** unless you expose ingress externally.

### 3. Node taints & labels (split-pool pattern)

The chart's example values files (chart 1.1.4+) expect these taints/labels:

| Nodepool | Taint | Label |
|---|---|---|
| `sttpool` | `workload=stt:NoSchedule` | `workload=stt` |
| `ttspool` | `workload=tts:NoSchedule` | `workload=tts` |

**How the chart uses them:**
- **Toleration** on each pod allows it to *land* on the tainted node
- **Soft node affinity** (`preferredDuringSchedulingIgnoredDuringExecution`, weight 100) makes the pod *prefer* the matching pool — but falls back to any untainted node if the preferred pool is down (avoids stuck `Pending`)

The hard rejection comes from the **taint** (gate). The soft affinity is a hint (compass).

If your nodepools use different taint values, override on install:
```bash
helm install ... --set-json 'tolerations=[{"key":"workload","operator":"Equal","value":"my-custom","effect":"NoSchedule"}]'
```

### 4. Kubernetes secret for Speech credentials

Create a Secret holding the billing URL + API key. The chart will mount these as env vars (not as plain CLI args, keeping the key out of `kubectl describe pod` output).

```bash
kubectl create namespace speech

kubectl create secret generic speech-credentials -n speech \
  --from-literal=billing="https://<resource>.cognitiveservices.azure.com/" \
  --from-literal=apikey="<your-key>"
```

Key names default to `billing` and `apikey`. If your secret uses different keys, override via:
```bash
--set secretRef.name=my-secret \
--set secretRef.billingKey=Billing \
--set secretRef.apiKeyKey=ApiKey
```

### 5. Ingress controller

The chart's example values enable an Ingress resource per release for hostname-based routing (e.g. `speech.example.com/stt/en-US`). Install `ingress-nginx` once per cluster before installing the speech chart:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer
```

After install, capture the external IP and point your DNS (or `/etc/hosts` for testing) at it:
```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

---

## Installing the chart

```bash
# 1. Add the Helm repo
helm repo add osshaikh https://osshaikh.github.io/speechconatiners/
helm repo update

# 2. List available versions
helm search repo osshaikh/speech-container --versions

# 3. Install (using a baked-in example)
helm install stt-en osshaikh/speech-container \
  -n speech \
  -f examples/stt-en.yaml \
  --set secretRef.enabled=true
```

To grab the example value files without cloning the repo:
```bash
helm pull osshaikh/speech-container --untar
ls speech-container/examples/   # stt-en.yaml, stt-hi.yaml, tts-en.yaml, tts-hi.yaml, prod-overrides.yaml
```

---

## Configurable values reference

All values configurable via `--set`, `--set-json`, or `-f values.yaml`.

### Image
| Key | Default | Notes |
|---|---|---|
| `image.repository` | *(set per mode in examples)* | `mcr.microsoft.com/azure-cognitive-services/speechservices/speech-to-text` or `…/neural-text-to-speech` |
| `image.tag` | `5.3.0-amd64-en-us` (STT) / `4.6.0-amd64-en-us-avaneural` (TTS) | Locale-specific image tag |
| `image.pullPolicy` | `IfNotPresent` | |
| `imagePullSecrets` | `[]` | If using a private ACR mirror |

### Container args + credentials
| Key | Default | Notes |
|---|---|---|
| `args.eula` | `accept` | Must be `accept` |
| `args.billing` | `""` | Inline billing URL (use `secretRef` in prod) |
| `args.apikey` | `""` | Inline API key (use `secretRef` in prod) |
| `secretRef.enabled` | `false` | Set to `true` to pull credentials from a Secret |
| `secretRef.name` | `speech-credentials` | Name of the Secret |
| `secretRef.billingKey` | `billing` | Key inside the Secret for billing URL |
| `secretRef.apiKeyKey` | `apikey` | Key inside the Secret for API key |

### Resources (the most important knobs)
| Key | Chart default | STT example | TTS example |
|---|---|---|---|
| `resources.requests.cpu` | `8` | **`4`** | **`6`** |
| `resources.requests.memory` | `8Gi` | **`4Gi`** | **`12Gi`** |
| `resources.limits.cpu` | `8` | inherited (8) | inherited (8) |
| `resources.limits.memory` | `16Gi` | inherited (16Gi) | inherited (16Gi) |

Concurrency cap (passed as `DECODER_MAX_COUNT` env var):
| Key | Chart default | STT example | TTS example |
|---|---|---|---|
| `concurrency.numberOfConcurrentRequest` | `5` | `4` | `6` |

### Scheduling
| Key | Default | Notes |
|---|---|---|
| `nodeSelector` | `{}` | Hard pin to a node (avoid in prod) |
| `tolerations` | `[]` | STT examples add `workload=stt:NoSchedule`; TTS adds `workload=tts:NoSchedule` |
| `affinity` | `{}` | STT/TTS examples add soft node affinity preferring `workload=stt`/`workload=tts` |
| ⚠️ **Gotcha** | | Arrays REPLACE — `--set tolerations=...` while also using `-f stt-en.yaml` wipes the example's tolerations. Specify the full list. |

### Service & Ingress
| Key | Default | Notes |
|---|---|---|
| `service.type` | `ClusterIP` | Use `LoadBalancer` to expose directly |
| `service.port` | `5000` | Speech container HTTP port |
| `service.targetPort` | `5000` | |
| `ingress.enabled` | `false` (chart) / `true` (examples) | Per-release Ingress |
| `ingress.className` | `nginx` | |
| `ingress.host` | *(unset)* | Set in examples to `speech.example.com` |
| `ingress.path` | *(unset)* | E.g. `/stt/en-US`, `/tts/hi-IN` |
| `ingress.tls.enabled` | `false` | Set `true` + `secretName` for TLS |

### Autoscaling (HPA)
| Key | Default | Notes |
|---|---|---|
| `autoscaling.enabled` | `true` | |
| `autoscaling.minReplicas` | `1` | |
| `autoscaling.maxReplicas` | `5` (chart) / `4` (examples) | |
| `autoscaling.targetCPUUtilizationPercentage` | `70` | |

### Misc
| Key | Default | Notes |
|---|---|---|
| `replicaCount` | `1` | Ignored if HPA enabled |
| `env.extra` | `[]` | Inject extra env vars |
| `podLabels` | `{}` | Additional pod labels |
| `podAnnotations` | `{}` | Additional pod annotations |

---

## Install command examples

### Example 1 — Quickstart STT (English)
```bash
helm install stt-en osshaikh/speech-container \
  -n speech --create-namespace \
  -f examples/stt-en.yaml \
  --set secretRef.enabled=true
```
**Result**: 4c/4Gi STT pod on `sttpool`, ingress at `speech.example.com/stt/en-US`.

### Example 2 — Quickstart TTS (Hindi)
```bash
helm install tts-hi osshaikh/speech-container \
  -n speech \
  -f examples/tts-hi.yaml \
  --set secretRef.enabled=true
```
**Result**: 6c/12Gi TTS pod on `ttspool`, ingress at `speech.example.com/tts/hi-IN`.

### Example 3 — Override resources at install time
```bash
helm install stt-en osshaikh/speech-container -n speech \
  -f examples/stt-en.yaml \
  --set secretRef.enabled=true \
  --set resources.requests.cpu=8 \
  --set resources.requests.memory=8Gi \
  --set concurrency.numberOfConcurrentRequest=8
```
**Use when**: you have spare CPU and want higher per-pod throughput.

### Example 4 — Custom secret name + keys
```bash
helm install stt-en osshaikh/speech-container -n speech \
  -f examples/stt-en.yaml \
  --set secretRef.enabled=true \
  --set secretRef.name=my-speech-secret \
  --set secretRef.billingKey=BillingUrl \
  --set secretRef.apiKeyKey=SubscriptionKey
```

### Example 5 — Single shared pool (collapse split-pool)
If you only have ONE speech nodepool labeled/tainted `workload=speech`:
```bash
helm install stt-en osshaikh/speech-container -n speech \
  -f examples/stt-en.yaml \
  -f examples/prod-overrides.yaml \
  --set secretRef.enabled=true
```
`prod-overrides.yaml` replaces the STT-specific toleration with `workload=speech` so STT and TTS share one pool.

### Example 6 — Custom toleration value (key=value form)
If your nodepool taint is `dedicated=speech-prod:NoSchedule`:
```bash
helm install stt-en osshaikh/speech-container -n speech \
  -f examples/stt-en.yaml \
  --set secretRef.enabled=true \
  --set tolerations[0].key=dedicated \
  --set tolerations[0].operator=Equal \
  --set tolerations[0].value=speech-prod \
  --set tolerations[0].effect=NoSchedule \
  --set affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].weight=100 \
  --set affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions[0].key=dedicated \
  --set affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions[0].operator=In \
  --set affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions[0].values[0]=speech-prod
```
> Helm arrays REPLACE — when using `--set toleration[0]…` together with `-f stt-en.yaml`, your `--set` values fully replace the example's toleration list.

### Example 7 — Disable HPA, fix replica count
```bash
helm install stt-en osshaikh/speech-container -n speech \
  -f examples/stt-en.yaml \
  --set secretRef.enabled=true \
  --set autoscaling.enabled=false \
  --set replicaCount=3
```

### Example 8 — Expose via LoadBalancer (skip ingress)
```bash
helm install stt-en osshaikh/speech-container -n speech \
  -f examples/stt-en.yaml \
  --set secretRef.enabled=true \
  --set service.type=LoadBalancer \
  --set ingress.enabled=false
```

### Example 9 — TLS-enabled ingress with cert-manager
```bash
helm install tts-en osshaikh/speech-container -n speech \
  -f examples/tts-en.yaml \
  --set secretRef.enabled=true \
  --set ingress.tls.enabled=true \
  --set ingress.tls.secretName=tts-tls \
  --set ingress.host=speech.example.com \
  --set 'ingress.annotations.cert-manager\.io/cluster-issuer=letsencrypt-prod'
```

### Example 10 — Install all 4 (STT en/hi + TTS en/hi)
```bash
for rel in stt-en stt-hi tts-en tts-hi; do
  helm install $rel osshaikh/speech-container -n speech \
    -f examples/$rel.yaml \
    --set secretRef.enabled=true
done
```

---

## Adding additional language containers

The chart is language-agnostic — to deploy any locale Microsoft publishes on MCR, override `image.repository` + `image.tag` at install time. You can reuse the STT or TTS example file for scheduling/resources and just swap the image.

### Image naming pattern

| Workload | Repository | Tag pattern |
|---|---|---|
| **STT** | `mcr.microsoft.com/azure-cognitive-services/speechservices/speech-to-text` | `<version>-amd64-<locale>` (e.g. `5.3.0-amd64-ta-in`) |
| **TTS** | `mcr.microsoft.com/azure-cognitive-services/speechservices/neural-text-to-speech` | `<version>-amd64-<locale>-<voice>neural` (e.g. `4.6.0-amd64-ta-in-pallavineural`) |

Locale codes follow BCP-47: `en-US`, `hi-IN`, `ta-IN`, `te-IN`, `mr-IN`, `bn-IN`, `gu-IN`, `kn-IN`, `ml-IN`, `pa-IN`, `ur-IN`, etc.

Browse all available tags: https://mcr.microsoft.com/en-us/catalog?search=speech

### Example 11 — Tamil STT
```bash
helm install stt-ta osshaikh/speech-container -n speech \
  -f examples/stt-en.yaml \
  --set secretRef.enabled=true \
  --set image.repository=mcr.microsoft.com/azure-cognitive-services/speechservices/speech-to-text \
  --set image.tag=5.3.0-amd64-ta-in \
  --set ingress.path=/stt/ta-IN
```
**Result**: Tamil STT pod on `sttpool`, ingress at `speech.example.com/stt/ta-IN`. Inherits STT toleration, affinity, and resource requests (4c/4Gi) from `examples/stt-en.yaml`.

### Example 12 — Tamil TTS (Pallavi neural voice)
```bash
helm install tts-ta osshaikh/speech-container -n speech \
  -f examples/tts-en.yaml \
  --set secretRef.enabled=true \
  --set image.repository=mcr.microsoft.com/azure-cognitive-services/speechservices/neural-text-to-speech \
  --set image.tag=4.6.0-amd64-ta-in-pallavineural \
  --set ingress.path=/tts/ta-IN
```
**Result**: Tamil TTS pod on `ttspool`, ingress at `speech.example.com/tts/ta-IN`. Inherits TTS toleration, affinity, and resource requests (6c/12Gi).

### Example 13 — Generic "add any language" pattern
Substitute `<LOCALE>`, `<VERSION>`, `<VOICE>`, `<RELEASE>`:
```bash
# STT - any language
helm install <RELEASE> osshaikh/speech-container -n speech \
  -f examples/stt-en.yaml \
  --set secretRef.enabled=true \
  --set image.tag=<VERSION>-amd64-<LOCALE> \
  --set ingress.path=/stt/<LOCALE>

# TTS - any neural voice
helm install <RELEASE> osshaikh/speech-container -n speech \
  -f examples/tts-en.yaml \
  --set secretRef.enabled=true \
  --set image.tag=<VERSION>-amd64-<LOCALE>-<VOICE>neural \
  --set ingress.path=/tts/<LOCALE>
```

### Example 14 — Bulk install many languages
```bash
# STT for English, Hindi, Tamil, Telugu, Marathi
declare -A STT_LANGS=(
  [en]="5.3.0-amd64-en-us"
  [hi]="5.3.0-amd64-hi-in"
  [ta]="5.3.0-amd64-ta-in"
  [te]="5.3.0-amd64-te-in"
  [mr]="5.3.0-amd64-mr-in"
)

for lang in "${!STT_LANGS[@]}"; do
  helm install stt-$lang osshaikh/speech-container -n speech \
    -f examples/stt-en.yaml \
    --set secretRef.enabled=true \
    --set image.tag=${STT_LANGS[$lang]} \
    --set ingress.path=/stt/$lang
done
```

> ⚠️ Verify each image tag exists on MCR before installing — `docker pull <repo>:<tag>` from a workstation with MCR access is the fastest way. Container won't start if the tag is invalid.

---

## Verifying the install

```bash
# 1. Check release status
helm list -n speech

# 2. Check pod placement and resources
kubectl get pods -n speech -o wide
kubectl describe pod -n speech -l app.kubernetes.io/instance=stt-en | grep -A 5 "Requests\|Limits"

# 3. Probe the container endpoint
kubectl port-forward -n speech svc/stt-en-speech-container 5001:5000 &
curl http://localhost:5001/ready    # → "OK"
curl http://localhost:5001/status   # → JSON status

# 4. Quick STT test (English)
curl -X POST "http://localhost:5001/speech/recognition/conversation/cognitiveservices/v1?language=en-US" \
  -H "Content-Type: audio/wav" \
  --data-binary "@sample.wav"
```

---

## Upgrading & rolling back

```bash
# Refresh repo
helm repo update osshaikh

# Upgrade (preserves existing values)
helm upgrade stt-en osshaikh/speech-container -n speech \
  -f examples/stt-en.yaml \
  --set secretRef.enabled=true

# Upgrade while keeping current values (only change tag)
helm upgrade stt-en osshaikh/speech-container -n speech \
  --reuse-values --set image.tag=5.4.0-amd64-en-us

# View history
helm history stt-en -n speech

# Rollback to previous revision
helm rollback stt-en 1 -n speech
```

---

## Uninstalling

```bash
helm uninstall stt-en stt-hi tts-en tts-hi -n speech
kubectl delete namespace speech     # optional cleanup
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Pod stuck `Pending` | Insufficient CPU on tainted pool | Scale pool: `az aks nodepool scale ... --node-count N`, or lower `resources.requests.cpu` |
| Pod `CrashLoopBackOff`, log `Eula must be accepted` | `args.eula` missing or not `accept` | Re-install with `--set args.eula=accept` |
| Pod `CrashLoopBackOff`, log `Billing endpoint…validation failed` | Wrong billing URL or expired key | Verify Secret content; rotate key in portal |
| Pod log `Container does not have a valid disconnected container license` | Disconnected commitment not active on Speech resource | Purchase commitment tier in Azure portal |
| Image pull fails `ImagePullBackOff` | Firewall blocks `mcr.microsoft.com` | Whitelist MCR endpoints (see [Network](#4-network--firewall-whitelisting)) |
| `helm install` errors `args.billing is required` | Forgot `--set secretRef.enabled=true` AND no inline billing | Either enable secretRef or pass `--set args.billing=...` |
| Pod runs but `/ready` returns 503 for ~60s | Speech model still loading from disk | Wait 60–90s; increase readiness probe `initialDelaySeconds` if needed |
| HPA stays at 1 replica under load | Metrics-server missing / wrong target | `kubectl top pods -n speech`; verify metrics-server installed |
| Multiple pods on same node despite split-pool | Soft affinity fell back because target pool full | Scale STT/TTS pool, or check for taint mismatch |

---

## Support & contributing

- Issues: https://github.com/Osshaikh/speechconatiners/issues
- Maintainer: Owais Shaikh (`osshaikh@microsoft.com`)
- License: MIT (chart) / Microsoft EULA (container images)
