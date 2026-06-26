import { AudioInputManager } from "./audio/audio-input-manager.js";
import { AudioLevelVadManager } from "./audio/vad-manager.js";
import { WebSpeechAsrAdapter } from "./audio/asr-adapter.js";
import { BrowserTtsAdapter } from "./audio/tts-adapter.js";
import { RealtimeConversationOrchestrator } from "./audio/conversation-orchestrator.js";

const state = {
  busy: false,
  currentAdviceAbortController: null,
  currentAdviceRequestId: 0,
  lastAdvice: null,
  lastMirrorReply: "",
  pendingAdvicePartial: "",
  pendingAdviceText: "",
  pendingAdviceSource: "",
  visionThinking: {
    active: false,
    stage: "",
    message: "",
  },
  chatHistory: [],
  voiceSupported: false,
  voiceAvailable: false,
  microphonePermission: "unknown",
  listening: false,
  voiceSessionId: "",
  wakeModeEnabled: false,
  wakeSessionActive: false,
  speakerEnabled: true,
  coachLoop: false,
  coachLoopTimer: null,
  lastChatEntry: null,
  healthPollTimer: null,
  asrPrewarmRequested: false,
  asrActuallyReady: false,
};

const elements = {
  cameraDot: document.querySelector("#camera-dot"),
  cameraState: document.querySelector("#camera-state"),
  cameraReconnectBtn: document.querySelector("#camera-reconnect-btn"),
  agentDot: document.querySelector("#agent-dot"),
  agentState: document.querySelector("#agent-state"),
  voiceDot: document.querySelector("#voice-dot"),
  voicePillState: document.querySelector("#voice-pill-state"),
  wakeDot: document.querySelector("#wake-dot"),
  wakePillState: document.querySelector("#wake-pill-state"),
  mirrorChatStatus: document.querySelector("#mirror-chat-status"),
  mirrorChatThread: document.querySelector("#mirror-chat-thread"),
  intentText: document.querySelector("#intent-text"),
  promptInput: document.querySelector("#prompt-input"),
  promptSendBtn: document.querySelector("#prompt-send-btn"),
  coachLoopBtn: document.querySelector("#coach-loop-btn"),
  startVoiceBtn: document.querySelector("#start-voice-btn"),
  stopVoiceBtn: document.querySelector("#stop-voice-btn"),
  voiceState: document.querySelector("#voice-state"),
  streamImage: document.querySelector("#gpupixel-stream"),
  canvas: document.querySelector("#camera-canvas"),
  mirrorOutput: document.querySelector("#mirror-output"),
  gpupixelControlState: document.querySelector("#gpupixel-control-state"),
  gpupixelSliders: Array.from(document.querySelectorAll("[data-gpupixel-param]")),
  voiceSessionStatus: document.querySelector("#voice-session-status"),
  voicePartialTranscript: document.querySelector("#voice-partial-transcript"),
  voiceFinalTranscript: document.querySelector("#voice-final-transcript"),
  voiceMetrics: document.querySelector("#voice-metrics"),
};

let audioInputManager = null;
let vadManager = null;
let asrAdapter = null;
let ttsAdapter = null;
let realtimeConversation = null;
let cameraStream = null;
let cameraConnectAttempt = 0;
let gpupixelParams = {};
let gpupixelParamTimer = null;

