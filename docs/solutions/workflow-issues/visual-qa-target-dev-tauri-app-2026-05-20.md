---
title: Visual QA must target the changed app build
date: 2026-05-20
category: docs/solutions/workflow-issues
module: visual QA workflow
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - Verifying UI-visible changes in the Acepe desktop app
  - Multiple Acepe builds are installed or running at the same time
  - A dev Tauri app and production Acepe.app can both be opened by automation
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

## Why This Matters

Visual QA is only useful when it observes the same build that contains the change. Opening the wrong app can create false confidence: tests may pass, the wrong window may render, and the actual dev UI may still be broken.

This is especially easy to miss in Tauri because there can be several valid-looking Acepe targets at once: the installed production bundle, the debug binary, the local frontend, and helper processes.

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

## Related

- [AGENTS.md Visual QA guardrail](/AGENTS.md)
