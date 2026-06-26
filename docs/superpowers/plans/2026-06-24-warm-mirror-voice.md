# Warm Mirror Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace numeric GPUPixel confirmations and clinical beauty advice with concise, warm, supportive Chinese responses while preserving the adjust-before-speak order.

**Architecture:** Add a focused CommonJS module that maps GPUPixel commands to direction-aware conversational feedback and exposes a reusable OpenHarness style instruction. `server.js` imports that module, uses the generated feedback after the parameter write succeeds, and injects the style instruction into the active OpenHarness prompt.

**Tech Stack:** Node.js CommonJS, built-in `node:test`, existing HTTP/NDJSON service.

---

### Task 1: GPUPixel conversational feedback

**Files:**
- Create: `beauty-studio-site/mirror-voice.js`
- Create: `beauty-studio-site/mirror-voice.test.js`

- [ ] **Step 1: Write failing tests**

Test that increase, decrease, and disable feedback is natural, contains no numeric value, and accurately describes the direction.

- [ ] **Step 2: Verify the test fails**

Run: `node --test beauty-studio-site/mirror-voice.test.js`

Expected: FAIL because `./mirror-voice` does not exist.

- [ ] **Step 3: Implement the feedback generator**

Add `buildGpupixelControlMessage(command)` with per-feature increase/decrease/off wording and deterministic variation selected from the command text.

- [ ] **Step 4: Verify the test passes**

Run: `node --test beauty-studio-site/mirror-voice.test.js`

Expected: all tests PASS.

### Task 2: Warm OpenHarness advice style

**Files:**
- Modify: `beauty-studio-site/mirror-voice.js`
- Modify: `beauty-studio-site/mirror-voice.test.js`
- Modify: `beauty-studio-site/server.js`

- [ ] **Step 1: Write failing style tests**

Test that the exported instruction requires a warm friend-like tone, positive-first advice, one to three sentences, no appearance anxiety, and no parameter-number narration.

- [ ] **Step 2: Verify the new test fails**

Run: `node --test beauty-studio-site/mirror-voice.test.js`

Expected: FAIL because the style instruction is not exported yet.

- [ ] **Step 3: Implement and integrate**

Export `WARM_MIRROR_STYLE_INSTRUCTION`, import it in `server.js`, use `buildGpupixelControlMessage()` after a successful GPUPixel write, and append the style instruction to the active `buildOpenHarnessPrompt()`.

- [ ] **Step 4: Run focused and syntax verification**

Run:

```powershell
node --test beauty-studio-site/mirror-voice.test.js
node --check beauty-studio-site/server.js
node --check beauty-studio-site/mirror-voice.js
```

Expected: all commands exit with code 0.

### Task 3: End-to-end streamed ordering and wording

**Files:**
- Verify: `beauty-studio-site/server.js`

- [ ] **Step 1: Restart the local stack**

Run: `D:\work\makeup\start-beauty-studio.ps1 -NoBrowser`

- [ ] **Step 2: Send a streamed beauty command**

POST “帮我提亮一点” to `/api/advice?stream=1`.

- [ ] **Step 3: Verify behavior**

Confirm the first relevant event is `gpupixel-control`, its message contains no decimal parameter value, the slider parameter has already changed, and subsequent advice uses concise supportive wording.

- [ ] **Step 4: Run final regression checks**

Run the focused test suite and JavaScript syntax checks once more.

Expected: all checks pass with no failures.