const VOICE_SESSION_STORAGE_KEY = "beauty-studio.voice-session-id";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createSessionId(prefix = "voice-session") {
  if (window.crypto?.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureVoiceSessionId() {
  if (state.voiceSessionId) {
    return state.voiceSessionId;
  }
  const cached = window.localStorage.getItem(VOICE_SESSION_STORAGE_KEY) || "";
  state.voiceSessionId = cached || createSessionId();
  window.localStorage.setItem(VOICE_SESSION_STORAGE_KEY, state.voiceSessionId);
  return state.voiceSessionId;
}

function setIndicator(dot, active) {
  if (!dot) return;
  dot.style.background = active ? "#db6e67" : "#b9aaae";
  dot.style.boxShadow = active
    ? "0 0 0 8px rgba(219, 110, 103, 0.18)"
    : "0 0 0 8px rgba(185, 170, 174, 0.14)";
}

function setEngineMode(_text) {}

function updateVoiceState(text) {
  if (elements.voiceState) {
    elements.voiceState.textContent = text;
  }
}

function renderVoicePill() {
  const voiceActive = state.voiceSupported && ((state.voiceAvailable && state.asrActuallyReady) || state.listening);
  const wakeActive = state.wakeModeEnabled || state.wakeSessionActive;
  setIndicator(elements.voiceDot, voiceActive);
  setIndicator(elements.wakeDot, wakeActive);

  if (elements.voicePillState) {
    if (!state.voiceSupported) {
      elements.voicePillState.textContent = "浏览器不支持";
    } else if (state.listening) {
      elements.voicePillState.textContent = "麦克风监听中";
    } else if (!state.asrActuallyReady) {
      elements.voicePillState.textContent = "语音引擎预热中";
    } else if (state.microphonePermission === "denied") {
      elements.voicePillState.textContent = "麦克风已禁用";
    } else if (state.microphonePermission === "granted") {
      elements.voicePillState.textContent = "麦克风待开启";
    } else if (state.voiceAvailable) {
      elements.voicePillState.textContent = "点击开启麦克风";
    } else {
      elements.voicePillState.textContent = "语音待连接";
    }
  }

  if (elements.wakePillState) {
    elements.wakePillState.textContent = state.wakeSessionActive
      ? "正在对话"
      : state.wakeModeEnabled
        ? "后台常驻中"
        : "后台待命中";
  }

  if (elements.mirrorChatStatus) {
    elements.mirrorChatStatus.textContent = state.wakeSessionActive
      ? "实时语音对话中"
      : state.wakeModeEnabled
        ? "实时语音已开启"
        : "后台常驻监听中";
  }
}

function renderIntent() {
  const text = elements.promptInput?.value.trim() || "你还没有输入具体想要的妆效。";
  if (elements.intentText) {
    elements.intentText.textContent = text;
  }
}

function pushChatHistory(role, text, source = "") {
  const content = String(text || "").trim();
  if (!content) return;

  const now = Date.now();
  const previousEntry = state.lastChatEntry;
  if (
    previousEntry &&
    previousEntry.role === role &&
    previousEntry.text === content &&
    previousEntry.source === source &&
    now - previousEntry.at < 1800
  ) {
    return;
  }

  state.chatHistory.push({
    role,
    text: content,
    source,
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
  });
  state.lastChatEntry = { role, text: content, source, at: now };
  state.chatHistory = state.chatHistory.slice(-30);
  renderMirrorChat();
}

function renderMirrorChat() {
  if (!elements.mirrorChatThread) return;

  const entries = state.chatHistory.length
    ? [...state.chatHistory]
    : [
        {
          role: "assistant",
          text: "我在。你可以直接和魔镜对话，我会同步给 OpenHarness。",
          pending: false,
        },
      ];

  if (state.visionThinking.active) {
    entries.push({
      role: "assistant",
      visionThinking: true,
      stage: state.visionThinking.stage,
      text: state.visionThinking.message,
    });
  }

  const pendingText = state.pendingAdvicePartial || state.pendingAdviceText;
  if (pendingText && !state.visionThinking.active) {
    entries.push({
      role: "assistant",
      text: pendingText,
      pending: true,
    });
  }

  elements.mirrorChatThread.innerHTML = entries
    .map((entry) => {
      if (entry.visionThinking) {
        return `
          <article class="chat-bubble assistant vision-thinking" data-stage="${escapeHtml(entry.stage)}">
            <div class="vision-thinking-title">
              <strong>魔镜正在看看你</strong>
              <span class="vision-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            </div>
            <div class="vision-thinking-progress" aria-hidden="true"><span></span></div>
            <p>${escapeHtml(entry.text || "正在理解你的问题")}</p>
          </article>
        `;
      }
      const role = entry.role === "user" ? "user" : "assistant";
      const label = role === "user" ? "你" : entry.pending ? "魔镜回复中" : "魔镜";
      const extraClass = entry.pending ? " highlight" : "";
      return `
        <article class="chat-bubble ${role}${extraClass}">
          <span>${escapeHtml(label)}</span>
          <p>${escapeHtml(entry.text)}</p>
        </article>
      `;
    })
    .join("");

  elements.mirrorChatThread.scrollTop = elements.mirrorChatThread.scrollHeight;
}

function renderVoiceRealtimeStatus(text) {
  if (elements.voiceSessionStatus) {
    elements.voiceSessionStatus.textContent = text || "待开启";
  }
}

function renderVoiceRealtimeTranscript({ partial = "", final = "" } = {}) {
  if (elements.voicePartialTranscript) {
    elements.voicePartialTranscript.textContent = partial || "实时转写会显示在这里。";
  }
  if (elements.voiceFinalTranscript) {
    elements.voiceFinalTranscript.textContent = final || "确认后的文本会显示在这里。";
  }
}

function renderVoiceRealtimeMetrics(metrics = {}) {
  if (!elements.voiceMetrics) return;
  const baseAt =
    metrics.vadStartAt ||
    metrics.asrFirstPartialAt ||
    metrics.committedAt ||
    metrics.llmFirstDeltaAt ||
    metrics.ttsSpeakStartAt ||
    0;
  const formatMetric = (value) => {
    if (!value || !baseAt) return "-";
    return `${Math.round(Math.max(0, value - baseAt))}ms`;
  };

  elements.voiceMetrics.innerHTML = [
    `VAD ${baseAt ? "0ms" : "-"}`,
    `ASR ${formatMetric(metrics.asrFirstPartialAt)}`,
    `COMMIT ${formatMetric(metrics.committedAt)}`,
    `LLM ${formatMetric(metrics.llmFirstDeltaAt)}`,
    `TTS ${formatMetric(metrics.ttsSpeakStartAt)}`,
  ]
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join("");
}

function speak(text) {
  const content = String(text || "").trim();
  if (!content) return;

  if (ttsAdapter) {
    void ttsAdapter.speak(content);
    return;
  }
}

async function syncMicrophonePermission() {
  if (!state.voiceSupported) {
    state.microphonePermission = "unsupported";
    renderVoicePill();
    return;
  }

  if (!navigator.permissions?.query) {
    state.microphonePermission = "unknown";
    renderVoicePill();
    return;
  }

  try {
    const permissionStatus = await navigator.permissions.query({ name: "microphone" });
    state.microphonePermission = permissionStatus.state || "unknown";
    permissionStatus.onchange = () => {
      state.microphonePermission = permissionStatus.state || "unknown";
      renderVoicePill();
    };
  } catch (_error) {
    state.microphonePermission = "unknown";
  }

  renderVoicePill();
}

function clearPendingAdviceFeedback() {
  state.pendingAdvicePartial = "";
  state.pendingAdviceText = "";
  state.pendingAdviceSource = "";
  state.visionThinking = {
    active: false,
    stage: "",
    message: "",
  };
  renderMirrorChat();
}

function setVisionThinking(stage, message) {
  state.visionThinking = {
    active: stage !== "failed",
    stage: String(stage || ""),
    message: String(message || "正在理解你的问题"),
  };
  if (stage === "failed") {
    state.pendingAdviceText = state.visionThinking.message;
    state.pendingAdvicePartial = state.visionThinking.message;
  }
  renderMirrorChat();
}

function clearVisionThinking() {
  if (!state.visionThinking.active && !state.visionThinking.stage) {
    return;
  }
  state.visionThinking = {
    active: false,
    stage: "",
    message: "",
  };
}

function setPendingAdviceFeedback(text, { source = "" } = {}) {
  state.pendingAdviceText = text || "";
  state.pendingAdvicePartial = text || "";
  state.pendingAdviceSource = source || "";
  renderMirrorChat();
}

function interruptCurrentInteraction(reason = "检测到新的输入，已中断上一轮") {
  if (state.currentAdviceAbortController) {
    state.currentAdviceAbortController.abort();
    state.currentAdviceAbortController = null;
  }
  if (ttsAdapter) {
    ttsAdapter.stopNow();
  } else if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  if (state.busy) {
    clearVisionThinking();
    setPendingAdviceFeedback("已中断上一轮回复，准备响应新的问题。", {
      source: state.pendingAdviceSource,
    });
    updateVoiceState(reason);
    renderVoiceRealtimeStatus("interrupted");
  }
}

function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  if (elements.streamImage) {
    elements.streamImage.removeAttribute("src");
  }
}

function describeCameraError(error) {
  const message = error?.message || "未知错误";
  return `GPUPixel 视频流不可用: ${message}`;
}

async function setupCamera({ retry = 2, manual = false } = {}) {
  const attemptId = (cameraConnectAttempt += 1);
  stopCameraStream();
  if (elements.cameraReconnectBtn) {
    elements.cameraReconnectBtn.disabled = true;
  }
  if (elements.cameraState) {
    elements.cameraState.textContent = manual ? "正在重新连接 GPUPixel 画面..." : "正在连接 GPUPixel 画面...";
  }

  try {
    const response = await fetch("/api/gpupixel/stream", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "GPUPixel stream config unavailable");
    }
    if (!elements.streamImage) {
      throw new Error("GPUPixel stream image element missing");
    }
    elements.streamImage.onerror = () => {
      if (attemptId !== cameraConnectAttempt) return;
      setIndicator(elements.cameraDot, false);
      if (elements.cameraState) {
        elements.cameraState.textContent = "GPUPixel 视频流加载失败";
      }
      if (elements.cameraReconnectBtn) {
        elements.cameraReconnectBtn.disabled = false;
      }
    };
    elements.streamImage.src = `/api/gpupixel/live.mjpg?t=${Date.now()}`;
    setIndicator(elements.cameraDot, true);
    if (elements.cameraState) {
      elements.cameraState.textContent = "GPUPixel 画面已连接";
    }
    if (elements.cameraReconnectBtn) {
      elements.cameraReconnectBtn.disabled = false;
    }
  } catch (error) {
    stopCameraStream();
    if (attemptId === cameraConnectAttempt && retry > 0) {
      await new Promise((resolve) => setTimeout(resolve, manual ? 900 : 1400));
      return setupCamera({ retry: retry - 1, manual });
    }
    setIndicator(elements.cameraDot, false);
    if (elements.cameraState) {
      elements.cameraState.textContent = describeCameraError(error);
    }
    if (elements.cameraReconnectBtn) {
      elements.cameraReconnectBtn.disabled = false;
    }
  }
}
function captureFrame() {
  if (!elements.streamImage || !elements.canvas) return null;
  const imageWidth = elements.streamImage.naturalWidth || elements.streamImage.width;
  const imageHeight = elements.streamImage.naturalHeight || elements.streamImage.height;
  if (!imageWidth || !imageHeight || !elements.streamImage.complete) return null;
  elements.canvas.width = imageWidth;
  elements.canvas.height = imageHeight;
  const context = elements.canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(elements.streamImage, 0, 0, imageWidth, imageHeight);
  const dataUrl = elements.canvas.toDataURL("image/jpeg", 0.82);
  const [prefix, base64] = dataUrl.split(",");
  const mime = prefix.match(/data:(.*?);base64/)?.[1] || "image/jpeg";
  return { mime, base64 };
}

