# Azure Speech Containers — Local + AKS Demo

End-to-end reference implementation for **Azure AI Speech disconnected containers** (Speech-to-Text + Neural Text-to-Speech) covering:

- Running the 4 containers locally with **Docker Compose**
- Deploying the same 4 containers to **Azure Kubernetes Service (AKS)** using the official Microsoft Helm chart
- A **React + Vite** browser UI with a **Local ↔ AKS toggle** demonstrating real STT/TTS round-trips
- Capacity / sizing model for **100,000 voice calls per month**
- Production hardening guidance (internal LB, APIM, private networking, NetworkPolicy, HPA)

> ⚠ **Demo project** — public IPs, no auth, no TLS. See `docs/61-aks-production-hardening.md` for production posture.

---

## What's in this repo

```
.
├── containers/             # docker-compose.yml + .env.example for local run
├── aks/helm/               # Helm values + installer for AKS deployment (official MS chart)
├── web/                    # React + Vite UI (Speech SDK in browser)
├── samples/                # PowerShell + Bash + Python REST/SDK samples
├── scripts/                # up.ps1 / down.ps1 / smoke-status.ps1 for local stack
├── sizing/                 # 100k calls/month capacity calculator (HTML)
└── docs/                   # numbered docs — read in order
```

---

## Quick start (local)

```powershell
# 1. Copy the secret template and fill in your Speech key + endpoint
cp containers\.env.example containers\.env
notepad containers\.env

# 2. Bring up 4 containers (STT en/hi + TTS en/hi)
.\scripts\up.ps1

# 3. Verify all 4 /status endpoints return apiStatus: Valid
.\scripts\smoke-status.ps1

# 4. Run the browser UI
cd web
npm install
npm run dev
# → http://localhost:5173
```

---

## Prerequisites

### 1. Azure subscription + Speech resource

| Item | Why | Notes |
|---|---|---|
| Active Azure subscription | Billing endpoint for containers | Owner/Contributor on subscription |
| **Azure AI Speech resource** (S0 tier) | Provides the `Key` + `Endpoint` containers send metering to | Must be created in your home tenant |
| **Disconnected container commitment plan** | Required for `EULA=accept` to work | 1, 3, 6, or 12-month commitment via Azure portal — **not enabled by default** |
| Speech resource region | Used for billing endpoint FQDN | Containers must reach `<region>.cognitiveservices.azure.com` |

### 2. Local machine (for Docker Compose run)

| Resource | Minimum | Recommended |
|---|---|---|
| OS | Win 10/11, macOS 12+, Ubuntu 20.04+ | Win 11 / Ubuntu 22.04 |
| **Docker Desktop / Engine** | 24.x | Latest |
| CPU | 8 vCPU | **16 vCPU** (4 containers × ~3 cores) |
| **RAM** | 16 GiB | **32 GiB** (4 containers × ~7 GiB) |
| Disk | 30 GB free | 60 GB (image + model layers) |
| Internet egress | 443 to MCR + Cognitive Services | Required for first pull + ongoing billing |

### 3. AKS deployment prerequisites

| Item | Value used in this demo |
|---|---|
| **AKS cluster** | `iitbombay-aks` in `centralindia` |
| Node pool | 2 × `Standard_D32ads_v5` (32 vCPU / 128 GiB each = 64 vCPU total) |
| Kubernetes version | 1.29+ |
| Add-ons | Container Insights (recommended) |
| Identity | Managed identity, `AcrPull` if mirroring images to ACR |
| Helm | 3.12+ (`helm version`) |
| kubectl | matching cluster minor version |
| Azure CLI | `az --version` ≥ 2.55 |
| Regional vCPU quota | **64 vCPU minimum** for `DSv5` family in chosen region |

### 4. Per-container resource requirements (production-safe)

> The Microsoft Helm chart **hardcodes TTS memory at 2 GiB request / 3 GiB limit** which causes silent `429 No free synthesizer` failures with neural voices. We patch all 4 deployments after `helm install` to MS Learn's recommended sizing:

| Container | CPU req | CPU limit | Mem req | Mem limit | Concurrent / pod |
|---|---|---|---|---|---|
| **STT (en-IN, hi-IN)** | 6 vCPU | 8 vCPU | 8 GiB | 10 GiB | 4–5 |
| **TTS Neural (en-IN, hi-IN)** | 6 vCPU | 8 vCPU | 8 GiB | 10 GiB | 4–5 (turbo) |

### 5. Network prerequisites — egress allow-list

**Required for cluster operation** (Azure Firewall AKS FQDN tag covers most of these):

