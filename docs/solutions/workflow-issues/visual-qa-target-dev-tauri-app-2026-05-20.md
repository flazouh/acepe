---
title: Visual QA must target the changed app build
date: 2026-05-20
last_updated: 2026-05-31
category: docs/solutions/workflow-issues
module: visual QA workflow
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - Verifying UI-visible changes in the Acepe desktop app
  - Multiple Acepe builds are installed or running at the same time
  - A dev Tauri app and production Acepe.app can both be opened by automation
  - Rust, Tauri command, or backend-backed viewport changes need visual QA
tags: [visual-qa, tauri, dev-app, production-app, workflow]
---

# Visual QA must target the changed app build

## Context

During visual QA for a session state fix, the automation opened `/Applications/Acepe.app`. That was the installed production app, not the running dev Tauri app from the current checkout. The production window showed a blank WebView, so the check did not prove anything about the code that had just changed.

## Guidance

Before clicking or inspecting any Acepe window, confirm that the target app is the build that contains the change.

For normal development QA, prefer the already-running dev app from the repo:

- Process path like `target/debug/acepe`
- Frontend served by the local dev server, commonly `localhost:1420`
- Tauri dev command already started by the user

Do not use `/Applications/Acepe.app` for dev-change QA unless the task explicitly asks to verify the installed production bundle.

Useful checks:

```bash
ps -axo pid,comm,args | rg -i "acepe|tauri|vite|bun.*dev"
lsof -nP -iTCP -sTCP:LISTEN | rg -i "acepe|vite|node|bun"
curl -I --max-time 2 http://localhost:1420/
```

Then attach the visual automation to the correct target. If the tool only exposes the production bundle, say visual QA is blocked instead of treating that as a pass.

When the change touches Rust/Tauri code, or when the current WebView gets stuck during QA, restart the dev server/dev app before testing again. A running window is not enough proof that the app contains the latest backend code or is in a healthy state.

Use this rule of thumb:

- Pure frontend change: HMR may be enough, but refresh/reconnect if the UI state is stuck.
- Rust or Tauri command change: restart the dev app so the binary is rebuilt and relaunched.
- A scroll/performance probe wedges the app or leaves high CPU: restart before retesting the fix.

If you do not restart in those cases, the result can be false: you may be testing the old binary, a stale WebView, or a runtime already damaged by the previous probe.

## Why This Matters

Visual QA is only useful when it observes the same build that contains the change. Opening the wrong app can create false confidence: tests may pass, the wrong window may render, and the actual dev UI may still be broken.

This is especially easy to miss in Tauri because there can be several valid-looking Acepe targets at once: the installed production bundle, the debug binary, the local frontend, and helper processes.

It is also easy to miss when the correct dev app is already open. The window may still be stale or wedged. For Rust-backed changes, the dev server restart is part of the proof, not cleanup after the proof.

## When to Apply

- Any UI-visible Svelte, Tauri, or app-shell change
- Any bug where the final proof is a visible screen state
- Any QA session where `Acepe.app` and `target/debug/acepe` may both exist

## Examples

Bad QA target:

```text
App=/Applications/Acepe.app/
```

This is the installed production bundle. It should not be used to verify a change made in the working tree.

Better QA target evidence:

```text
target/debug/acepe dev --no-default-features --features ...
node .../packages/desktop/node_modules/.bin/vite dev
HTTP/1.1 200 OK from localhost:1420
```

This proves the dev app and local frontend are running. The next step is to attach visual automation to that app or browser target.

Better restart evidence for Rust-backed QA:

```text
Stopped old bun/tauri/vite/target-debug processes
Started `bun run tauri dev` from packages/desktop
Confirmed target/debug/acepe relaunched and localhost:1420 is serving
```

After that, run the Tauri MCP or visual probe against the relaunched dev app.

## Related

- [AGENTS.md Visual QA guardrail](/AGENTS.md)