function setGpupixelControlState(text) {
  if (elements.gpupixelControlState) {
    elements.gpupixelControlState.textContent = text;
  }
}

function renderGpupixelParams(params = gpupixelParams) {
  elements.gpupixelSliders.forEach((slider) => {
    const key = slider.dataset.gpupixelParam;
    const value = Number(params[key] ?? slider.value ?? 0);
    slider.value = String(value);
    const label = document.querySelector(`#gpupixel-${key}-value`);
    if (label) {
      label.textContent = value.toFixed(key === "mouthResize" || key === "noseResize" ? 2 : 1);
    }
  });
}

async function loadGpupixelParams() {
  try {
    const response = await fetch("/api/gpupixel/params", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "GPUPixel 参数接口不可用");
    }
    gpupixelParams = result.params || {};
    renderGpupixelParams();
    setGpupixelControlState("已连接");
  } catch (error) {
    setGpupixelControlState("连接失败");
    console.warn("Failed to load GPUPixel params.", error);
  }
}

async function saveGpupixelParams() {
  try {
    setGpupixelControlState("同步中");
    const response = await fetch("/api/gpupixel/params", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: gpupixelParams }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "GPUPixel 参数同步失败");
    }
    gpupixelParams = result.params || gpupixelParams;
    renderGpupixelParams();
    setGpupixelControlState("已同步");
  } catch (error) {
    setGpupixelControlState("同步失败");
    console.warn("Failed to save GPUPixel params.", error);
  }
}

