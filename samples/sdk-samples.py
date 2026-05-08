"""
Python SDK samples against the local Azure Speech containers.

Install:
    pip install azure-cognitiveservices-speech

Run STT (mic):    python sdk-samples.py stt
Run TTS (file):   python sdk-samples.py tts
"""
import sys
import azure.cognitiveservices.speech as speechsdk

STT_HOST = "ws://localhost:5001"
TTS_HOST = "http://localhost:5003"

def stt():
    cfg = speechsdk.SpeechConfig(host=STT_HOST)
    cfg.speech_recognition_language = "en-IN"
    audio_cfg = speechsdk.audio.AudioConfig(use_default_microphone=True)
    recognizer = speechsdk.SpeechRecognizer(speech_config=cfg, audio_config=audio_cfg)
    print("Speak now (one utterance)...")
    result = recognizer.recognize_once_async().get()
    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        print("You said:", result.text)
    else:
        print("No speech recognized:", result.reason)

def tts():
    cfg = speechsdk.SpeechConfig(host=TTS_HOST)
    cfg.speech_synthesis_voice_name = "en-IN-NeerjaNeural"
    audio_cfg = speechsdk.audio.AudioOutputConfig(filename="hello.wav")
    synth = speechsdk.SpeechSynthesizer(speech_config=cfg, audio_config=audio_cfg)
    result = synth.speak_text_async("Hello from the container.").get()
    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        print("Wrote hello.wav")
    else:
        print("Synthesis failed:", result.reason, getattr(result, "error_details", ""))

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "stt"
    {"stt": stt, "tts": tts}[cmd]()
