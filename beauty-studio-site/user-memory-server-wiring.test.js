const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serverSource = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

test("server exposes user memory management endpoints", () => {
  assert.match(serverSource, /\/api\/user-memory\/profile/);
  assert.match(serverSource, /\/api\/user-memory\/consent/);
  assert.match(serverSource, /\/api\/user-memory\/reset/);
  assert.match(serverSource, /handleUserMemoryProfile/);
  assert.match(serverSource, /handleUserMemoryConsent/);
  assert.match(serverSource, /handleUserMemoryReset/);
});

test("server enriches OpenHarness advice payloads with beauty user memory", () => {
  assert.match(serverSource, /enrichPayloadWithBeautyUserMemory/);
  assert.match(serverSource, /summarizeBeautyUserProfileForPrompt/);
  assert.match(serverSource, /getNextOnboardingQuestion/);
  assert.match(serverSource, /updateBeautyUserBehaviorAdaptation/);
  assert.match(serverSource, /updateBeautyUserFeedbackReflection/);
  assert.match(serverSource, /summarizeBeautyUserFeedbackReflectionForPrompt/);
  assert.match(serverSource, /feedbackReflectionSummary/);
  assert.match(serverSource, /shouldAskOnboardingThisTurn/);
  assert.match(serverSource, /markOnboardingQuestionAsked/);
  assert.match(serverSource, /buildBeautyOpenHarnessPrompt\(enrichedPayload\)/);
});

test("server supports natural reset and opt-out phrases", () => {
  assert.match(serverSource, /shouldResetBeautyUserMemory/);
  assert.match(serverSource, /shouldDenyBeautyUserMemory/);
  assert.match(serverSource, /清空记忆/);
  assert.match(serverSource, /别记了/);
});

test("server enforces beauty capability boundaries after OpenHarness replies", () => {
  assert.match(serverSource, /require\("\.\/beauty-capabilities"\)/);
  assert.match(serverSource, /buildBeautyCapabilityContext/);
  assert.match(serverSource, /enforceBeautyCapabilityBoundary/);
  assert.match(serverSource, /enforceOpenHarnessReplyCapabilityBoundary/);
  assert.match(serverSource, /shouldBufferBeautyCapabilitySensitiveReply/);
  assert.match(serverSource, /const safeReplyText = enforceOpenHarnessReplyCapabilityBoundary/);
  assert.match(serverSource, /const safeFinalReplyText = enforceOpenHarnessReplyCapabilityBoundary/);
});
