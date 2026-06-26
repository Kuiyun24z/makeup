function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSegments(segments = []) {
  if (!Array.isArray(segments)) {
    return [];
  }

  return segments
    .map((segment, index) => ({
      id: normalizeText(segment.id) || `segment-${index + 1}`,
      type: normalizeText(segment.type) === "final" ? "final" : "partial",
      text: normalizeText(segment.text),
      isFinal: Boolean(segment.isFinal || normalizeText(segment.type) === "final"),
      at: Number(segment.at || 0),
    }))
    .filter((segment) => segment.text);
}

function buildTranscriptSegments(payload = {}) {
  const realtimeSegments = normalizeSegments(payload.realtimeSnapshot?.transcript?.segments);
  if (realtimeSegments.length) {
    return realtimeSegments;
  }

  const finalTranscript = normalizeText(payload.finalTranscript || payload.userRequest || "");
  const partialTranscript = normalizeText(payload.partialTranscript || "");
  const pieces = [];

  if (partialTranscript) {
    pieces.push({
      id: "segment-partial-1",
      type: "partial",
      text: partialTranscript,
      isFinal: false,
      at: Date.now(),
    });
  }

  if (finalTranscript) {
    pieces.push({
      id: "segment-final-1",
      type: "final",
      text: finalTranscript,
      isFinal: true,
      at: Date.now(),
    });
  }

  return pieces;
}

function buildStreamAsrEnvelope(payload = {}) {
  const sessionId = normalizeText(payload.sessionId);
  const turnId = Number(payload.turnId || 0);
  const conversationMode = normalizeText(payload.conversationMode) || "standard";
  const realtimeTranscript = payload.realtimeSnapshot?.transcript || {};
  const transcript = {
    partialTranscript: normalizeText(payload.partialTranscript || realtimeTranscript.partialTranscript),
    finalTranscript: normalizeText(payload.finalTranscript || realtimeTranscript.finalTranscript || payload.userRequest),
    stableTranscript: normalizeText(realtimeTranscript.stableTranscript || payload.finalTranscript || payload.userRequest),
  };
  const audioInput = payload.realtimeSnapshot?.audioInput || null;
  const clientMetrics = payload.clientMetrics || payload.realtimeMetrics || null;
  const asrRuntime = payload.realtimeSnapshot?.asrRuntime || null;
  const vadRuntime = payload.realtimeSnapshot?.vadRuntime || null;
  const segments = buildTranscriptSegments(payload);

  return {
    protocol: "stream-asr-adapter/v1",
    provider: normalizeText(asrRuntime?.provider) || "browser-speech",
    mode: normalizeText(asrRuntime?.mode) || "stream-compatible",
    sessionId,
    turnId,
    conversationMode,
    transcript,
    segments,
    audioInput,
    clientMetrics,
    asrRuntime,
    vadRuntime,
    receivedAt: Date.now(),
  };
}

function describeStreamAsrEnvelope(envelope) {
  return {
    protocol: envelope.protocol,
    provider: envelope.provider,
    mode: envelope.mode,
    sessionId: envelope.sessionId,
    turnId: envelope.turnId,
    hasPartial: Boolean(envelope.transcript?.partialTranscript),
    hasFinal: Boolean(envelope.transcript?.finalTranscript),
    hasStable: Boolean(envelope.transcript?.stableTranscript),
    segmentCount: Array.isArray(envelope.segments) ? envelope.segments.length : 0,
    hasAudioInput: Boolean(envelope.audioInput),
    hasClientMetrics: Boolean(envelope.clientMetrics),
    hasVadRuntime: Boolean(envelope.vadRuntime),
  };
}

module.exports = {
  buildStreamAsrEnvelope,
  describeStreamAsrEnvelope,
};
