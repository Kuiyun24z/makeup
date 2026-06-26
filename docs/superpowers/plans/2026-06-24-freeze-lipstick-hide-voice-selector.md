# Freeze Lipstick And Hide Voice Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the frontend voice selector and lipstick slider, freeze lipstick voice commands, and preserve default Piper TTS playback plus the native GPUPixel lipstick parameter.

**Architecture:** Add a focused static regression test over the served frontend and server skill declaration. Remove only the user-facing selector and lipstick command entry points; keep TTS adapter construction and GPUPixel's lower-level parameter protocol unchanged.

**Tech Stack:** Node.js CommonJS, built-in `node:test`, HTML/CSS/vanilla JavaScript.

---

### Task 1: Regression tests for removed controls

**Files:**
- Create: `beauty-studio-site/control-surface.test.js`

- [ ] Write tests asserting the HTML has no voice selector or lipstick slider.
- [ ] Write tests asserting app.js has no voice preference or selector binding while still constructing `BrowserTtsAdapter`.
- [ ] Write tests asserting server.js has no lipstick skill while preserving the other GPUPixel skills.
- [ ] Run `node --test beauty-studio-site/control-surface.test.js` and verify it fails against the current implementation.

### Task 2: Remove frontend controls

**Files:**
- Modify: `beauty-studio-site/public/index.html`
- Modify: `beauty-studio-site/public/app.js`
- Modify: `beauty-studio-site/public/styles.css`

- [ ] Delete the voice selector markup, styling, option population, storage key, and change handler.
- [ ] Delete the lipstick range input and update the prompt example.
- [ ] Keep TTS initialization and speech event handling unchanged.
- [ ] Run the focused test and JavaScript syntax checks.

### Task 3: Freeze lipstick command skill

**Files:**
- Modify: `beauty-studio-site/server.js`
- Modify: `beauty-studio-site/mirror-voice.js`
- Modify: `beauty-studio-site/mirror-voice.test.js`

- [ ] Remove the lipstick entry from `GPUPIXEL_PARAM_SKILLS`.
- [ ] Remove unreachable lipstick response templates and their old test.
- [ ] Run all Beauty Studio Node tests and syntax checks.

### Task 4: Runtime verification

**Files:**
- Verify running services and frontend output.

- [ ] Restart `start-beauty-studio.ps1 -NoBrowser`.
- [ ] Verify the served HTML contains neither removed control.
- [ ] Send “加点口红” and confirm `lipstick` does not change.
- [ ] Send a supported command and confirm its parameter still changes, then restore the test value.
- [ ] Verify site, GPUPixel adapter, and native stream health endpoints.