function scheduleGpupixelParamSave() {
  if (gpupixelParamTimer) {
    clearTimeout(gpupixelParamTimer);
  }
  gpupixelParamTimer = setTimeout(() => {
    gpupixelParamTimer = null;
    void saveGpupixelParams();
  }, 120);
}

function isChatSource(source) {
  return ["text-send", "text-enter", "voice-direct", "voice-realtime"].includes(String(source || ""));
}

async function readStreamedAdviceResponse(response, requestId) {
  if (!response.ok) {
    throw new Error(`请求失败 (${response.status})`);
  }
  if (!response.body) {
    return response.json();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let finalResult = null;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        const event = JSON.parse(line);
        if (requestId !== state.currentAdviceRequestId) {
          newlineIndex = buffer.indexOf("\n");
          continue;
        }

        if (event.type === "vision-progress") {
          setVisionThinking(event.stage, event.message);
        } else if (event.type === "status") {
          setPendingAdviceFeedback(event.message || "我听到了，正在回答，请稍等...", {
            source: event.source || state.pendingAdviceSource,
          });
        } else if (event.type === "gpupixel-control") {
          clearVisionThinking();
          if (event.control?.params) {
            gpupixelParams = event.control.params;
            renderGpupixelParams();
          }
          setGpupixelControlState(event.control?.applied ? "语音已同步" : "已同步");
          setPendingAdviceFeedback(event.message || "已同步 GPUPixel 参数", {
            source: event.source || state.pendingAdviceSource,
          });
        } else if (event.type === "delta") {
          clearVisionThinking();
          if (state.pendingAdviceSource === "voice-realtime" && realtimeConversation?.isEnabled()) {
            realtimeConversation.markLlmFirstDelta();
          }
          state.pendingAdvicePartial = String(event.text || "");
          renderMirrorChat();
        } else if (event.type === "sentence") {
          clearVisionThinking();
          state.pendingAdvicePartial = String(event.text || state.pendingAdvicePartial || "");
          renderMirrorChat();
        } else if (event.type === "complete") {
          clearVisionThinking();
          finalResult = event.result || null;
        } else if (event.type === "error") {
          clearVisionThinking();
          throw new Error(event.error || event.message || "对话失败");
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }

    if (done) break;
  }

  if (!finalResult) {
    throw new Error("魔镜没有返回完整结果");
  }

  return finalResult;
}