| Endpoint | Port | Purpose |
|---|---|---|
| `*.hcp.<region>.azmk8s.io` | 443 / 9000 | AKS control plane / tunnel |
| `mcr.microsoft.com`, `*.data.mcr.microsoft.com` | 443 | Container image pulls |
| `login.microsoftonline.com` | 443 | Entra / managed identity |
| `packages.microsoft.com`, `acs-mirror.azureedge.net` | 443 | Node OS + kubelet binaries |
| `security.ubuntu.com`, `azure.archive.ubuntu.com` | 80 | Node OS patches |
| `dc.services.visualstudio.com`, `*.ods.opinsights.azure.com` | 443 | Container Insights |

**Required specifically for Speech containers:**

| Endpoint | Port | Why |
|---|---|---|
| **`<region>.cognitiveservices.azure.com`** | 443 | **Mandatory billing/metering** — container will not start or shuts down if unreachable |
| `mcr.microsoft.com/azure-cognitive-services/...` | 443 | Speech container images (or your ACR mirror) |
| `<acrname>.azurecr.io` | 443 | If mirroring images privately (recommended) |

**NSG service tags equivalent** (cleaner than per-FQDN rules):

```
Allow TCP 443 → AzureCloud.<region>
Allow TCP 443 → CognitiveServicesManagement
Allow TCP 443 → MicrosoftContainerRegistry
Allow TCP 443 → AzureActiveDirectory
Allow UDP 53  → 168.63.129.16 (Azure DNS)
```

> ⚠ **Disconnected mode caveat**: Containers must phone home periodically to validate the commitment plan. They are **not** fully airgapped indefinitely — the disconnected SKU buys you longer offline windows (the commitment period), not forever.

### 6. VNet / subnet sizing (production)

| Subnet | Size | Purpose |
|---|---|---|
| AKS node pool | `/22` | Azure CNI gives each pod an IP |
| Internal LB | `/27` | Speech service exposure |
| App Gateway (optional) | `/24` | If using AGIC for TLS + auth |
| Private endpoints | `/27` | For Key Vault, ACR access |
| API server (private cluster) | `/28` | If API server VNet integration enabled |

---

## Architecture

```
┌────────────────┐    ┌─────────────────────────────────────────────┐
│ React UI       │───▶│ Local profile  → http://localhost:5001-5004 │
│ (toggle)       │    │ AKS profile    → http://<public-LB-IPs>:80  │
└────────────────┘    └─────────────────────────────────────────────┘
                                         │
                                         ▼
                          ┌──────────────────────────────┐
                          │ STT en-IN  │ STT hi-IN       │
                          │ TTS en-IN  │ TTS hi-IN       │
                          └──────────────────────────────┘
                                         │
                                         ▼
                          ┌──────────────────────────────┐
                          │ Billing: <region>.cognitive  │
                          │ services.azure.com (443)     │
                          └──────────────────────────────┘
```

---

## Documentation index

| Doc | Topic |
|---|---|
| [`docs/00-prerequisites.md`](docs/00-prerequisites.md) | Detailed prerequisite walkthrough |
| [`docs/10-running-containers.md`](docs/10-running-containers.md) | Local Docker Compose run |
| [`docs/20-client-integration.md`](docs/20-client-integration.md) | REST / SDK call patterns |
| [`docs/30-sizing-100k-calls.md`](docs/30-sizing-100k-calls.md) | Capacity model for 100k voice calls/month |
| [`docs/40-operations.md`](docs/40-operations.md) | Logs, restarts, smoke tests |
| [`docs/50-demo-run-of-show.md`](docs/50-demo-run-of-show.md) | Live demo script |
| [`docs/60-aks-deployment.md`](docs/60-aks-deployment.md) | **AKS runbook** with the memory-patch fix |
| [`docs/61-aks-production-hardening.md`](docs/61-aks-production-hardening.md) | Internal LB, APIM, private networking, HPA |

---

## Capacity for 100,000 calls/month

Assuming 3-min average call, 30% peak concurrency factor → ~70 concurrent calls at peak.

| Service | Pods (turbo, 5 concurrent each) | Pods (standard, 3 each) |
|---|---|---|
| STT | 14–18 | 24–35 |
| TTS Neural | 14–18 | 24–35 |

**Recommended node pool**: 8 × `Standard_D32ads_v5` per service (16 nodes total) with HPA on CPU @ 70%. See `sizing/index.html` for the interactive calculator.

---

## Security / secrets

- `containers/.env` is **gitignored** — never commit your Speech key.
- Public LB IPs in `web/src/config.ts` under the `aks` profile are demo-only and should be replaced with internal LB IPs / APIM endpoints in production.
- Rotate the Speech key after running this demo.

---

## License

This project is provided as-is for demonstration and reference. Azure AI Speech containers are subject to the [Microsoft Cognitive Services container EULA](https://go.microsoft.com/fwlink/?linkid=2018657).
