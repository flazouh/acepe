---
date: 2026-05-31
topic: agent-app-control-plane
---

# Agent App Control Plane

## Problem Frame

Acepe's current agent-to-app communication is too slow and too fragile for daily development. A normal QA pass often needs many shell commands, verbose Tauri MCP calls, manual wrapper cleanup, screenshots, log reads, and app identity checks. That makes future sessions waste time rediscovering the same target, same bridge port, same stale-binary checks, and same DOM probing patterns.

The better product direction is not "more screenshots". The better direction is a small, deterministic control plane that gives coding agents the same kind of structured app access that modern browser automation gives test runners: target discovery, compact snapshots, stable element refs, direct actions, logs, traces, and replayable scenarios.

Current Acepe evidence already points this way:

- `packages/desktop/scripts/qa-transcript-viewport-scroll.ts` proves a scenario-specific Tauri MCP CLI can produce compact JSON artifacts.
- `.github/skills/acepe-dev-app-qa/SKILL.md` proves the correct manual flow, but it is too much ceremony for every session.
- `docs/reports/2026-05-05-streaming-qa-incident-report.md` shows repeated Tauri MCP/WebView timeouts and the need for smaller probes.
- `docs/solutions/workflow-issues/visual-qa-target-dev-tauri-app-2026-05-20.md` shows that target identity must be proven before visual QA is trusted.

## External Inspiration

| Source | Useful Pattern For Acepe |
| --- | --- |
| Chrome DevTools Protocol | Structured command/event domains for DOM, Runtime, Network, Log, Performance, Tracing, and screenshots. |
| WebDriver BiDi | Bidirectional event-driven automation over WebSocket, not only request/response polling. |
| Playwright MCP | Accessibility-tree snapshots with stable refs, so agents click/type by semantic refs instead of pixels. |
| Playwright Trace Viewer | Evidence bundles that let a developer replay actions, DOM snapshots, logs, network, timing, and return values. |
| Appium | A standard automation API can sit above many app platforms through drivers. |
| MCP | Standard host/client/server split with tools, resources, logging, progress, cancellation, and user-control expectations. |
| `agent-browser` | Practical CDP CLI pattern: open, snapshot refs, interact by refs, batch commands, screenshot, network, diff, persistent state. |
| `dev-browser` | Lightweight persistent browser automation concept; useful as a simple mental model for website/browser-only flows. |
| AXI | Agent-facing CLI ergonomics: compact default output, structured errors, no prompts, content-first home view, explicit next steps, and session hooks. |

## Recommended Direction

Build an Acepe-specific **agent app control plane** with one shared core and two front doors:

```text
Agent / human
     |
     v
+----------------------+      +----------------------+
| acepe-qa CLI          |      | acepe-dev MCP server |
| deterministic scripts |      | interactive tools    |
+----------+-----------+      +-----------+----------+
           \                      /
            \                    /
             v                  v
        +------------------------------+
        | shared Acepe probe core       |
        | target, observe, act, logs,   |
        | scenarios, artifacts          |
        +---------------+--------------+
                        |
                        v
        +------------------------------+
        | real dev Tauri WebView        |
        | bridge 9223, app state, DOM,  |
        | console, screenshots, IPC     |
        +------------------------------+
```

The CLI should be the fastest path for repeatable checks. The MCP server should expose the same core for interactive sessions when the agent needs to inspect, click, or diagnose live state.

`agent-browser` and `dev-browser` should be treated as inspiration and fallback tools, not the core Acepe desktop QA path. They automate Chromium/browser targets well, but Acepe's desktop behavior depends on the real Tauri WebView, Tauri IPC, app shell state, and the dev binary. AXI should directly shape the CLI contract because `acepe-qa` is primarily an agent-facing command-line tool.

## Requirements

**Target And Health**
- R1. The control plane must identify the real dev app before any QA action: process path, frontend URL, Tauri bridge port, production-app absence, and binary freshness when Rust-backed behavior is being tested.
- R2. The control plane must fail closed when only `/Applications/Acepe.app` is available. It must not silently fall back to production-app QA.
- R3. A single doctor command must summarize whether the app is usable for agent QA, including stale Rust binary signals, WebView responsiveness, bridge availability, and recent console errors.

**Observation**
- R4. Observation must prefer compact structured data over screenshots: route, selected session, focused panel, panel titles, visible errors, composer state, relevant accessibility refs, and console summary.
- R5. Screenshots must still be available, but as evidence artifacts with paths, not as the primary reasoning channel.
- R6. Observations must support levels of detail: `summary`, `focused`, and `raw`. The default must be small enough to paste into an agent context without dumping the whole DOM.

**Action**
- R7. Actions must use stable refs or named targets where possible, not screen coordinates.
- R8. The control plane must include safe high-level actions for common Acepe flows: choose project, start panel, type composer text, send, click retry/error, open session, close panel, and capture current state.
- R9. Contenteditable composer input must be handled by a proven helper path, with the result verified from real `textContent` and send-button state.

**Scenarios**
- R10. Repeatable scenarios must be first-class. A scenario should run one named workflow and emit a compact pass/fail JSON artifact plus optional screenshot.
- R11. Initial scenario set should cover the workflows that have wasted the most time: first-send failure recovery, Codex/Copilot session send, transcript viewport scroll/follow, historical session open, and permission/question display.
- R12. Scenario output must include enough evidence to debug failures without rerunning immediately: target identity, command timings, DOM/accessibility facts, console errors, screenshots when useful, and the exact failure reason.

