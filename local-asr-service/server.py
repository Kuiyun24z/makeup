import base64
import io
import json
import os
import sys
import tempfile
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

HOST = os.environ.get("LOCAL_ASR_HOST", "127.0.0.1")
PORT = int(os.environ.get("LOCAL_ASR_PORT", "9101"))
ASR_PROVIDER = os.environ.get("ASR_PROVIDER", "funasr-local").strip() or "funasr-local"
WHISPER_MODEL_SIZE = os.environ.get("LOCAL_ASR_MODEL_SIZE", "small")
WHISPER_DEVICE = os.environ.get("LOCAL_ASR_DEVICE", "auto")
WHISPER_COMPUTE_TYPE = os.environ.get("LOCAL_ASR_COMPUTE_TYPE", "int8")
WHISPER_LANGUAGE = os.environ.get("LOCAL_ASR_LANGUAGE", "zh")
FUNASR_MODEL = os.environ.get("FUNASR_MODEL", "paraformer-zh-streaming")
FUNASR_DEVICE = os.environ.get("FUNASR_DEVICE", "cpu")
LOCAL_ASR_PRELOAD = os.environ.get("LOCAL_ASR_PRELOAD", "off").strip().lower() == "on"
WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WHISPER_MODEL_ROOT = os.environ.get(
  "LOCAL_ASR_MODEL_ROOT", os.path.join(WORKSPACE_ROOT, "models", "faster-whisper")
)
PCM_SAMPLE_RATE = 16000
PCM_SAMPLE_WIDTH = 2
PCM_CHANNELS = 1
FUNASR_CHUNK_SIZE = [0, 10, 5]
FUNASR_ENCODER_CHUNK_LOOK_BACK = 4
FUNASR_DECODER_CHUNK_LOOK_BACK = 1


def json_bytes(payload):
  return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def now_ms():
  return int(time.time() * 1000)


def merge_incremental_text(existing_text, incoming_text):
  existing = str(existing_text or "").strip()
  incoming = str(incoming_text or "").strip()

  if not incoming:
    return existing
  if not existing:
    return incoming
  if incoming.startswith(existing):
    return incoming
  if existing.endswith(incoming):
    return existing
  if incoming in existing:
    return existing
  return f"{existing}{incoming}".strip()


