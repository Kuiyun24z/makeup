# OpenHarness Visual Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let OpenHarness autonomously inspect the current GPUPixel beauty frame through a custom tool and show real, in-chat visual-analysis progress using waiting design A.

**Architecture:** A dedicated OpenHarness plugin exposes `inspect_current_beauty_frame` and calls a localhost-only Beauty Studio endpoint. The Node server owns frame retrieval, Ark vision analysis, per-turn execution limits, and NDJSON progress events. The frontend renders `vision-progress` as a temporary thinking bubble and never speaks progress messages.

**Tech Stack:** Node.js CommonJS and `node:test`, vanilla browser JavaScript/CSS, Python 3 with Pydantic and OpenHarness `BaseTool`.

---

### Task 1: Vision request registry and prompt helpers

**Files:**
- Create: `beauty-studio-site/current-frame-vision.js`
- Create: `beauty-studio-site/current-frame-vision.test.js`

- [ ] Write failing tests for one-use request registration, progress emission, expiration, and the structured Ark prompt.
- [ ] Run `node --test beauty-studio-site/current-frame-vision.test.js` and verify failure because the module is missing.
- [ ] Implement the minimal registry and prompt helpers.
- [ ] Run the test and verify all cases pass.

### Task 2: OpenHarness visual plugin

**Files:**
- Create: `.ohmo-beauty-studio/state.json`
- Create: `.ohmo-beauty-studio/soul.md`
- Create: `.ohmo-beauty-studio/plugins/beauty-vision/plugin.json`
- Create: `.ohmo-beauty-studio/plugins/beauty-vision/tools/inspect_current_beauty_frame.py`
- Create: `.ohmo-beauty-studio/plugins/beauty-vision/tests/test_inspect_current_beauty_frame.py`
- Modify: `beauty-studio.local.ps1`

- [ ] Write a failing Python test for the tool schema, localhost request payload, successful result, and HTTP failure result.
- [ ] Run the focused Python test and verify it fails because the plugin tool is absent.
- [ ] Implement the read-only OpenHarness tool with one localhost POST and bounded timeout.
- [ ] Configure `OHMO_WORKSPACE` to the project-local dedicated workspace.
- [ ] Run the plugin test and OpenHarness plugin-loader verification.

### Task 3: Beauty Studio vision endpoint and OpenHarness event bridge

**Files:**
- Modify: `beauty-studio-site/server.js`
- Modify: `beauty-studio-site/current-frame-vision.test.js`

- [ ] Add failing static/integration tests for `/api/vision/inspect-current-frame`, `tool_started`, `tool_completed`, `vision-progress`, and the tool-use instruction in the OpenHarness prompt.
- [ ] Add binary retrieval for GPUPixel `/latest.jpg` with timeout and size limits.
- [ ] Add Ark current-frame analysis using the configured Doubao vision model.
- [ ] Register one visual execution per request ID and emit `capturing`, `analyzing`, `composing`, or `failed`.
- [ ] Forward OpenHarness `tool_started` and `tool_completed` events to the pending website request.
- [ ] Run Node tests and syntax checks.

### Task 4: Waiting design A frontend

**Files:**
- Modify: `beauty-studio-site/public/app.js`
- Modify: `beauty-studio-site/public/styles.css`
- Modify: `beauty-studio-site/control-surface.test.js`

- [ ] Add failing tests requiring a real `vision-progress` handler and thinking-bubble styles.
- [ ] Render a temporary assistant bubble titled “魔镜正在看看你” with animated dots, an indeterminate bar, and the current stage.
- [ ] Remove the bubble when answer deltas arrive, the request completes, fails, or is interrupted.
- [ ] Keep progress text out of TTS.
- [ ] Run frontend regression tests and syntax checks.

### Task 5: End-to-end verification

**Files:**
- Verify the running stack.

- [ ] Restart `start-beauty-studio.ps1 -NoBrowser`.
- [ ] Verify OpenHarness reports the `inspect_current_beauty_frame` tool starting for a visual question.
- [ ] Verify the event order includes `deciding`, `capturing`, `analyzing`, and `composing`.
- [ ] Verify “什么是圆脸” can answer without a visual tool call.
- [ ] Verify “帮我提亮一点” adjusts GPUPixel without visual analysis and restore test parameters.
- [ ] Verify no image file is created and all local health checks remain ready.
