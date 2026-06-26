# Beauty Studio Golden Development Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible Windows development bundle that can run the current Beauty Studio immediately and can also be rebuilt and modified.

**Architecture:** Keep the application rooted at `D:\work\makeup`, package source and verified binaries together, copy offline models into a portable `offline-assets` directory, and reconstruct the Python environment from locked dependency files. PowerShell scripts perform prerequisites checking, installation, packaging, and end-to-end verification.

**Tech Stack:** Windows PowerShell, Node.js, Python/Conda, uv, CMake/NMake, GPUPixel C++, FunASR, Piper TTS, OpenHarness.

---

### Task 1: Record The Reproducible Environment

**Files:**
- Create: `deployment/environment/openharness-environment.yml`
- Create: `deployment/environment/openharness-requirements.txt`
- Create: `deployment/environment/toolchain-versions.txt`

- [ ] Export the active Conda environment without build numbers.
- [ ] Export exact Python package versions.
- [ ] Record Node, CMake, Git, uv, Python and Conda versions.
- [ ] Verify the files contain no API keys.

### Task 2: Create Deployment And Security Documentation

**Files:**
- Create: `DEPLOYMENT.md`
- Create: `deployment/BUNDLE-CONTENTS.md`
- Create: `deployment/SECURITY-NOTICE.md`

- [ ] Document prerequisites and fixed installation paths.
- [ ] Document first installation and first launch.
- [ ] Document rebuild workflows for GPUPixel, OpenHarness and website code.
- [ ] Document shared-key handling and rotation.

### Task 3: Create Environment Check And Installation Scripts

**Files:**
- Create: `deployment/check-prerequisites.ps1`
- Create: `deployment/install-development-bundle.ps1`
- Create: `deployment/install-development-bundle.cmd`

- [ ] Check Windows tools and required paths.
- [ ] Create or update the `openharness` Conda environment.
- [ ] Restore the ModelScope cache from `offline-assets`.
- [ ] Verify the bundled GPUPixel executable and TTS model.
- [ ] Run smoke tests after installation.

### Task 4: Create Verification Scripts

**Files:**
- Create: `deployment/verify-deployment.ps1`
- Create: `deployment/verify-deployment.cmd`

- [ ] Run JavaScript syntax and unit tests.
- [ ] Run OpenHarness protocol and allowlist regressions.
- [ ] Run the beauty-vision plugin tests.
- [ ] Optionally start services and check all health endpoints.
- [ ] Report camera-process count.

### Task 5: Create The Repeatable Bundle Builder

**Files:**
- Create: `deployment/build-development-bundle.ps1`
- Create: `deployment/build-development-bundle.cmd`
- Create: `deployment/bundle-include.txt`
- Create: `deployment/bundle-exclude.txt`

- [ ] Stage only approved project directories and root files.
- [ ] Copy ModelScope FunASR assets to `offline-assets`.
- [ ] Exclude logs, caches, backups, deprecated modules and secrets outside the approved local config.
- [ ] Generate SHA-256 checksums and a file manifest.
- [ ] Create a compressed archive when requested.

### Task 6: Build And Verify The Actual Deliverable

**Files:**
- Create: `dist/makeup-development-bundle/`
- Create: `dist/makeup-development-bundle-manifest.csv`
- Create: `dist/makeup-development-bundle-sha256.txt`

- [ ] Run the bundle builder.
- [ ] Verify required files are present and excluded files are absent.
- [ ] Run deployment verification against the source workspace.
- [ ] Report final staged and compressed sizes.

