const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVolcengineTtsPayload,
  getVolcengineTtsConfig,
  synthesizeVolcengineTts,
} = require("./volcengine-tts");

test("getVolcengineTtsConfig reads Volcengine v3 unidirectional TTS settings", () => {
  const config = getVolcengineTtsConfig({
    TTS_PROVIDER: "volcengine",
    VOLC_TTS_API_KEY: "api-key-abc",
    VOLC_TTS_RESOURCE_ID: "seed-tts-2.0",
    VOLC_TTS_VOICE_TYPE: "zh_female_vv_uranus_bigtts",
    VOLC_TTS_ENCODING: "mp3",
    VOLC_TTS_SAMPLE_RATE: "24000",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.apiKey, "api-key-abc");
  assert.equal(config.resourceId, "seed-tts-2.0");
  assert.equal(config.voiceType, "zh_female_vv_uranus_bigtts");
  assert.equal(config.encoding, "mp3");
  assert.equal(config.sampleRate, 24000);
  assert.equal(config.endpoint, "https://openspeech.bytedance.com/api/v3/tts/unidirectional");
});

test("buildVolcengineTtsPayload builds the v3 unidirectional request body", () => {
  const payload = buildVolcengineTtsPayload({
    voiceType: "zh_female_vv_uranus_bigtts",
    encoding: "mp3",
    sampleRate: 24000,
    text: "你好，这是一个语音测试",
  });

  assert.deepEqual(payload, {
    req_params: {
      text: "你好，这是一个语音测试",
      speaker: "zh_female_vv_uranus_bigtts",
      audio_params: {
        format: "mp3",
        sample_rate: 24000,
      },
    },
  });
});

test("synthesizeVolcengineTts sends v3 headers and maps binary audio response", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      headers: {
        get: (name) => (String(name).toLowerCase() === "content-type" ? "audio/mpeg" : ""),
      },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      text: async () => "",
    };
  };

  const result = await synthesizeVolcengineTts("你好", {
    fetchImpl,
    config: {
      enabled: true,
      endpoint: "https://example.test/api/v3/tts/unidirectional",
      apiKey: "api-key-abc",
      resourceId: "seed-tts-2.0",
      voiceType: "zh_female_vv_uranus_bigtts",
      encoding: "mp3",
      sampleRate: 24000,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.audioBase64, "AQID");
  assert.equal(result.mimeType, "audio/mpeg");
  assert.equal(result.voiceName, "zh_female_vv_uranus_bigtts");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.test/api/v3/tts/unidirectional");
  assert.equal(calls[0].options.headers["X-Api-Key"], "api-key-abc");
  assert.equal(calls[0].options.headers["X-Api-Resource-Id"], "seed-tts-2.0");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(JSON.parse(calls[0].options.body).req_params.text, "你好");
});

test("synthesizeVolcengineTts also accepts JSON base64 responses", async () => {
  const result = await synthesizeVolcengineTts("你好", {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => "application/json",
      },
      text: async () => JSON.stringify({ data: "UklGRg==" }),
    }),
    config: {
      enabled: true,
      endpoint: "https://example.test/api/v3/tts/unidirectional",
      apiKey: "api-key-abc",
      resourceId: "seed-tts-2.0",
      voiceType: "zh_female_vv_uranus_bigtts",
      encoding: "mp3",
      sampleRate: 24000,
    },
  });

  assert.equal(result.audioBase64, "UklGRg==");
});

test("synthesizeVolcengineTts fails fast when v3 credentials are missing", async () => {
  await assert.rejects(
    () =>
      synthesizeVolcengineTts("你好", {
        fetchImpl: async () => {
          throw new Error("network should not be called");
        },
        config: {
          enabled: true,
          endpoint: "https://example.test/api/v3/tts/unidirectional",
          apiKey: "",
          resourceId: "",
          voiceType: "zh_female_vv_uranus_bigtts",
          encoding: "mp3",
          sampleRate: 24000,
        },
      }),
    /VOLC_TTS_API_KEY.*VOLC_TTS_RESOURCE_ID/
  );
});

test("synthesizeVolcengineTts surfaces Volcengine v3 error messages", async () => {
  await assert.rejects(
    () =>
      synthesizeVolcengineTts("你好", {
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          headers: {
            get: () => "application/json",
          },
          text: async () => JSON.stringify({ message: "invalid api key" }),
        }),
        config: {
          enabled: true,
          endpoint: "https://example.test/api/v3/tts/unidirectional",
          apiKey: "bad-key",
          resourceId: "seed-tts-2.0",
          voiceType: "zh_female_vv_uranus_bigtts",
          encoding: "mp3",
          sampleRate: 24000,
        },
      }),
    /invalid api key/
  );
});

test("synthesizeVolcengineTts surfaces nested Volcengine header messages", async () => {
  await synthesizeVolcengineTts("你好", {
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      headers: {
        get: () => "application/json",
      },
      text: async () =>
        JSON.stringify({
          header: {
            code: 45000010,
            message: "Invalid X-Api-Key",
          },
        }),
    }),
    config: {
      enabled: true,
      endpoint: "https://example.test/api/v3/tts/unidirectional",
      apiKey: "bad-key",
      resourceId: "seed-tts-2.0",
      voiceType: "zh_female_vv_uranus_bigtts",
      encoding: "mp3",
      sampleRate: 24000,
    },
  }).then(
    () => assert.fail("expected TTS request to fail"),
    (error) => {
      assert.equal(error.message, "Invalid X-Api-Key");
    }
  );
});
