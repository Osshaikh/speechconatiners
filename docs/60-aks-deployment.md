# 60 — AKS deployment runbook

> **Goal.** Reproduce the 4-container Speech demo (2× STT + 2× TTS) on Azure Kubernetes Service in any region. This is the same set you ran locally with `docker compose`, just hosted on AKS.

## 0. What you'll deploy

| # | Workload | Image | Purpose |
|---|----------|-------|---------|
| 1 | `stt-en` | `azure-cognitive-services/speechservices/speech-to-text:5.2.0-amd64-en-in` | English (India) speech-to-text |
| 2 | `stt-hi` | `azure-cognitive-services/speechservices/speech-to-text:5.2.0-amd64-hi-in` | Hindi (India) speech-to-text |
| 3 | `tts-en` | `azure-cognitive-services/speechservices/neural-text-to-speech:4.4.0-amd64-en-in-neerjaneural` | NeerjaNeural voice (en-IN) |
| 4 | `tts-hi` | `azure-cognitive-services/speechservices/neural-text-to-speech:4.4.0-amd64-hi-in-swaraneural` | SwaraNeural voice (hi-IN) |

Each container exposes port `5000` and is fronted by its own `LoadBalancer` Service in its own namespace. Per pod: **8 vCPU / 8 GiB request, 8 vCPU / 10 GiB limit** (memory must be >= 8 GiB for neural TTS — anything smaller hangs the synthesizer).

## 1. Prerequisites

- Azure CLI 2.55+ (`az login`, subscription set with `az account set --subscription <id>`)
- `kubectl` 1.27+
- Helm 3.14+ (`winget install Helm.Helm` on Windows, `brew install helm` on macOS)
- A Speech resource with key + endpoint (used for billing/metering — containers report usage back to it)
- **Quota** in the target region: at least **64 vCPU** of `Standard_DADSv5` family (we use 2× D32ads_v5 nodes for the speech pool)

## 2. Cluster

If you already have a cluster, skip to step 3.

```powershell
$RG  = "rg-speech-demo"
$LOC = "centralindia"
$CLU = "speech-aks"

az group create -n $RG -l $LOC
az aks create -g $RG -n $CLU `
  --kubernetes-version 1.33 `
  --node-count 1 --node-vm-size Standard_B2s `
  --enable-managed-identity --generate-ssh-keys
```

## 3. Speech node pool

Speech containers are CPU-heavy; isolate them on a dedicated pool.

```powershell
az aks nodepool add -g $RG --cluster-name $CLU `
  -n speechpool --node-count 2 --node-vm-size Standard_D32ads_v5 `
  --labels workload=speech --mode User