async function requestAdvice({
  source = "manual",
  conversationMode = "",
  voiceTurnId = 0,
  requestMetrics = null,
} = {}) {
  if (state.busy && isChatSource(source)) {
    interruptCurrentInteraction("检测到新的输入，已切换到最新问题。");
  } else if (state.busy) {
    return;
  }

  state.busy = true;
  state.currentAdviceRequestId += 1;
  const requestId = state.currentAdviceRequestId;
  const abortController = new AbortController();
  state.currentAdviceAbortController = abortController;
  clearVisionThinking();

  const promptText = elements.promptInput?.value.trim() || "";
  const allowTextOnlyAdvice = isChatSource(source);
  const frame = allowTextOnlyAdvice ? null : captureFrame();
  const realtimeSnapshot =
    source === "voice-realtime" && realtimeConversation?.isEnabled()
      ? realtimeConversation.getRealtimeSnapshot()
      : null;

  if (allowTextOnlyAdvice && promptText && source !== "voice-realtime") {
    pushChatHistory("user", promptText, source);
  }

  setEngineMode(allowTextOnlyAdvice ? "正在发送对话请求" : "正在分析当前画面");
  setPendingAdviceFeedback("我听到了，正在请魔镜回答...", { source });

  try {
    if (source === "voice-realtime" && realtimeConversation?.isEnabled()) {
      realtimeConversation.markLlmRequestStart();
    }

    const payload = {
      sessionId: source === "voice-realtime" ? ensureVoiceSessionId() : "",
      turnId: source === "voice-realtime" ? Number(voiceTurnId || 0) : 0,
      conversationMode: conversationMode || (source === "voice-realtime" ? "realtime-voice" : "standard"),
      userRequest: promptText,
      partialTranscript: realtimeSnapshot?.transcript?.partialTranscript || "",
      finalTranscript: realtimeSnapshot?.transcript?.finalTranscript || "",
      stableTranscript: realtimeSnapshot?.transcript?.stableTranscript || "",
      transcriptSegments: realtimeSnapshot?.transcript?.segments || [],
      source,
      currentStep: "妆前准备",
      stepIndex: 1,
      stepMode: "auto",
      detectedStepTitle: "妆前准备",
      detectedStepConfidence: 0,
      detectedStepReason: "等待更完整分析",
      observation: "当前版本已切换到最小可运行前端基线。",
      faceProfile: {
        shape: "unknown",
        label: "待确认",
        confidence: 0,
        metrics: [],
      },
      moduleSignals: { gpupixel: { summary: "GPUPixel native client is the active beauty engine.", mode: "native-video-client", metrics: [] } },
      realtimeMetrics: requestMetrics || null,
      clientMetrics: requestMetrics || null,
      realtimeSnapshot,
      imageMimeType: frame?.mime || "",
      imageBase64: frame?.base64 || "",
    };

    const response = await fetch(allowTextOnlyAdvice ? "/api/advice?stream=1" : "/api/advice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    const result = allowTextOnlyAdvice
      ? await readStreamedAdviceResponse(response, requestId)
      : await response.json();

    if (!result.ok) {
      throw new Error(result.error || "分析失败");
    }
    if (requestId !== state.currentAdviceRequestId) {
      return;
    }

    if (result.gpupixel?.control?.params) {
      gpupixelParams = result.gpupixel.control.params;
      renderGpupixelParams();
      setGpupixelControlState(result.gpupixel.control.applied ? "语音已同步" : "已同步");
    }

    state.lastAdvice = result.advice || null;
    state.lastMirrorReply =
      result.advice?.replyText ||
      result.advice?.rawReplyText ||
      result.advice?.nextStep ||
      result.advice?.summary ||
      "";

    clearPendingAdviceFeedback();
    renderMirrorChat();

    if (allowTextOnlyAdvice && state.lastMirrorReply) {
      pushChatHistory("assistant", state.lastMirrorReply, source);
    }

    if (elements.agentState) {
      elements.agentState.textContent = result.integration?.available
        ? "OpenHarness 已就绪"
        : "本轮已回退，OpenHarness 待恢复";
    }
    setIndicator(elements.agentDot, Boolean(result.openharness?.available ?? result.integration?.available));

    const shouldSpeakReply =
      state.speakerEnabled &&
      result.integration?.available &&
      result.advice?.integration !== "local-fallback" &&
      result.advice?.speakText;

    if (shouldSpeakReply) {
      speak(result.advice.speakText);
    }

    if (realtimeConversation?.isEnabled()) {
      realtimeConversation.notifyReplyCompleted({
        spoken: Boolean(shouldSpeakReply),
      });
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      clearPendingAdviceFeedback();
      state.lastMirrorReply = `请求失败：${error.message}`;
      renderMirrorChat();
      updateVoiceState(`请求失败：${error.message}`);
      if (realtimeConversation?.isEnabled()) {
        realtimeConversation.notifyReplyError(error);
      }
    }
  } finally {
    if (requestId === state.currentAdviceRequestId) {
      state.busy = false;
      state.currentAdviceAbortController = null;
      setEngineMode("系统就绪");
    }
  }
}

function ensureRealtimeConversation() {
  if (realtimeConversation) {
    return realtimeConversation;
  }

  const configuredAsrProvider = String(window.__BEAUTY_STUDIO_ASR_PROVIDER__ ?? "whisper-local").trim();
  const configuredAsrPartial = String(window.__BEAUTY_STUDIO_ENABLE_PARTIAL__ ?? "off").toLowerCase() === "on";
  audioInputManager = new AudioInputManager();
  vadManager = new AudioLevelVadManager();
  asrAdapter = new WebSpeechAsrAdapter({
    provider: configuredAsrProvider,
    enablePartial: configuredAsrPartial,
  });
  ttsAdapter = new BrowserTtsAdapter();
  state.voiceSupported = asrAdapter.isSupported();
  state.voiceAvailable = state.voiceSupported;

  asrAdapter.addEventListener("started", () => {
    const runtime = asrAdapter.getRuntimeInfo?.() || {};
    updateVoiceState(`ASR 已连接：${runtime.provider || "unknown"} / ${runtime.engine || runtime.mode || "unknown"}`);
  });
  asrAdapter.addEventListener("error", (event) => {
    const errorCode = event.detail?.error || "unknown-error";
    updateVoiceState(`ASR 波动：${errorCode}`);
  });
  ttsAdapter.addEventListener("start", (event) => {
    const voiceName = event.detail?.voiceName || ttsAdapter.getSelectedVoiceName() || "default voice";
    updateVoiceState(`正在播报：${voiceName}`);
  });
  ttsAdapter.addEventListener("error", (event) => {
    const errorCode = event.detail?.error || "tts-error";
    const diagnostics = ttsAdapter.getDiagnostics?.() || {};
    const voiceName = diagnostics.selectedVoiceName || event.detail?.voiceName || "unknown voice";
    const detail = event.detail?.errorDetail || diagnostics.lastErrorDetail || "";
    const suffix = detail ? ` | ${detail}` : "";
    updateVoiceState(`语音播报失败：${errorCode}，当前音色 ${voiceName}${suffix}`);
    if (detail) {
      console.error("Local TTS error detail:", detail, diagnostics.lastErrorDiagnostics || event.detail?.diagnostics || null);
    }
  });
  ttsAdapter.addEventListener("diagnostics", (event) => {
    const detail = event.detail || {};
    if (detail.reason === "start") {
      return;
    }
    if (detail.voiceCount) {
      updateVoiceState(`本地播报音色已加载，共 ${detail.voiceCount} 个可用音色`);
    }
  });

  realtimeConversation = new RealtimeConversationOrchestrator({
    audioInputManager,
    vadManager,
    asrAdapter,
    ttsAdapter,
    onStateChange: (status, message) => {
      renderVoiceRealtimeStatus(status);
      if (message) updateVoiceState(message);
      state.voiceSupported = asrAdapter.isSupported();
      state.voiceAvailable = state.voiceSupported;
      state.listening = status === "listening" || status === "capturing";
      state.wakeModeEnabled = status !== "idle";
      state.wakeSessionActive = status === "thinking" || status === "speaking";
      renderVoicePill();
    },
    onPartialTranscript: (text) => {
      renderVoiceRealtimeTranscript({
        partial: text,
        final: "",
      });
      if (text) {
        elements.promptInput.value = text;
        renderIntent();
        renderVoiceRealtimeStatus("实时转写中...");
      }
    },
    onFinalTranscript: (text) => {
      renderVoiceRealtimeTranscript({
        partial: elements.voicePartialTranscript?.textContent || "",
        final: text,
      });
      if (text) {
        elements.promptInput.value = text;
        renderIntent();
        renderVoiceRealtimeStatus("已识别，等待自动提交...");
      }
    },
    onCommittedTranscript: (text) => {
      elements.promptInput.value = text;
      renderIntent();
      pushChatHistory("user", text, "voice-realtime");
    },
    onInterruptRequest: (reason) => {
      interruptCurrentInteraction(reason);
    },
    onSubmitTranscript: async ({ text, turnId, metrics }) => {
      elements.promptInput.value = text;
      renderIntent();
      await requestAdvice({
        source: "voice-realtime",
        conversationMode: "realtime-voice",
        voiceTurnId: turnId,
        requestMetrics: metrics,
      });
    },
    onError: (error) => {
      updateVoiceState(`实时语音异常：${error.message}`);
    },
    onMetrics: (metrics) => {
      renderVoiceRealtimeMetrics(metrics);
    },
  });

  return realtimeConversation;
}

async function startRealtimeVoiceConversation() {
  const controller = ensureRealtimeConversation();
  if (!state.voiceSupported) {
    throw new Error("当前浏览器不支持实时语音识别");
  }

  updateVoiceState("正在申请麦克风权限...");
  await controller.start();
  state.microphonePermission = "granted";
  renderVoiceRealtimeTranscript({});
  renderVoiceRealtimeMetrics({});
  renderVoicePill();
}

async function stopRealtimeVoiceConversation() {
  if (!realtimeConversation) return;
  await realtimeConversation.stop();
  renderVoiceRealtimeStatus("待开启");
  renderVoiceRealtimeTranscript({});
  renderVoiceRealtimeMetrics({});
  state.voiceSupported = Boolean(asrAdapter?.isSupported());
  state.voiceAvailable = state.voiceSupported;
  state.listening = false;
  state.wakeModeEnabled = false;
  state.wakeSessionActive = false;
  await syncMicrophonePermission();
  renderVoicePill();
}

function toggleCoachLoop() {
  state.coachLoop = !state.coachLoop;
  if (elements.coachLoopBtn) {
    elements.coachLoopBtn.textContent = state.coachLoop ? "关闭连续对话" : "开启连续对话";
  }
  if (state.coachLoop) {
    state.coachLoopTimer = window.setInterval(() => {
      void requestAdvice({ source: "manual" });
    }, 20000);
    updateVoiceState("连续对话已开启，系统会定时刷新建议。");
  } else if (state.coachLoopTimer) {
    window.clearInterval(state.coachLoopTimer);
    state.coachLoopTimer = null;
    updateVoiceState("连续对话已关闭。");
  }
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const result = await response.json();
    setIndicator(elements.agentDot, Boolean(result.openharness?.available));
    if (elements.agentState) {
      elements.agentState.textContent = result.openharness?.available
        ? "OpenHarness 已就绪"
        : result.openharness?.reason || "OpenHarness 未就绪";
    }

    const localAsr = result.modules?.localAsr || null;
    state.asrActuallyReady = localAsr?.status === "ready";
    if (
      !state.asrPrewarmRequested &&
      localAsr &&
      localAsr.status !== "ready" &&
      (localAsr.status === "standby" || /first request|load on first request|online/i.test(localAsr.detail || ""))
    ) {
      state.asrPrewarmRequested = true;
      updateVoiceState("语音引擎后台预热中，首句等待会明显缩短。");
      void fetch("/api/voice/asr/prewarm", { method: "POST" }).catch(() => {
        state.asrPrewarmRequested = false;
      });
    }

    if (localAsr?.status === "warming") {
      updateVoiceState("语音引擎后台预热中，请稍等片刻。");
    } else if (localAsr?.status === "ready" && state.asrPrewarmRequested) {
      updateVoiceState("语音引擎已预热完成，可以开始更快地实时对话。");
      state.asrActuallyReady = true;
    }
    renderVoicePill();
  } catch (error) {
    setIndicator(elements.agentDot, false);
    if (elements.agentState) {
      elements.agentState.textContent = `状态检测失败: ${error.message}`;
    }
  }
}