class LocalAsrBridge:
  def __init__(self):
    self.lock = threading.Lock()
    self.provider = ASR_PROVIDER
    self.active_session = None
    self.last_error = ""
    self.last_text = ""
    self.last_latency_ms = 0
    self.whisper_model = None
    self.whisper_model_loaded = False
    self.whisper_model_error = ""
    self.funasr_model = None
    self.funasr_model_loaded = False
    self.funasr_model_error = ""
    self.preload_started = False

  def ensure_provider(self):
    return self.ensure_funasr() if self.provider == "funasr-local" else self.ensure_whisper()

  def ensure_whisper(self):
    if self.whisper_model_loaded:
      return self.whisper_model

    with self.lock:
      if self.whisper_model_loaded:
        return self.whisper_model

      from faster_whisper import WhisperModel

      model_name_or_path = WHISPER_MODEL_ROOT if os.path.exists(WHISPER_MODEL_ROOT) else WHISPER_MODEL_SIZE
      device = WHISPER_DEVICE
      if device == "auto":
        try:
          import torch
          device = "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
          device = "cpu"

      self.whisper_model = WhisperModel(
        model_name_or_path,
        device=device,
        compute_type=WHISPER_COMPUTE_TYPE,
      )
      self.whisper_model_loaded = True
      self.whisper_model_error = ""
      self.last_error = ""
      return self.whisper_model

  def ensure_funasr(self):
    if self.funasr_model_loaded:
      return self.funasr_model

    with self.lock:
      if self.funasr_model_loaded:
        return self.funasr_model

      from funasr import AutoModel

      self.funasr_model = AutoModel(
        model=FUNASR_MODEL,
        device=FUNASR_DEVICE,
        disable_update=True,
      )
      self.funasr_model_loaded = True
      self.funasr_model_error = ""
      self.last_error = ""
      return self.funasr_model

  def is_ready(self):
    try:
      self.ensure_provider()
      return True
    except Exception as error:
      self.last_error = str(error)
      return False

  def start_preload(self):
    if self.preload_started:
      return

    self.preload_started = True

    def _worker():
      try:
        self.ensure_provider()
      except Exception as error:
        self.last_error = str(error)

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()

  def decode_audio_to_pcm(self, audio_bytes):
    try:
      import av
    except Exception as error:
      raise RuntimeError(f"PyAV import failed: {error}") from error

    pcm_chunks = []
    try:
      with av.open(io.BytesIO(audio_bytes), mode="r") as container:
        resampler = av.audio.resampler.AudioResampler(
          format="s16",
          layout="mono",
          rate=PCM_SAMPLE_RATE,
        )
        for frame in container.decode(audio=0):
          resampled = resampler.resample(frame)
          if not resampled:
            continue
          frames = resampled if isinstance(resampled, list) else [resampled]
          for audio_frame in frames:
            pcm_chunks.append(audio_frame.to_ndarray().tobytes())
    except Exception as error:
      raise RuntimeError(f"Failed to decode audio chunk: {error}") from error

    pcm_bytes = b"".join(pcm_chunks)
    if not pcm_bytes:
      raise RuntimeError("Decoded audio chunk is empty.")
    return pcm_bytes

  def pcm_bytes_to_float32(self, pcm_bytes):
    audio_int16 = np.frombuffer(pcm_bytes, dtype=np.int16)
    if audio_int16.size == 0:
      return np.zeros((0,), dtype=np.float32)
    return audio_int16.astype(np.float32) / 32768.0

  def transcribe_whisper_pcm(self, pcm_bytes, lang):
    started_at = now_ms()
    model = self.ensure_whisper()

    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as handle:
      temp_path = handle.name

    with wave.open(temp_path, "wb") as wav_file:
      wav_file.setnchannels(PCM_CHANNELS)
      wav_file.setsampwidth(PCM_SAMPLE_WIDTH)
      wav_file.setframerate(PCM_SAMPLE_RATE)
      wav_file.writeframes(pcm_bytes)

    try:
      segments, info = model.transcribe(
        temp_path,
        language=(lang or WHISPER_LANGUAGE or "zh"),
        vad_filter=True,
        beam_size=1,
        best_of=1,
        condition_on_previous_text=False,
      )
      text = "".join(segment.text for segment in segments).strip()
      latency_ms = now_ms() - started_at
      self.last_text = text
      self.last_latency_ms = latency_ms
      return {
        "text": text,
        "durationMs": latency_ms,
        "language": getattr(info, "language", lang or WHISPER_LANGUAGE or "zh"),
        "languageProbability": getattr(info, "language_probability", 0),
      }
    finally:
      try:
        os.remove(temp_path)
      except OSError:
        pass

  def transcribe_funasr_stream(self, session, is_final=False):
    model = self.ensure_funasr()
    pending_pcm_bytes = bytes(session.get("pendingPcmBytes") or b"")
    if not pending_pcm_bytes:
      return {
        "text": str(session.get("lastFinalText") or session.get("lastPartialText") or "").strip(),
        "durationMs": 0,
        "language": "zh",
        "languageProbability": 1,
      }

    waveform = self.pcm_bytes_to_float32(pending_pcm_bytes)
    if waveform.size == 0:
      return {
        "text": str(session.get("lastFinalText") or session.get("lastPartialText") or "").strip(),
        "durationMs": 0,
        "language": "zh",
        "languageProbability": 1,
      }

    started_at = now_ms()
    cache = session.setdefault("funasrCache", {})
    result = model.generate(
      input=waveform,
      cache=cache,
      is_final=is_final,
      chunk_size=FUNASR_CHUNK_SIZE,
      encoder_chunk_look_back=FUNASR_ENCODER_CHUNK_LOOK_BACK,
      decoder_chunk_look_back=FUNASR_DECODER_CHUNK_LOOK_BACK,
    )
    item = result[0] if isinstance(result, list) and result else {}
    incoming_text = str(item.get("text") or "").strip()
    text = merge_incremental_text(session.get("lastPartialText"), incoming_text)
    session["pendingPcmBytes"] = bytearray()
    session["processedChunkCount"] = int(session.get("processedChunkCount") or 0) + 1
    session["processedPcmBytes"] = int(session.get("processedPcmBytes") or 0) + len(pending_pcm_bytes)
    latency_ms = now_ms() - started_at
    session["lastPartialText"] = text
    if is_final:
      session["lastFinalText"] = text
    self.last_text = text
    self.last_latency_ms = latency_ms
    return {
      "text": text,
      "durationMs": latency_ms,
      "language": "zh",
      "languageProbability": 1,
    }

  def start_capture(self, request_id, lang="zh"):
    if not self.is_ready():
      raise RuntimeError(self.last_error or "Local ASR provider is not ready yet.")
    with self.lock:
      self.active_session = {
        "requestId": request_id,
        "startedAt": now_ms(),
        "state": "capturing",
        "lang": str(lang or "zh"),
        "pcmBytes": bytearray(),
        "pendingPcmBytes": bytearray(),
        "chunkCount": 0,
        "processedChunkCount": 0,
        "processedPcmBytes": 0,
        "lastPartialText": "",
        "lastFinalText": "",
        "funasrCache": {},
      }
      return dict(self.active_session)

  def append_chunk(self, request_id, audio_base64, mime_type="", lang="zh"):
    if not self.is_ready():
      raise RuntimeError(self.last_error or "Local ASR provider is not ready yet.")

    with self.lock:
      session = self.active_session
      if not session or session.get("state") != "capturing":
        raise RuntimeError("No active local ASR capture session.")
      if request_id and session.get("requestId") != request_id:
        raise RuntimeError("Active local ASR session does not match requestId.")

    if not audio_base64:
      raise RuntimeError("Missing audio payload.")

    audio_bytes = base64.b64decode(audio_base64)
    normalized_mime_type = str(mime_type or "").lower()
    if normalized_mime_type.startswith("audio/pcm"):
      pcm_bytes = audio_bytes
    else:
      pcm_bytes = self.decode_audio_to_pcm(audio_bytes)

    with self.lock:
      session = self.active_session
      if not session or session.get("state") != "capturing":
        raise RuntimeError("Local ASR session ended before chunk append.")
      session["pcmBytes"].extend(pcm_bytes)
      session["pendingPcmBytes"].extend(pcm_bytes)
      session["chunkCount"] = int(session.get("chunkCount") or 0) + 1
      session["lang"] = str(lang or session.get("lang") or "zh")
      return {
        "ok": True,
        "provider": self.provider,
        "mode": "chunk-session",
        "engine": "funasr" if self.provider == "funasr-local" else "faster-whisper",
        "requestId": request_id,
        "chunkCount": session["chunkCount"],
        "pcmBytes": len(session["pcmBytes"]),
        "pendingPcmBytes": len(session["pendingPcmBytes"]),
        "mimeType": mime_type or "audio/webm",
      }

  def transcribe_partial(self, request_id, lang="zh"):
    with self.lock:
      session = self.active_session
      if not session or session.get("state") not in {"capturing", "transcribing"}:
        raise RuntimeError("No active local ASR capture session.")
      if request_id and session.get("requestId") != request_id:
        raise RuntimeError("Active local ASR session does not match requestId.")

      if self.provider == "funasr-local":
        result = self.transcribe_funasr_stream(session, is_final=False)
      else:
        result = self.transcribe_whisper_pcm(bytes(session.get("pcmBytes") or b""), lang or session.get("lang"))

      return {
        "ok": True,
        "provider": self.provider,
        "mode": "streaming-session" if self.provider == "funasr-local" else "chunk-session",
        "engine": "funasr" if self.provider == "funasr-local" else "faster-whisper",
        "requestId": request_id,
        "text": result["text"],
        "isFinal": False,
        "latencyMs": result["durationMs"],
        "language": result["language"],
        "languageProbability": result["languageProbability"],
      }

  def stop_and_transcribe(self, request_id, lang="zh"):
    with self.lock:
      session = self.active_session
      if not session or session.get("state") != "capturing":
        raise RuntimeError("No active local ASR capture session.")
      if request_id and session.get("requestId") != request_id:
        raise RuntimeError("Active local ASR session does not match requestId.")
      session["state"] = "transcribing"

    try:
      if self.provider == "funasr-local":
        result = self.transcribe_funasr_stream(session, is_final=True)
      else:
        result = self.transcribe_whisper_pcm(bytes(session.get("pcmBytes") or b""), lang or session.get("lang"))
    finally:
      with self.lock:
        self.active_session = None

    return {
      "ok": True,
      "provider": self.provider,
      "mode": "streaming-session" if self.provider == "funasr-local" else "chunk-session",
      "engine": "funasr" if self.provider == "funasr-local" else "faster-whisper",
      "requestId": request_id,
      "text": result["text"],
      "latencyMs": result["durationMs"],
      "language": result["language"],
      "languageProbability": result["languageProbability"],
    }

  def cancel(self):
    with self.lock:
      session = self.active_session
      self.active_session = None
    return {"ok": True, "cancelled": bool(session)}

  def get_health(self):
    ready = self.funasr_model_loaded if self.provider == "funasr-local" else self.whisper_model_loaded
    warming = self.preload_started and not ready
    status = "ready" if ready else ("warming" if warming else "standby")
    detail = (
      "Local streaming ASR service is running."
      if ready
      else "Local streaming ASR model is warming up."
      if warming
      else "Local streaming ASR service is online. Model will load on first request."
    )
    return {
      "ok": True,
      "service": "local-asr-service",
      "provider": self.provider,
      "mode": "streaming-session" if self.provider == "funasr-local" else "chunk-session",
      "engine": "funasr" if self.provider == "funasr-local" else "faster-whisper",
      "status": status,
      "detail": detail,
      "funasrModel": FUNASR_MODEL,
      "funasrDevice": FUNASR_DEVICE,
      "whisperModel": WHISPER_MODEL_ROOT if os.path.exists(WHISPER_MODEL_ROOT) else WHISPER_MODEL_SIZE,
      "active": bool(self.active_session),
      "warming": warming,
      "lastText": self.last_text,
      "lastLatencyMs": self.last_latency_ms,
      "lastError": self.last_error or self.funasr_model_error or self.whisper_model_error,
    }

  def request_prewarm(self):
    self.start_preload()
    return {
      "ok": True,
      "provider": self.provider,
      "status": "warming" if not self.funasr_model_loaded and not self.whisper_model_loaded else "ready",
    }