```

> Skip taints unless you also want to set tolerations on the pods. The official Helm chart does not expose `tolerations`, so if you taint the pool you'll have to patch the deployments after install.

## 4. Credentials

```powershell
az aks get-credentials -g $RG -n $CLU --overwrite-existing
helm repo add microsoft https://microsoft.github.io/charts/repo
helm repo update
```

Capture your Speech key + endpoint:

```powershell
$env:SPEECH_API_KEY  = "<your-key>"
$env:SPEECH_BILLING_ENDPOINT = "https://<your-resource>.cognitiveservices.azure.com/"
```

## 5. Deploy 4 releases

The chart is `microsoft/cognitive-services-speech-onpremise` (umbrella with `speechToText` and `textToSpeech` sub-charts). Each `helm install` produces **at most one** STT + one TTS pod, so to get 2 locales × 2 services you install the chart 4 times — once per release, in its own namespace, with the unwanted sub-chart disabled.

The provided `aks/helm/install.ps1` reads `containers/.env` and runs all 4 installs idempotently:

```powershell
cd aks/helm
.\install.ps1
```

This produces:

```
NAMESPACE       RELEASE   POD                       SERVICE          PORT
speech-stt-en   stt-en    speech-to-text-...        speech-to-text   80
speech-stt-hi   stt-hi    speech-to-text-...        speech-to-text   80
speech-tts-en   tts-en    text-to-speech-...        text-to-speech   80
speech-tts-hi   tts-hi    text-to-speech-...        text-to-speech   80
```

**Important — chart memory bug.** The chart hardcodes memory at `3 GiB` for TTS (it was written for the legacy non-neural image). Neural TTS needs 8 GiB or it hangs with `429 No free synthesizer`. Patch each TTS deployment after install:

```powershell
$patchTts = '{"spec":{"template":{"spec":{"containers":[{"name":"text-to-speech-container","resources":{"requests":{"cpu":"6","memory":"8Gi"},"limits":{"cpu":"8","memory":"10Gi"}}}]}}}}'
foreach ($ns in @('speech-tts-en','speech-tts-hi')) {
  kubectl patch deployment text-to-speech -n $ns --patch $patchTts
}
$patchStt = '{"spec":{"template":{"spec":{"containers":[{"name":"speech-to-text-container","resources":{"requests":{"cpu":"6","memory":"8Gi"},"limits":{"cpu":"8","memory":"10Gi"}}}]}}}}'
foreach ($ns in @('speech-stt-en','speech-stt-hi')) {
  kubectl patch deployment speech-to-text -n $ns --patch $patchStt
}
```

Wait for rollouts:

```powershell
foreach ($r in @(@{n='speech-to-text';ns='speech-stt-en'},@{n='speech-to-text';ns='speech-stt-hi'},
                @{n='text-to-speech';ns='speech-tts-en'},@{n='text-to-speech';ns='speech-tts-hi'})) {
  kubectl rollout status deployment/$($r.n) -n $($r.ns) --timeout=10m
}
```

First pull is slow (5–10 min, images are 5–10 GiB each). Subsequent restarts are fast.

## 6. Capture LoadBalancer IPs

```powershell
foreach ($ns in @('speech-stt-en','speech-stt-hi','speech-tts-en','speech-tts-hi')) {
  $ip = kubectl get svc -n $ns -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'
  Write-Host "$ns -> $ip"
}
```

## 7. Smoke test

```powershell
foreach ($ip in @('<stt-en-ip>','<stt-hi-ip>','<tts-en-ip>','<tts-hi-ip>')) {
  $s = Invoke-RestMethod -Uri "http://$ip/status" -TimeoutSec 10
  Write-Host "$ip -> $($s.apiStatus)"
}
```

All four must return `Valid`.

TTS round-trip:

```powershell
$h = @{ 'Ocp-Apim-Subscription-Key'=$env:SPEECH_API_KEY; 'Content-Type'='application/ssml+xml';
       'X-Microsoft-OutputFormat'='riff-24khz-16bit-mono-pcm' }
$ssml = '<speak version="1.0" xml:lang="en-IN"><voice name="en-IN-NeerjaNeural">Hello from AKS.</voice></speak>'
Invoke-WebRequest "http://<tts-en-ip>/cognitiveservices/v1" -Method Post -Headers $h -Body $ssml -OutFile out.wav
```

STT does **not** expose REST batch transcription. Use the Speech SDK over WebSocket — see `web/src/components/SpeakToText.tsx` for the Browser SDK call (`SpeechSDK.SpeechConfig.fromHost(new URL("ws://<stt-ip>"), "")`).

## 8. Point the React UI at AKS

The header has a **Speech endpoint** dropdown. Select **AKS (Central India)** and the same UI re-points to your cluster (no rebuild). Update the IPs in `web/src/config.ts` under the `aks.locales` block first.

## 9. Stop the cluster between sessions

A 2× D32ads_v5 cluster idles at ~$2,200/month. Stop it when not in use:

```powershell
az aks stop -g $RG -n $CLU
# resume:
az aks start -g $RG -n $CLU
```

The control plane is free; only the node VMs are billed.

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Pod stuck `Pending` | Node pool too small or wrong `nodeSelector` | `kubectl describe pod` → check `Events`. Add nodes or relax selector. |
| Pod restarts repeatedly with OOM | Memory < 8 GiB | Apply the patch in step 5. |
| TTS returns `429 No free synthesizer` | Memory < 8 GiB OR pod still loading neural model | Check resources, wait 60–90s after pod Ready. |
| STT returns `405 Method Not Allowed` | You're sending REST POST | STT containers are WebSocket-only. Use Speech SDK. |
| `apiStatus: Invalid` on `/status` | Container can't reach billing endpoint | Verify outbound DNS/HTTPS to `*.cognitiveservices.azure.com`. |
| LoadBalancer IP stuck `<pending>` | Subscription out of public IPs | `az network public-ip list --query "length(@)"` and request quota increase. |

## 11. Tear down

```powershell
foreach ($r in @(@{n='stt-en';ns='speech-stt-en'},@{n='stt-hi';ns='speech-stt-hi'},
                @{n='tts-en';ns='speech-tts-en'},@{n='tts-hi';ns='speech-tts-hi'})) {
  helm uninstall $r.n -n $r.ns
  kubectl delete ns $r.ns
}
az aks nodepool delete -g $RG --cluster-name $CLU -n speechpool
```
