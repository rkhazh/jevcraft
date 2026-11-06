# Standalone Tolik Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline.

**Goal:** Launch standalone Tolik with a real Hermes planner, the existing OpenAI subscription, JevCraft tactics and retained Persona Lab character/memory/voice.

**Architecture:** Milestone-triggered Hermes plans run concurrently with the native Jev body. A small Python runtime validates plans, submits fresh leased goals, preserves conversation and verified events, and captures vision. The old NetTyan planner is not imported.

**Tech Stack:** Python standard library runtime, isolated Hermes Python environment, Node/Mineflayer body, SQLite, existing SVC transport.

**Spec:** `docs/tolik-hermes-design.md`

## Global constraints

- No NetTyan installation needed by the new runtime; no credential extraction code.
- Preserve exact Tolik character, existing account/world/authority and dated memory.
- No canned actions, false completion, paid OpenAI API fallback or duplicate controllers.
- Native admission, freshness, cancellation and survival remain authoritative.
- Keep local config, history, images, logs and credentials ignored.

## Review focus

- A new request during slow inference must retain both messages and invalidate old physical proposals.
- A timed-out submission must not retry with a new goal ID.
- Rejected action must not suppress an otherwise valid conversational answer.
- Disconnect/timeout must terminate the owned planner and body processes.
- Memory import must preserve the source and never treat old commands as new events.

### Task 1: Standalone context and memory

Files: `tolik/memory.py`, `tolik/profile.json`, `tolik/test_runtime.py`.
Interface: `Memory(path).import_lab(source)`, `record(event)`, `recent(limit)`.
- [x] Test idempotent import, actual provenance and no source writes.
- [x] Implement bounded historical memory projection and new event journal.
- [x] Export the configured Tolik identity/motivations without importing NetTyan at runtime.
- [x] Verify tests and commit.

### Task 2: Planner and body boundary

Files: `tolik/planner.py`, `tolik/body.py`, `tolik/runtime.py`, `tolik/test_runtime.py`.
Interface: `Planner.start(context)`, `poll()`, `close()`; `Runtime.tick()`.
- [x] Test current/session fences, active work preservation, independent speech, uncertain submissions and bounded plan validation before implementation.
- [x] Implement actual Hermes invocation with explicit subscription provider, bounded output, timeout and owned-process cleanup.
- [x] Implement a new milestone loop with no import of the old persona scheduler.
- [x] Keep native goal validation as authority; archive actual response/errors and results.
- [x] Verify tests, real subscription smoke and commit.

### Task 3: Standalone launch and Persona Lab features

Files: `tolik/__main__.py`, `tolik/voice.py`, `tolik/svc_client.py`, `tolik/README.md`, `tolik/config.example.json`.
- [x] Test launch configuration/secrets exclusion, shutdown and vision freshness.
- [x] Reuse existing SVC transport with attribution, supply standalone HTTP ASR/TTS adapters.
- [x] Add local-only migration/bootstrap, bounded launch, status and stop commands.
- [x] Pin Hermes source and document installation, authentication and optional voice.
- [x] Verify original regression suites plus new standalone tests and commit.

### Task 4: Live qualification and delivery

- [x] Run one real bounded Tolik session on current account and standing authority.
- [x] Record exact planner/actions/chat, verified results, images, time and usage.
- [x] Review complete change, resolve important defects with regressions.
- [x] Push the source branch to the requested fork; link result and honest limits.

## Execution record

- Fork created and reference source inspected; builder review: nothing important left.
- Baseline regression suites passed with loopback access: 492 JevCraft and 481 Persona Lab tests.
- Final prelaunch qualification: 494 JevCraft and 44 standalone tests passed; Python compilation, shell syntax and diff checks passed.
- Independent runtime review resolved stale plans, voice lifecycle/delivery, actual historical memory import, inspection image delivery, subscription usage accounting and safe owned shutdown. Failed-first regressions cover the fixes.
- Actual Hermes subscription smoke returned a Russian Tolik response in one API call; credentials remain in the ignored isolated Hermes home.
- Standalone migration retained 166 dated records, current body/authority state and local vision assets. No NetTyan runtime import.
- User explicitly chose standalone Tolik in the JevCraft fork.

- Live run 20261106T214147.626737Z: 24 real Hermes responses, 13 sent speech receipts and eight verified movement goals; stopped at its call cap after 267.9 seconds.
- Initial venv-interpreter launch failure reproduced with a real environment regression and corrected before the successful run.
- Permission attribution prompt clarified after one unsupported server-protection claim; real text-only recorded replay returned the correct local-scope explanation.
- Published implementation commits 99e8a50 and eb7a331 to rkhazh/jevcraft:tolik-hermes. See docs/tolik-hermes-result-2026-11-07.md for exact outcomes and limits.
