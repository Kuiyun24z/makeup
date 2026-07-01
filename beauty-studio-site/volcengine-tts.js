const DEFAULT_TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const DEFAULT_TTS_RESOURCE_ID = "seed-tts-2.0";
const DEFAULT_TTS_ENCODING = "mp3";
const DEFAULT_TTS_SAMPLE_RATE = 24000;
const DEFAULT_TTS_VOICE_TYPE = "zh_female_vv_uranus_bigtts";

function normalizeText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isVolcengineTtsEnabled(env = process.env) {
  const provider = normalizeText(env.TTS_PROVIDER || env.VOICE_TTS_PROVIDER).toLowerCase();
  const explicit = normalizeText(env.VOLC_TTS_ENABLED || env.VOLCENGINE_TTS_ENABLED).toLowerCase();
  return provider === "volcengine" || explicit === "on" || explicit === "true" || explicit === "1";
}

function getVolcengineTtsConfig(env = process.env) {
  return {
    enabled: isVolcengineTtsEnabled(env),
    endpoint: normalizeText(env.VOLC_TTS_ENDPOINT || env.VOLCENGINE_TTS_ENDPOINT) || DEFAULT_TTS_ENDPOINT,
    apiKey: normalizeText(
      env.VOLC_TTS_API_KEY ||
        env.VOLCENGINE_TTS_API_KEY ||
        env.VOLC_TTS_ACCESS_TOKEN ||
        env.VOLCENGINE_TTS_ACCESS_TOKEN
    ),
    resourceId:
      normalizeText(env.VOLC_TTS_RESOURCE_ID || env.VOLCENGINE_TTS_RESOURCE_ID) || DEFAULT_TTS_RESOURCE_ID,
    voiceType:
      normalizeText(env.VOLC_TTS_VOICE_TYPE || env.VOLCENGINE_TTS_VOICE_TYPE) || DEFAULT_TTS_VOICE_TYPE,
    encoding: normalizeText(env.VOLC_TTS_ENCODING || env.VOLCENGINE_TTS_ENCODING) || DEFAULT_TTS_ENCODING,
    sampleRate: normalizeNumber(env.VOLC_TTS_SAMPLE_RATE || env.VOLCENGINE_TTS_SAMPLE_RATE, DEFAULT_TTS_SAMPLE_RATE),
  };
}

function assertVolcengineTtsConfig(config) {
  if (!normalizeText(config?.apiKey) || !normalizeText(config?.resourceId)) {
    throw new Error("Missing VOLC_TTS_API_KEY or VOLC_TTS_RESOURCE_ID for Volcengine v3 TTS.");
  }
  if (!normalizeText(config?.voiceType)) {
    throw new Error("Missing VOLC_TTS_VOICE_TYPE for Volcengine v3 TTS.");
  }
}

function buildVolcengineTtsPayload({
  voiceType,
  encoding = DEFAULT_TTS_ENCODING,
  sampleRate = DEFAULT_TTS_SAMPLE_RATE,
  text,
}) {
  return {
    req_params: {
      text: normalizeText(text),
      speaker: voiceType,
      audio_params: {
        format: encoding,
        sample_rate: sampleRate,
      },
    },
  };
}

function mimeTypeForEncoding(encoding) {
  const normalized = normalizeText(encoding).toLowerCase();
  if (normalized === "wav") {
    return "audio/wav";
  }
  if (normalized === "ogg_opus" || normalized === "opus") {
    return "audio/ogg";
  }
  if (normalized === "pcm") {
    return "audio/L16";
  }
  return "audio/mpeg";
}

function extractAudioBase64(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  return normalizeText(
    payload.data ||
      payload.audio ||
      payload.audioBase64 ||
      payload.result?.data ||
      payload.result?.audio ||
      payload.response?.data ||
      payload.req_params?.audio
  );
}

function extractErrorMessage(payload, fallback = "") {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }
  return normalizeText(
    payload.message ||
      payload.error ||
      payload.error_msg ||
      payload.msg ||
      payload.header?.message ||
      payload.header?.error ||
      payload.response?.message ||
      payload.response?.error
  ) || fallback;
}

function tryParseJson(text) {
  const content = normalizeText(text);
  if (!content) {
    return null;
  }
  try {
    return JSON.parse(content);
  } catch (_error) {
    return null;
  }
}

function extractAudioBase64FromTextStream(text) {
  const content = String(text || "");
  if (!content.trim()) {
    return "";
  }

  const directJson = tryParseJson(content);
  const directAudio = extractAudioBase64(directJson);
  if (directAudio) {
    return directAudio;
  }

  const chunks = [];
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line === "[DONE]") {
      continue;
    }
    const jsonText = line.startsWith("data:") ? line.slice(5).trim() : line;
    const payload = tryParseJson(jsonText);
    const audio = extractAudioBase64(payload);
    if (audio) {
      chunks.push(audio);
    }
  }
  return chunks.join("");
}

async function readVolcengineTtsResponse(response, config) {
  const contentType = normalizeText(response.headers?.get?.("content-type")).toLowerCase();
  const isJsonLike =
    contentType.includes("json") || contentType.includes("text/") || contentType.includes("event-stream");

  if (isJsonLike && typeof response.text === "function") {
    const text = await response.text();
    const audioBase64 = extractAudioBase64FromTextStream(text);
    if (audioBase64) {
      return audioBase64;
    }
    const payload = tryParseJson(text);
    throw new Error(extractErrorMessage(payload, "Volcengine TTS response did not include audio data."));
  }

  if (typeof response.arrayBuffer === "function") {
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    if (audioBuffer.length > 0) {
      return audioBuffer.toString("base64");
    }
  }

  if (typeof response.text === "function") {
    const text = await response.text();
    const audioBase64 = extractAudioBase64FromTextStream(text);
    if (audioBase64) {
      return audioBase64;
    }
  }

  throw new Error(`Volcengine TTS response did not include ${config.encoding || DEFAULT_TTS_ENCODING} audio data.`);
}

async function readVolcengineError(response) {
  if (typeof response.text !== "function") {
    return `Volcengine TTS request failed: ${response.status}`;
  }
  const text = await response.text();
  const payload = tryParseJson(text);
  return extractErrorMessage(payload, normalizeText(text) || `Volcengine TTS request failed: ${response.status}`);
}

async function synthesizeVolcengineTts(text, options = {}) {
  const config = options.config || getVolcengineTtsConfig();
  assertVolcengineTtsConfig(config);

  const content = normalizeText(text);
  if (!content) {
    throw new Error("Missing text for Volcengine TTS.");
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Current Node.js runtime does not provide fetch for Volcengine TTS.");
  }

  const payload = buildVolcengineTtsPayload({
    ...config,
    text: content,
  });

  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: {
      "X-Api-Key": config.apiKey,
      "X-Api-Resource-Id": config.resourceId,
      "Content-Type": "application/json",
      Connection: "keep-alive",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readVolcengineError(response));
  }

  const audioBase64 = await readVolcengineTtsResponse(response, config);
  return {
    ok: true,
    audioBase64,
    mimeType: mimeTypeForEncoding(config.encoding),
    voiceName: config.voiceType,
    provider: "volcengine",
  };
}

module.exports = {
  DEFAULT_TTS_ENDPOINT,
  DEFAULT_TTS_RESOURCE_ID,
  buildVolcengineTtsPayload,
  getVolcengineTtsConfig,
  isVolcengineTtsEnabled,
  synthesizeVolcengineTts,
};
