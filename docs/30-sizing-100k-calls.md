# Sizing Guide — 100,000 Voice Calls / Month

Use the interactive [sizing calculator](../sizing/index.html) to plug in your own numbers. The defaults below assume an outbound IVR / appointment-reminder workload in India.

## Workload assumptions

| Parameter | Value | Why |
|---|---|---|
| Calls per month | 100,000 | Customer's stated target |
| Avg call duration | 90 seconds | Typical reminder / OTP confirmation |
| TTS share of audio | 80% (72 s/call) | Bot-spoken script dominates |
| STT share of audio | 20% (18 s/call) | Customer DTMF + occasional speech reply |
| Business hours | 12 h/day, 22 days/month | India work-week typical |
| Peak factor | 4× the daily-average | Morning rush + EOD reminder waves |
| Languages | en-IN, hi-IN | One container image per locale |

## Demand math

```
Avg concurrent calls during business hours
  = 100,000 calls × 90 s ÷ (22 d × 12 h × 3600 s)
  ≈ 9.5 calls

Peak concurrent calls
  = 9.5 × 4
  ≈ 38 calls
```

Audio minutes per month:
- TTS: 100,000 × 72 s = 2,000 hours/month
- STT: 100,000 × 18 s = 500 hours/month

## Container capacity

From MS-published per-container limits (recommended hardware):

| Container | RAM | CPU | Concurrency cap | Effective calls/container* |
|---|---|---|---|---|
| STT (one locale) | 12 GB | 8 cores | 16 sessions (2/core × 8) | **16** |
| Neural TTS (one voice) | 16 GB | 8 cores | 5 concurrent synth × 10× RTF | **~50** |

*STT holds the session for the full call; TTS only holds it during synthesis (~7–10 s per 90 s call → ~10% duty cycle).

So for **38 peak concurrent calls**:
- STT: ⌈38 ÷ 16⌉ = **3 containers per locale** → 6 STT containers total (en-IN + hi-IN)
- TTS: ⌈38 ÷ 50⌉ = **1 container per voice**, +1 for HA → 4 TTS containers total

## Recommended deployment (peak coverage + N+1 redundancy)

| Tier | Component | Replicas | Cores ea | RAM ea | Subtotal |
|---|---|---|---|---|---|
| Edge | API gateway / LB (NGINX) | 2 | 2 | 4 GB | 4 cores / 8 GB |
| STT | en-IN | 3 | 8 | 12 GB | 24 / 36 |
| STT | hi-IN | 3 | 8 | 12 GB | 24 / 36 |
| TTS | en-IN-Neerja | 2 | 8 | 16 GB | 16 / 32 |
| TTS | hi-IN-Swara | 2 | 8 | 16 GB | 16 / 32 |
| LangID | (optional, for Hinglish routing) | 1 | 2 | 2 GB | 2 / 2 |
| Cache | Redis (TTS response cache) | 1 | 2 | 4 GB | 2 / 4 |
| **Total** | | **14 containers** | | | **~88 cores / ~150 GB RAM** |

### Mapping to Azure VMs

| VM SKU | vCPU | RAM | Suits |
|---|---|---|---|
| `Standard_D8s_v5` | 8 | 32 GB | One STT or one TTS container per VM |
| `Standard_D16s_v5` | 16 | 64 GB | One STT + one TTS pair per VM |
| `Standard_D32s_v5` | 32 | 128 GB | 4× containers per VM (denser packing) |

A reasonable production layout: **3× D32s_v5 nodes in an AKS cluster** with the NGINX ingress on a separate Standard_D4s_v5. Cluster auto-scaler adds nodes if peak factor spikes above 4×.

## Software cost estimate (PAYG, retail)

| Item | Volume | Rate | Monthly |
|---|---|---|---|
| STT audio | 500 hours | $1.00 / hr (Standard) | **$500** |
| Neural TTS | ~12M characters (≈100 chars/s × 2,000 hr × 60 s ÷ 1,000 ÷ 1,000)* | $16.00 / 1M chars | **~$192** |
| **Software subtotal** | | | **~$692/mo** |

*Character estimate is rough — actual depends on script verbosity.

Add Azure VM costs (3× D32s_v5 in Central India ≈ ~$1.6k/mo each on PAYG, or ~$1k/mo each on 1-year reserved instances).

## Where this changes

- **If avg call goes from 90 s → 180 s** → STT containers double, TTS unchanged (still bound by request count).
- **If TTS share jumps to 95% (low-touch IVR)** → STT containers shrink, TTS unchanged.
- **If you add a third locale** → +1 STT image (~17 GB disk, +1–3 containers depending on traffic) and +1 TTS voice (~3 GB).
- **Disconnected mode** (offline) → containers are billed by **commitment tier** (block of audio hours / characters paid up-front), not per-use. Cheaper at this volume but requires gating-form approval.
- **GPU acceleration** → not currently supported by these images. CPU only.
