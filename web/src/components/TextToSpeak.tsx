import { useEffect, useState } from "react";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { type SpeechLocale } from "../config";
import { useEndpoints } from "../hooks/useEndpoints";

const SAMPLES: Record<string, string> = {
  "en-IN": "Hello! Your appointment with Dr. Sharma has been confirmed for tomorrow at 11 AM. Please bring your previous prescriptions.",
  "hi-IN": "नमस्ते! कल सुबह ग्यारह बजे डॉक्टर शर्मा के साथ आपकी अपॉइंटमेंट कन्फर्म हो गई है। कृपया अपनी पुरानी पर्ची साथ लाएं।",
};

export default function TextToSpeak() {
  const { locales, profileId } = useEndpoints();
  const [locale, setLocale] = useState<SpeechLocale>(locales[0]);
  const [text, setText] = useState(SAMPLES["en-IN"]);
  const [status, setStatus] = useState<"idle" | "live" | "err">("idle");
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    const next = locales.find((l) => l.code === locale.code) ?? locales[0];
    setLocale(next);
  }, [profileId]);

  const speak = async () => {
    setError(null);
    setAudioUrl(null);
    setStatus("live");
    try {
      const config = SpeechSDK.SpeechConfig.fromHost(new URL(locale.ttsHost), "");
      config.speechSynthesisVoiceName = locale.voice;
      config.speechSynthesisOutputFormat = SpeechSDK.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
      const synth = new SpeechSDK.SpeechSynthesizer(config, null as any);
      synth.speakTextAsync(
        text,
        (result) => {
          if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            const blob = new Blob([result.audioData], { type: "audio/mpeg" });
            const url = URL.createObjectURL(blob);
            setAudioUrl(url);
            const audio = new Audio(url);
            audio.play();
            setStatus("idle");
          } else {
            setStatus("err");
            setError(result.errorDetails || `Result reason: ${result.reason}`);
          }
          synth.close();
        },
        (err) => { setStatus("err"); setError(String(err)); synth.close(); }
      );
    } catch (e: any) {
      setStatus("err");
      setError(e?.message || String(e));
    }
  };

  const onLocaleChange = (code: string) => {
    const next = locales.find((l) => l.code === code);
    if (next) {
      setLocale(next);
      setText(SAMPLES[next.code] || "");
    }
  };

  return (
    <>
      <h2>Text → Speak (Neural TTS)</h2>
      <div className="row">
        <label>Voice</label>
        <select value={locale.code} onChange={(e) => onLocaleChange(e.target.value)}>
          {locales.map((l) => <option key={l.code} value={l.code}>{l.voice}</option>)}
        </select>
        <code>{locale.ttsHost}</code>
        <span className={`status ${status}`}><span className="dot" />{status === "live" ? "Synthesizing" : status === "err" ? "Error" : "Idle"}</span>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter text to synthesize…" />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={speak} disabled={!text.trim() || status === "live"}>🔊 Speak</button>
        {audioUrl && <a className="secondary" href={audioUrl} download={`tts-${locale.code}.mp3`} style={{ textDecoration: "none" }}>⬇ Download MP3</a>}
      </div>
      {error && <p style={{ color: "#be123c", fontSize: 13 }}>{error}</p>}
    </>
  );
}
