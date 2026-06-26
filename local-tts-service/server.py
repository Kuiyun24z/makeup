import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone

HOST = os.environ.get("LOCAL_TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("LOCAL_TTS_PORT", "9102"))
TTS_VOICE_NAME = os.environ.get("LOCAL_TTS_VOICE_NAME", "Microsoft Yaoyao")
TTS_RATE = int(os.environ.get("LOCAL_TTS_RATE", "0") or "0")
TTS_VOLUME = int(os.environ.get("LOCAL_TTS_VOLUME", "100") or "100")
MIN_AUDIO_BYTES = int(os.environ.get("LOCAL_TTS_MIN_AUDIO_BYTES", "1024") or "1024")
WINRT_TTS_EXE = os.environ.get(
  "LOCAL_TTS_WINRT_EXE",
  os.path.join(os.path.dirname(__file__), "winrt-tts", "bin", "Release", "net7.0-windows10.0.19041.0", "WinRtLocalTts.exe"),
)
POWERSHELL_EXE = os.environ.get(
  "LOCAL_TTS_POWERSHELL",
  r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
)

# Piper 本地神经音色（离线）。若模型文件存在则优先使用，失败时自动回退到 WinRT。
PIPER_PYTHON = os.environ.get("LOCAL_TTS_PIPER_PYTHON", sys.executable)
PIPER_MODEL = os.environ.get(
  "LOCAL_TTS_PIPER_MODEL",
  os.path.join(os.path.dirname(__file__), "piper", "zh_CN-huayan-medium.onnx"),
)
PIPER_VOICE_LABEL = os.environ.get("LOCAL_TTS_PIPER_LABEL", "Piper 华言 (本地神经音色)")


def piper_available():
  return bool(PIPER_MODEL) and os.path.exists(PIPER_MODEL)


_PIPER_VOICE = None
_PIPER_VOICE_LOCK = threading.Lock()


def get_piper_voice():
  global _PIPER_VOICE
  if _PIPER_VOICE is None:
    with _PIPER_VOICE_LOCK:
      if _PIPER_VOICE is None:
        from piper import PiperVoice
        _PIPER_VOICE = PiperVoice.load(PIPER_MODEL)
  return _PIPER_VOICE


def json_bytes(payload):
  return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def clean_text(value):
  text = str(value or "").strip()
  text = re.sub(r"\s+", " ", text)
  return text


class LocalTtsBridge:
  def __init__(self):
    self.lock = threading.Lock()
    self.last_error = ""
    self.last_voice = ""
    self.last_text_preview = ""
    self.last_text_length = 0
    self.last_text_codepoint_sample = []
    self.last_audio_bytes = 0
    self.last_request_at = ""

  def _run_powershell(self, script, timeout_seconds=40):
    completed = subprocess.run(
      [POWERSHELL_EXE, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      capture_output=True,
      text=True,
      encoding="utf-8",
      timeout=timeout_seconds,
      check=False,
    )
    if completed.returncode != 0:
      message = (completed.stderr or completed.stdout or "PowerShell TTS failed.").strip()
      raise RuntimeError(message)
    return completed.stdout.strip()

  def _record_request_text(self, text):
    content = str(text or "")
    self.last_request_at = datetime.now(timezone.utc).isoformat()
    self.last_text_preview = content[:80]
    self.last_text_length = len(content)
    self.last_text_codepoint_sample = [f"U+{ord(char):04X}" for char in content[:12]]

  def _record_audio_bytes(self, size):
    self.last_audio_bytes = int(size or 0)

  def diagnostics(self):
    return {
      "lastTextPreview": self.last_text_preview,
      "lastTextLength": self.last_text_length,
      "lastTextCodepointSample": self.last_text_codepoint_sample,
      "lastAudioBytes": self.last_audio_bytes,
      "lastRequestAt": self.last_request_at,
      "lastVoice": self.last_voice,
      "lastError": self.last_error,
      "minAudioBytes": MIN_AUDIO_BYTES,
    }

  def _list_voices(self):
    if os.path.exists(WINRT_TTS_EXE):
      try:
        completed = subprocess.run(
          [WINRT_TTS_EXE, "--list-voices"],
          capture_output=True,
          text=True,
          encoding="utf-8",
          timeout=20,
          check=False,
        )
        if completed.returncode == 0 and completed.stdout.strip():
          parsed = json.loads(completed.stdout.strip())
          voices = [str(item.get("displayName") or "").strip() for item in parsed if str(item.get("displayName") or "").strip()]
          if voices:
            return voices
      except Exception:
        pass

    script = """
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
$voices | ConvertTo-Json -Compress
"""
    output = self._run_powershell(script, timeout_seconds=15)
    if not output:
      return []
    voices = json.loads(output)
    if isinstance(voices, str):
      return [voices]
    if isinstance(voices, list):
      return [str(item) for item in voices]
    return []

  def _synthesize_with_piper(self, content):
    import wave
    voice = get_piper_voice()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as wav_file:
      wav_path = wav_file.name
    try:
      with self.lock:
        with wave.open(wav_path, "wb") as wav_handle:
          voice.synthesize_wav(content, wav_handle)
        with open(wav_path, "rb") as wav_handle:
          audio_bytes = wav_handle.read()
        self._record_audio_bytes(len(audio_bytes))
        if len(audio_bytes) <= MIN_AUDIO_BYTES:
          raise RuntimeError(f"tts-empty-audio: generated wav too small ({len(audio_bytes)} bytes)")
        self.last_voice = PIPER_VOICE_LABEL
        self.last_error = ""
      return {
        "audioBase64": base64.b64encode(audio_bytes).decode("ascii"),
        "mimeType": "audio/wav",
        "voiceName": PIPER_VOICE_LABEL,
        "sampleRate": 22050,
      }
    finally:
      try:
        os.remove(wav_path)
      except Exception:
        pass

  def synthesize(self, text):
    content = clean_text(text)
    if not content:
      raise RuntimeError("Missing text for local TTS.")
    self._record_request_text(content)

    if piper_available():
      try:
        return self._synthesize_with_piper(content)
      except Exception as error:
        # Piper 失败则记录并回退到 WinRT/PowerShell
        self.last_error = f"piper-failed: {error}"

    voices = self._list_voices()
    if not voices:
      raise RuntimeError("No installed local TTS voice was found.")

    target_voice = TTS_VOICE_NAME if TTS_VOICE_NAME in voices else voices[0]
    encoded_text = base64.b64encode(content.encode("utf-8")).decode("ascii")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as wav_file:
      wav_path = wav_file.name

    script = f"""
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice({json.dumps(target_voice)})
$synth.Rate = {TTS_RATE}
$synth.Volume = {TTS_VOLUME}
$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String({json.dumps(encoded_text)}))
$synth.SetOutputToWaveFile({json.dumps(str(wav_path))})
$synth.Speak($text)
$synth.Dispose()
"""

    try:
      with self.lock:
        if os.path.exists(WINRT_TTS_EXE):
          completed = subprocess.run(
            [WINRT_TTS_EXE, encoded_text, wav_path, target_voice],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
            check=False,
          )
          if completed.returncode != 0:
            message = (completed.stderr or completed.stdout or "WinRT TTS failed.").strip()
            raise RuntimeError(message)
          target_voice = (completed.stdout or target_voice).strip() or target_voice
        else:
          self._run_powershell(script, timeout_seconds=60)
        with open(wav_path, "rb") as wav_handle:
          audio_bytes = wav_handle.read()
        self._record_audio_bytes(len(audio_bytes))
        if len(audio_bytes) <= MIN_AUDIO_BYTES:
          self.last_error = f"tts-empty-audio: generated wav too small ({len(audio_bytes)} bytes)"
          raise RuntimeError(self.last_error)
        self.last_voice = target_voice
        self.last_error = ""
      return {
        "audioBase64": base64.b64encode(audio_bytes).decode("ascii"),
        "mimeType": "audio/wav",
        "voiceName": target_voice,
        "sampleRate": 16000,
      }
    finally:
      try:
        os.remove(wav_path)
      except Exception:
        pass

  def health(self):
    if piper_available():
      return {
        "ok": True,
        "service": "local-tts-service",
        "status": "ready",
        "detail": "Local Piper neural TTS is ready.",
        "voiceName": PIPER_VOICE_LABEL,
        "voices": [PIPER_VOICE_LABEL],
        **self.diagnostics(),
      }
    try:
      voices = self._list_voices()
      available = bool(voices)
      return {
        "ok": available,
        "service": "local-tts-service",
        "status": "ready" if available else "error",
        "detail": "Local Windows TTS is ready." if available else "No installed local TTS voice was found.",
        "voiceName": TTS_VOICE_NAME if TTS_VOICE_NAME in voices else (voices[0] if voices else ""),
        "voices": voices,
        **self.diagnostics(),
      }
    except Exception as error:
      self.last_error = str(error)
      return {
        "ok": False,
        "service": "local-tts-service",
        "status": "error",
        "detail": str(error),
        "voiceName": "",
        "voices": [],
        **self.diagnostics(),
      }


BRIDGE = LocalTtsBridge()


class LocalTtsHandler(BaseHTTPRequestHandler):
  server_version = "BeautyLocalTTS/0.2"

  def _send_json(self, status_code, payload):
    body = json_bytes(payload)
    self.send_response(status_code)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def _read_json_body(self):
    content_length = int(self.headers.get("Content-Length", "0") or "0")
    raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
    try:
      return json.loads(raw_body.decode("utf-8"))
    except Exception as error:
      raise ValueError(f"Invalid JSON: {error}") from error

  def do_GET(self):
    if self.path == "/health":
      health = BRIDGE.health()
      self._send_json(200 if health["ok"] else 503, health)
      return
    self._send_json(404, {"ok": False, "error": "Not found"})

  def do_POST(self):
    if self.path == "/speak":
      try:
        payload = self._read_json_body()
        result = BRIDGE.synthesize(payload.get("text") or "")
        self._send_json(200, {"ok": True, **result})
      except Exception as error:
        message = str(error)
        error_code = "tts-empty-audio" if message.startswith("tts-empty-audio:") else "tts-speak-failed"
        self._send_json(
          500,
          {
            "ok": False,
            "error": error_code,
            "detail": message,
            "diagnostics": BRIDGE.diagnostics(),
          },
        )
      return

    if self.path == "/stop":
      self._send_json(200, {"ok": True})
      return

    self._send_json(404, {"ok": False, "error": "Not found"})

  def log_message(self, format_string, *args):
    sys.stdout.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format_string % args))


def main():
  server = ThreadingHTTPServer((HOST, PORT), LocalTtsHandler)
  print(f"Local TTS service running at http://{HOST}:{PORT}", flush=True)
  server.serve_forever()


if __name__ == "__main__":
  main()
