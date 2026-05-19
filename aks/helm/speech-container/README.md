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
2. [Prerequisites](#prerequisites)
   - [Azure subscription & quotas](#1-azure-subscription--quotas)
   - [Azure AI Speech resource](#2-azure-ai-speech-resource-billing-endpoint--api-key)
   - [AKS cluster sizing](#3-aks-cluster--node-recommendations)
   - [Network whitelisting](#4-network--firewall-whitelisting)
   - [Taints & labels](#5-node-taints--labels-split-pool-pattern)
   - [Kubernetes secret](#6-kubernetes-secret-for-speech-credentials)
   - [Ingress controller](#7-optional-ingress-controller)
3. [Installing the chart](#installing-the-chart)
4. [Configurable values reference](#configurable-values-reference)
5. [Install command examples](#install-command-examples)
6. [Verifying the install](#verifying-the-install)
7. [Upgrading & rolling back](#upgrading--rolling-back)
8. [Uninstalling](#uninstalling)
9. [Troubleshooting](#troubleshooting)

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

## Prerequisites

### 1. Azure subscription & quotas

- An Azure subscription with **Owner** or **Contributor** + **User Access Administrator** at the resource group scope.
- Sufficient **regional vCPU quota**. Rule of thumb:

  | Pool | Recommended SKU | vCPUs per node | Min nodes |
  |---|---|---|---|
  | System | Standard_D4ds_v5 | 4 | 2 |
  | STT    | Standard_F16s_v2 or D16s_v6 | 16 | 2 |
  | TTS    | Standard_E16s_v5 or E16s_v6 | 16 | 2 |

  Minimum regional quota ≈ **72 vCPUs** for a 2-node-per-pool baseline. Check with:
  ```bash
  az vm list-usage --location <region> --query "[?contains(name.value,'cores')]" -o table
  ```

- **Azure AI Speech** resource quota: disconnected containers require a **Commitment Tier** purchase (or active disconnected container EA approval). Self-service trial keys won't work for offline use.

### 2. Azure AI Speech resource (billing endpoint + API key)

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

### 3. AKS cluster + node recommendations

**Per-container resource minimums** (Microsoft Learn):

| Workload | Min request | Recommended request | Memory needs |
|---|---|---|---|
| **STT** (Speech-to-Text) | 4 cores / 4 GB | 8 cores / 8 GB | + 4–8 GB for model load |
| **Neural TTS** | 6 cores / 12 GB | 8 cores / 16 GB | Larger voice models = more RAM |

**Recommended SKU families:**

| Pool | SKU | Why | Density (1.1.4 requests) |
|---|---|---|---|
| **System** (`syspool`) | D4ds_v5 (4c/16GB) | General purpose, runs CoreDNS, ingress, addons | n/a |
| **STT** (`sttpool`) | **F16s_v2** (16c/32GB) | Compute-optimized — STT is CPU-bound | 2 pods/node safe (req 4c each) |
| **TTS** (`ttspool`) | **E16s_v5** (16c/128GB) | Memory-optimized — neural voices need RAM | 2 pods/node safe (req 6c, 12Gi each) |

**Create cluster + pools:**

```bash
# 1. Create cluster with a small system pool
az aks create \
  --resource-group <rg> \
  --name <aks-name> \
  --node-count 2 \
  --node-vm-size Standard_D4ds_v5 \
  --nodepool-name syspool \
  --network-plugin azure \
  --generate-ssh-keys

# 2. Add STT pool with taint + label
az aks nodepool add \
  --cluster-name <aks-name> \
  --resource-group <rg> \
  --name sttpool \
  --node-vm-size Standard_F16s_v2 \
  --node-count 2 \
  --node-taints "workload=stt:NoSchedule" \
  --labels "workload=stt" \
  --mode User

# 3. Add TTS pool with taint + label
az aks nodepool add \
  --cluster-name <aks-name> \
  --resource-group <rg> \
  --name ttspool \
  --node-vm-size Standard_E16s_v5 \
  --node-count 2 \
  --node-taints "workload=tts:NoSchedule" \
  --labels "workload=tts" \
  --mode User

# 4. Wire up kubectl
az aks get-credentials -g <rg> -n <aks-name> --overwrite-existing
```

**Single shared pool alternative** (for cost-sensitive demos): use one `speechpool` with taint `workload=speech:NoSchedule` and apply `examples/prod-overrides.yaml` to collapse the split. See [Install command examples](#install-command-examples).

### 4. Network / firewall whitelisting

Disconnected containers need network access only at specific moments. Egress rules:

| Endpoint | Port | Purpose | When required |
|---|---|---|---|
| `mcr.microsoft.com` | 443 | Container image registry | First pull only — cache after |
| `*.data.mcr.microsoft.com` | 443 | Image blob backing store | First pull only |
| `<resource>.cognitiveservices.azure.com` | 443 | License activation + periodic call-home | **Always** (every 7 days max) |
| AKS control plane (managed) | 443 | API server, leader election | Always (AKS-managed) |

**Minimum production firewall rules** = only `<resource>.cognitiveservices.azure.com:443` (after the image is cached locally or in an ACR).

**No inbound from the public internet is required** unless you expose ingress externally.

### 5. Node taints & labels (split-pool pattern)

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

### 6. Kubernetes secret for Speech credentials

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

### 7. Optional: ingress controller

If you want hostname-based routing (e.g. `speech.example.com/stt/en-US`), install `ingress-nginx` once per cluster:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer
```

Otherwise the chart's `ClusterIP` service can be reached via `kubectl port-forward`.

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
| `ingress.host` | *(unset)* | Set in examples to `speech.bfl.internal` |
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
**Result**: 4c/4Gi STT pod on `sttpool`, ingress at `speech.bfl.internal/stt/en-US`.

### Example 2 — Quickstart TTS (Hindi)
```bash
helm install tts-hi osshaikh/speech-container \
  -n speech \
  -f examples/tts-hi.yaml \
  --set secretRef.enabled=true
```
**Result**: 6c/12Gi TTS pod on `ttspool`, ingress at `speech.bfl.internal/tts/hi-IN`.

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

### Example 6 — Custom toleration value
If your nodepool taint is `dedicated=speech-prod:NoSchedule`:
```bash
helm install stt-en osshaikh/speech-container -n speech \
  -f examples/stt-en.yaml \
  --set secretRef.enabled=true \
  --set-json 'tolerations=[{"key":"dedicated","operator":"Equal","value":"speech-prod","effect":"NoSchedule"}]' \
  --set-json 'affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution=[{"weight":100,"preference":{"matchExpressions":[{"key":"dedicated","operator":"In","values":["speech-prod"]}]}}]'
```

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