function startHealthPolling() {
  if (state.healthPollTimer) {
    window.clearInterval(state.healthPollTimer);
  }
  state.healthPollTimer = window.setInterval(() => {
    void loadHealth();
  }, 6000);
}

function bindEvents() {
  elements.promptInput?.addEventListener("input", renderIntent);
  elements.promptInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void requestAdvice({ source: "text-enter" });
    }
  });
  elements.promptSendBtn?.addEventListener("click", () => {
    void requestAdvice({ source: "text-send" });
  });
  elements.startVoiceBtn?.addEventListener("click", () => {
    void startRealtimeVoiceConversation().catch((error) => {
      const message = error?.message || "未知错误";
      if (/denied|permission|notallowed|拒绝|blocked|麦克风/i.test(message)) {
        state.microphonePermission = "denied";
        updateVoiceState("麦克风权限被拒绝，请在地址栏右侧允许麦克风访问。");
      } else {
        updateVoiceState(`无法开启实时语音: ${message}`);
      }
      renderVoicePill();
    });
  });
  elements.stopVoiceBtn?.addEventListener("click", () => {
    void stopRealtimeVoiceConversation();
  });
  elements.cameraReconnectBtn?.addEventListener("click", () => {
    void setupCamera({ retry: 3, manual: true });
  });
  elements.gpupixelSliders.forEach((slider) => {
    slider.addEventListener("input", () => {
      const key = slider.dataset.gpupixelParam;
      gpupixelParams = {
        ...gpupixelParams,
        [key]: Number(slider.value),
      };
      renderGpupixelParams();
      scheduleGpupixelParamSave();
    });
  });
  elements.coachLoopBtn?.addEventListener("click", toggleCoachLoop);
}


async function bootstrap() {
  setEngineMode("系统启动中");
  renderIntent();
  renderMirrorChat();
  renderVoiceRealtimeStatus("待开启");
  renderVoiceRealtimeTranscript({});
  renderVoiceRealtimeMetrics({});
  renderVoicePill();
  bindEvents();
  ensureRealtimeConversation();
  ensureVoiceSessionId();
  startHealthPolling();
  await syncMicrophonePermission();

  if (state.voiceSupported) {
    updateVoiceState("语音模块已连接。若本地识别仍在预热，首句可能稍慢。");
  } else {
    updateVoiceState("当前浏览器不支持实时语音，请使用新版 Chrome 或 Edge。");
  }

  renderVoicePill();
  await loadGpupixelParams();
  await setupCamera();
  await loadHealth();
  setEngineMode("系统就绪");
}

window.addEventListener("pagehide", stopCameraStream);
window.addEventListener("beforeunload", stopCameraStream);

bootstrap().catch((error) => {
  console.error("Failed to bootstrap Beauty Studio Coach.", error);
  updateVoiceState(`启动失败：${error.message}`);
});