BRIDGE = LocalAsrBridge()


class LocalAsrHandler(BaseHTTPRequestHandler):
  server_version = "BeautyLocalASR/0.6"

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
      health = BRIDGE.get_health()
      self._send_json(200 if health["ok"] else 503, health)
      return
    self._send_json(404, {"ok": False, "error": "Not found"})

  def do_POST(self):
    if self.path == "/session/start":
      try:
        payload = self._read_json_body()
        request_id = str(payload.get("requestId") or f"asr-{now_ms()}")
        lang = str(payload.get("lang") or "zh")
        session = BRIDGE.start_capture(request_id, lang=lang)
        self._send_json(
          200,
          {
            "ok": True,
            "provider": BRIDGE.provider,
            "mode": "streaming-session" if BRIDGE.provider == "funasr-local" else "chunk-session",
            "engine": "funasr" if BRIDGE.provider == "funasr-local" else "faster-whisper",
            "requestId": request_id,
            "state": session.get("state"),
            "startedAt": session.get("startedAt"),
          },
        )
      except Exception as error:
        self._send_json(500, {"ok": False, "error": str(error), "provider": BRIDGE.provider})
      return

    if self.path == "/session/chunk":
      try:
        payload = self._read_json_body()
        result = BRIDGE.append_chunk(
          str(payload.get("requestId") or "").strip(),
          str(payload.get("audioBase64") or ""),
          mime_type=str(payload.get("mimeType") or "audio/webm"),
          lang=str(payload.get("lang") or "zh"),
        )
        self._send_json(200, result)
      except Exception as error:
        self._send_json(500, {"ok": False, "error": str(error), "provider": BRIDGE.provider})
      return

    if self.path == "/session/partial":
      try:
        payload = self._read_json_body()
        result = BRIDGE.transcribe_partial(
          str(payload.get("requestId") or "").strip(),
          lang=str(payload.get("lang") or "zh"),
        )
        self._send_json(200, result)
      except Exception as error:
        self._send_json(500, {"ok": False, "error": str(error), "provider": BRIDGE.provider})
      return

    if self.path == "/session/stop":
      try:
        payload = self._read_json_body()
        result = BRIDGE.stop_and_transcribe(
          str(payload.get("requestId") or "").strip(),
          lang=str(payload.get("lang") or "zh"),
        )
        self._send_json(200, result)
      except Exception as error:
        self._send_json(500, {"ok": False, "error": str(error), "provider": BRIDGE.provider})
      return

    if self.path == "/session/cancel":
      try:
        result = BRIDGE.cancel()
        self._send_json(200, {"ok": True, "provider": BRIDGE.provider, **result})
      except Exception as error:
        self._send_json(500, {"ok": False, "error": str(error), "provider": BRIDGE.provider})
      return

    if self.path == "/session/prewarm":
      try:
        result = BRIDGE.request_prewarm()
        self._send_json(200, result)
      except Exception as error:
        self._send_json(500, {"ok": False, "error": str(error), "provider": BRIDGE.provider})
      return

    self._send_json(404, {"ok": False, "error": "Not found"})

  def log_message(self, format_string, *args):
    sys.stdout.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format_string % args))


def main():
  if LOCAL_ASR_PRELOAD:
    BRIDGE.start_preload()
  server = ThreadingHTTPServer((HOST, PORT), LocalAsrHandler)
  print(f"Local ASR service running at http://{HOST}:{PORT}", flush=True)
  server.serve_forever()


if __name__ == "__main__":
  main()
