import { useEffect, useRef, useState } from "react";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { type SpeechLocale } from "../config";
import { useEndpoints } from "../hooks/useEndpoints";

type Turn = { who: "user" | "bot"; text: string; at: string };

const replyTemplates: Record<string, (txt: string) => string> = {
  "en-IN": (t) => `I heard you say: ${t}. Is there anything else I can help you with?`,
  "hi-IN": (t) => `मैंने सुना: ${t}. क्या मैं आपकी और कोई मदद कर सकती हूँ?`,
};

export default function VoiceLoop() {
  const { locales, profileId } = useEndpoints();
  const [locale, setLocale] = useState<SpeechLocale>(locales[0]);
  const [status, setStatus] = useState<"idle" | "live" | "err">("idle");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<Turn[]>([]);
  const recognizerRef = useRef<SpeechSDK.SpeechRecognizer | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    const next = locales.find((l) => l.code === locale.code) ?? locales[0];
    setLocale(next);
  }, [profileId]);

  const speak = (text: string) =>
    new Promise<void>((resolve) => {
      const config = SpeechSDK.SpeechConfig.fromHost(new URL(locale.ttsHost), "");
      config.speechSynthesisVoiceName = locale.voice;
      config.speechSynthesisOutputFormat = SpeechSDK.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
      const synth = new SpeechSDK.SpeechSynthesizer(config, null as any);
      synth.speakTextAsync(text, (result) => {
        if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
          const audio = new Audio(URL.createObjectURL(new Blob([result.audioData], { type: "audio/mpeg" })));
          audio.onended = () => { synth.close(); resolve(); };
          audio.play();
        } else {
          synth.close();
          resolve();
        }
      }, () => { synth.close(); resolve(); });
    });

  const start = async () => {
    setError(null);
    setLog([]);
    activeRef.current = true;
    try {
      const speechConfig = SpeechSDK.SpeechConfig.fromHost(new URL(locale.sttHost), "");
      speechConfig.speechRecognitionLanguage = locale.code;
      const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

      recognizer.recognized = async (_s, e) => {
        const heard = e.result?.text?.trim();
        if (!heard || !activeRef.current) return;
        setLog((l) => [...l, { who: "user", text: heard, at: new Date().toLocaleTimeString() }]);
        recognizer.stopContinuousRecognitionAsync();
        const reply = (replyTemplates[locale.code] || replyTemplates["en-IN"])(heard);
        setLog((l) => [...l, { who: "bot", text: reply, at: new Date().toLocaleTimeString() }]);
        await speak(reply);
        if (activeRef.current) recognizer.startContinuousRecognitionAsync();
      };
      recognizer.canceled = (_s, e) => { setStatus("err"); setError(`Canceled: ${e.errorDetails || e.reason}`); };

      recognizerRef.current = recognizer;
      await recognizer.startContinuousRecognitionAsync();
      setStatus("live");
    } catch (e: any) {
      setStatus("err");
      setError(e?.message || String(e));
    }
  };

  const stop = () => {
    activeRef.current = false;
    const r = recognizerRef.current;
    recognizerRef.current = null;
    r?.stopContinuousRecognitionAsync(() => { r?.close(); setStatus("idle"); }, () => setStatus("idle"));
  };

  return (
    <>
      <h2>Voice Loop — STT → reply → TTS</h2>
      <div className="row">
        <label>Locale</label>
        <select value={locale.code} disabled={status === "live"} onChange={(e) => {
          const next = locales.find((l) => l.code === e.target.value);
          if (next) setLocale(next);
        }}>
          {locales.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <span className={`status ${status}`}><span className="dot" />{status === "live" ? "In conversation" : status === "err" ? "Error" : "Idle"}</span>
      </div>
      <div className="row">
        {status !== "live"
          ? <button className="primary" onClick={start}>🔁 Start conversation</button>
          : <button className="secondary" onClick={stop}>■ End</button>}
      </div>
      <p style={{ color: "#8a929a", fontSize: 13, marginTop: -4 }}>
        Speak a sentence, pause, listen for the bot's reply, then speak again. Replace <code>replyTemplates</code> with an LLM call to get smart responses.
      </p>
      <div className="log">
        {log.length === 0
          ? <em>Conversation will appear here…</em>
          : log.map((t, i) => (
              <div key={i} className={t.who === "user" ? "turn-user" : "turn-bot"}>
                [{t.at}] {t.who === "user" ? "👤 You" : "🤖 Bot"}: {t.text}
              </div>
            ))}
      </div>
      {error && <p style={{ color: "#be123c", fontSize: 13 }}>{error}</p>}
    </>
  );
}
