import { useState } from "react";
import SpeakToText from "./components/SpeakToText";
import TextToSpeak from "./components/TextToSpeak";
import VoiceLoop from "./components/VoiceLoop";
import EndpointToggle from "./components/EndpointToggle";

type Tab = "stt" | "tts" | "loop";

export default function App() {
  const [tab, setTab] = useState<Tab>("stt");

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-row">
          <div>
            <h1>Azure Speech Containers — Demo</h1>
            <p className="app__sub">
              STT &amp; Neural TTS running in containers (Docker locally or AKS).
              Locales: <code>en-IN</code>, <code>hi-IN</code>.
            </p>
          </div>
          <EndpointToggle />
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === "stt" ? "active" : ""} onClick={() => setTab("stt")}>🎙️ Speak → Text</button>
        <button className={tab === "tts" ? "active" : ""} onClick={() => setTab("tts")}>🔊 Text → Speak</button>
        <button className={tab === "loop" ? "active" : ""} onClick={() => setTab("loop")}>🔁 Voice Loop</button>
      </nav>

      <main className="panel">
        {tab === "stt" && <SpeakToText />}
        {tab === "tts" && <TextToSpeak />}
        {tab === "loop" && <VoiceLoop />}
      </main>

      <footer className="app__foot">
        Containers expected on ports 5001/5002 (STT) and 5003/5004 (TTS). Mic access requires <code>http://localhost</code>.
      </footer>
    </div>
  );
}
