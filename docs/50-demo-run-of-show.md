# Demo Run-of-Show

A 10-minute walkthrough you can give to a customer.

## 0. Before they arrive (1 min)
```powershell
.\scripts\up.ps1                      # containers should be live
cd web; npm run dev                   # http://localhost:5173 in browser
```
Open in two browser tabs:
- **Tab A**: `http://localhost:5173`  (the React app)
- **Tab B**: `sizing/index.html` (open as file:// — the calculator)

## 1. Set the stage (1 min)
"What you're about to see is **the same Azure Speech APIs you'd call in the cloud**, but the model is running in a Docker container on this laptop. Same SDK, same REST contract — just `localhost` instead of `<region>.cognitive.microsoft.com`."

Show `docker compose ps` — four containers, all `Up`.

## 2. Speak → Text (2 min)
- Open the **Speak → Text** tab.
- Pick `en-IN`. Click Start. Say *"Hello, my name is Osman, please confirm my appointment for tomorrow."*
- Watch live partials, then the final transcript appear.
- Switch locale to `hi-IN`. Say a Hindi sentence. Same code path, different container.

**Talking point**: "Latency is 100–200 ms because the audio never leaves this machine."

## 3. Text → Speak (2 min)
- Open **Text → Speak**. The default English script is loaded.
- Click Speak — Neerja's voice plays.
- Switch voice to `hi-IN-SwaraNeural`. Speak a Hindi reminder.
- Click "Download MP3" to show the bytes are sitting in your browser, ready to bake into a voice-blast pipeline.

**Talking point**: "These are the same neural voices you get from the cloud — Neerja and Swara. The image bakes in one voice each; you can pick from ~20 India voices total."

## 4. Voice loop (2 min)
- Open **Voice Loop**. Click Start conversation.
- Have a 3-turn back-and-forth in Hindi or English.
- Show the conversation log in the gray box.

**Talking point**: "Today the bot just echoes you back. Swap `replyTemplates` with a call to your LLM (Azure OpenAI, Claude, etc.) and you have a complete voice agent — STT-in, LLM-think, TTS-out, all running on infrastructure you control."

## 5. Sizing for production (2 min)
- Switch to **Tab B** (the calculator).
- Default values are 100k calls/mo. Show:
  - 38 peak concurrent
  - ~14 containers, ~88 cores, ~150 GB RAM
  - ~$700/mo PAYG software cost
- Bump "Calls per month" to 1,000,000 — watch every number scale.
- Bump "Peak factor" from 4 → 8 — watch container count grow.

**Talking point**: "This is the same math we use to plan AKS clusters. Numbers are derived from MS-published per-container concurrency limits."

## 6. Q&A backup material (1 min)
Common questions:
- *Disconnected vs connected*? → "Same images. Disconnected lets the container run with no internet, but requires gating-form approval and a commitment-tier purchase. Connected is GA and PAYG."
- *Hinglish*? → "Send to hi-IN STT — it handles embedded English well. Or run the LangID container as a router."
- *Custom voice*? → "Custom Neural Voice can be bundled into your own image — separate flow."
- *On-prem GPU*? → "CPU only today. Roadmap, not committed."

## Tear-down
```powershell
.\scripts\down.ps1
```