**CLI And MCP Shape**
- R13. The shared probe core must power both a CLI and an MCP server so future sessions can use whichever interface is available without duplicating logic.
- R14. The CLI should expose stable commands such as `doctor`, `observe`, `act`, `scenario`, `logs`, and `screenshot`.
- R15. The MCP server should expose the same operations as small tools and resources, not one giant "execute arbitrary JS" escape hatch as the normal path.
- R16. Arbitrary JavaScript execution may exist for trusted debugging, but it must be labeled unsafe and should not be required for common QA.
- R17. CLI stdout must follow AXI-style output: compact by default, structured, no interactive prompts, useful empty states, structured errors, and clear hints for the next command.
- R18. List-style CLI output must avoid dumping large DOM trees. It should expose small schemas by default and require explicit flags for raw/full output.

**Evidence And Workflow**
- R19. Every command that performs QA must write a small evidence bundle under `/tmp` or another configured artifact directory and print the path.
- R20. The output format must be optimized for agents: short terminal summary, structured artifact, and optional human screenshot.
- R21. Skills should be updated so future Acepe sessions use the control plane first, then fall back to raw Tauri MCP only when the control plane cannot answer the question.

**Security And Trust**
- R22. The control plane must be dev-only unless explicitly enabled. It must not expose broad app control in production builds by accident.
- R23. Dangerous operations, especially arbitrary code execution, filesystem reads beyond evidence artifacts, or app restarts, must be explicit and visible in output.
- R24. MCP tool descriptions must be treated as part of the trust boundary. The server should expose small named tools with clear behavior rather than vague powerful tools.

## Success Criteria

- A future session can run one command to answer "am I attached to the right Acepe dev app?"
- A future session can run a named QA scenario without manually composing Tauri MCP shell snippets.
- A normal UI QA pass returns a compact summary, a JSON artifact, and a screenshot path in under a few seconds when the app is healthy.
- The agent no longer needs to dump large DOM snapshots or repeat bridge-port discovery on every pass.
- When the WebView is wedged, the control plane reports that directly instead of producing misleading evidence.
- The skill instructions become shorter because they point to the control plane instead of encoding a long manual recipe.

## Scope Boundaries

- This is not a replacement for unit, integration, Rust, or Svelte tests.
- This is not a production telemetry feature.
- This should not make browser-only `localhost:1420` QA acceptable for Tauri-specific behavior.
- This should not require a new visual design surface in Acepe.
- This should not standardize on one third-party MCP server as product truth. Third-party tools can be adapters under the Acepe probe core.

## Key Decisions

- Build CLI first, MCP second: CLI scenarios are faster, easier to test, and better for deterministic evidence. MCP should wrap the same core for interactive agent sessions.
- Use structured snapshots before screenshots: this matches Playwright MCP and WebDriver/Appium patterns, and it avoids agents guessing from pixels.
- Keep Tauri WebView as the primary target: Acepe desktop behavior depends on Tauri APIs that normal browser automation cannot prove.
- Treat raw `webview-execute-js` as a lower-level escape hatch: powerful, but too easy to overuse and too expensive to repeat manually.
- Use AXI for CLI design: `acepe-qa` should be built for agents first, with small default output and explicit detail commands.
- Treat `agent-browser` as a benchmark for ergonomics: especially ref-based snapshots, batch commands, screenshots, diff, network-like summaries, and persistent target state.

## Dependencies / Assumptions

- The Tauri MCP bridge remains available in the dev app, normally on port `9223`.
- `@hypothesi/tauri-mcp-cli` can remain an adapter dependency at first.
- The existing `qa:transcript-viewport-scroll` script can be used as a seed pattern, but the final core should not be one scenario hardcoded into one script.
- Playwright remains useful for website-style/browser-only checks, but Acepe desktop QA needs the real Tauri WebView.
- `agent-browser` may be useful for Acepe website routes or browser-only comparisons, but cannot be the proof surface for Tauri IPC or desktop WebView behavior.
- `dev-browser` may be useful when a persistent generic browser is enough, but its documented skill surface is currently thinner than `agent-browser`.

## Research References

- Chrome DevTools Protocol: https://chromedevtools.github.io/devtools-protocol/
- WebDriver BiDi reference: https://developer.mozilla.org/en-US/docs/Web/WebDriver/Reference/BiDi
- Playwright MCP: https://playwright.dev/docs/getting-started-mcp
- Playwright debugging and Trace Viewer: https://playwright.dev/docs/debug
- Appium architecture: https://appium.io/docs/en/3.3/intro/appium/
- Model Context Protocol specification: https://modelcontextprotocol.io/specification/2025-06-18

## Outstanding Questions

### Resolve Before Planning
- None.

### Deferred to Planning
- [Affects R13-R15][Technical] Decide whether the MCP server should be a Node/Bun process wrapping the CLI core, a Rust sidecar, or a small server inside the Tauri dev process.
- [Affects R10-R12][Technical] Define the first scenario DSL shape: TypeScript functions, JSON scenario files, or a small command vocabulary.
- [Affects R17-R18][Technical] Decide whether CLI stdout should use TOON, JSON, or a dual-mode `--format` option while keeping artifacts as JSON.
- [Affects R19-R20][Technical] Choose artifact directory and retention policy.
- [Affects R22-R24][Security] Decide which unsafe operations require explicit command flags.

## Next Steps

-> `mode:headless docs/brainstorms/2026-05-31-agent-app-control-plane-requirements.md`
-> `/ce:plan docs/brainstorms/2026-05-31-agent-app-control-plane-requirements.md`
