# speech-container Helm repo

This branch hosts the packaged `speech-container` Helm chart, served via GitHub Pages.

## Usage

```bash
helm repo add osshaikh https://osshaikh.github.io/speechconatiners
helm repo update
helm install speech-stt-en osshaikh/speech-container --version 1.0.0 -f my-values.yaml
```

Source for this chart lives on the `main` branch under `aks/helm/speech-container/`.

This branch is auto-published by `.github/workflows/release-chart.yaml` on every push to `main` that touches the chart.
