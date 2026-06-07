---
title: Acepe QA wrapper should hide raw Tauri MCP friction
date: 2026-06-07
category: docs/solutions/workflow-issues
module: visual QA workflow
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - Verifying Acepe desktop UI changes through the Tauri dev WebView
  - Repeating Dev Tools actions like resetting onboarding
  - Inspecting DOM state, computed animation state, or screenshots during design iteration
root_cause: raw_tool_choreography
resolution_type: workflow_improvement
tags: [visual-qa, tauri-mcp, qa-wrapper, dom-qa, workflow]
---

# Acepe QA wrapper should hide raw Tauri MCP friction

## Context

During onboarding UI iteration, visual QA repeatedly fell back to hand-written Tauri MCP calls:

- confirm dev process and bridge port
- start the driver session
- run raw `webview-execute-js`
- manually click Dev Tools
- manually click Reset Onboarding
- query DOM selectors with ad hoc JavaScript
- capture screenshots
- unwrap verbose MCP JSON payloads

Each step was valid, but the loop was too slow and noisy for design iteration. The user had to wait through tool choreography instead of seeing quick product feedback.

## Guidance

Use the repo QA wrapper first:

```bash
cd packages/desktop
bun run qa doctor
bun run qa reset-onboarding
bun run qa inspect --selector=.onboarding-preview-panel --limit=3
bun run qa screenshot
```

Prefer wrapper commands over direct `npx ... tauri-mcp` calls for normal Acepe UI QA.

The wrapper handles:

- starting/reusing the driver session
- unwrapping MCP payloads
- validating payloads with Zod
- returning compact text summaries
- writing JSON artifacts under `/tmp`
- preserving the dev-Tauri target guardrail

Use raw Tauri MCP only when the wrapper lacks the primitive needed for the current investigation. If a raw command is repeated twice, promote it into `packages/desktop/scripts/acepe-qa/`.

## What Slowed Us Down

The repeated time sinks were:

- **Target setup:** proving the running app was `target/debug/acepe`, not `/Applications/Acepe.app`.
- **Bridge setup:** rediscovering port `9223` and restarting the driver session.
- **Verbose output:** stripping duplicated MCP wrappers manually with `jq`.
- **Ad hoc DOM scripts:** rewriting selector, text, rect, animation, and screenshot probes every time.
- **UI navigation:** opening Dev Tools and resetting onboarding through repeated JS snippets.
- **Weak composition:** needing separate commands for state setup, DOM facts, and screenshots.

## Resolution

`packages/desktop/scripts/acepe-qa` now includes these primitives:

- `doctor` - validate dev target and WebView responsiveness
- `observe` - compact app facts
- `screenshot` - capture WebView screenshot
- `inspect --selector=...` - compact DOM inspection with rects, text, classes, visibility, and child animation names
- `click --selector=...` or `click --text=...` - click target elements by selector or visible/ARIA text
- `reset-onboarding` - open Dev Tools, reset onboarding, and return onboarding-specific facts

This gives future QA a dev-browser-like loop while still using the real Tauri WebView.

## When to Extend

Add more wrapper commands when a QA action becomes a repeated pattern, especially:

- open a specific dev overlay
- switch theme
- set onboarding step
- inspect computed styles for a selector
- capture screenshot plus DOM facts in one artifact
- type/send composer text

Keep wrappers small and schema-validated. They should reduce ceremony without hiding the evidence needed to trust the QA result.

## Related

- [Visual QA must target the changed app build](docs/solutions/workflow-issues/visual-qa-target-dev-tauri-app-2026-05-20.md)
- [DOM-first QA for CSS shape bugs](docs/solutions/workflow-issues/dom-first-qa-for-css-shape-bugs-2026-05-20.md)
