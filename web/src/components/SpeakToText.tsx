import { useEffect, useRef, useState } from "react";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { type SpeechLocale } from "../config";
import { useEndpoints } from "../hooks/useEndpoints";

export default function SpeakToText() {
  const { locales, profileId } = useEndpoints();
  const [locale, setLocale] = useState<SpeechLocale>(locales[0]);
  const [transcript, setTranscript] = useState("");
  const [partial, setPartial] = useState("");
  const [status, setStatus] = useState<"idle" | "live" | "err">("idle");
  const [error, setError] = useState<string | null>(null);
  const recognizerRef = useRef<SpeechSDK.SpeechRecognizer | null>(null);

  // Re-pick locale from current profile whenever profile changes
  useEffect(() => {
    const next = locales.find((l) => l.code === locale.code) ?? locales[0];
    setLocale(next);
  }, [profileId]);

  const start = async () => {
    setError(null);
    setTranscript("");
    setPartial("");
    try {
      const speechConfig = SpeechSDK.SpeechConfig.fromHost(new URL(locale.sttHost), "");
      speechConfig.speechRecognitionLanguage = locale.code;
      const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
      recognizer.recognizing = (_s, e) => setPartial(e.result.text);
      recognizer.recognized = (_s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text) {
          setTranscript((prev) => (prev ? prev + " " : "") + e.result.text);
          setPartial("");
        }
      };
      recognizer.canceled = (_s, e) => {
        setStatus("err");
        setError(`Canceled: ${e.errorDetails || e.reason}`);
      };
      recognizer.sessionStopped = () => setStatus("idle");
      recognizer.startContinuousRecognitionAsync();
      recognizerRef.current = recognizer;
      setStatus("live");
    } catch (e: any) {
      setStatus("err");
      setError(e?.message || String(e));
    }
  };

  const stop = () => {
    recognizerRef.current?.stopContinuousRecognitionAsync(
      () => { recognizerRef.current?.close(); recognizerRef.current = null; setStatus("idle"); },
      () => setStatus("idle")
    );
  };

  return (
    <>
      <h2>Speak → Text (live transcription)</h2>
      <div className="row">
        <label>Locale</label>
        <select value={locale.code} disabled={status === "live"} onChange={(e) => {
          const next = locales.find((l) => l.code === e.target.value);
          if (next) setLocale(next);
        }}>
          {locales.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <code>{locale.sttHost}</code>
        <span className={`status ${status}`}><span className="dot" />{status === "live" ? "Listening" : status === "err" ? "Error" : "Idle"}</span>
      </div>
      <div className="row">
        {status !== "live"
          ? <button className="primary" onClick={start}>🎙️ Start</button>
          : <button className="secondary" onClick={stop}>■ Stop</button>}
      </div>
      <div className={`transcript ${transcript || partial ? "" : "empty"}`}>
        {transcript || (partial ? "" : "Click Start, allow mic, then speak…")}
        {partial && <em style={{ opacity: 0.6 }}> {partial}</em>}
      </div>
      {error && <p style={{ color: "#be123c", fontSize: 13 }}>{error}</p>}
    </>
  );
}
