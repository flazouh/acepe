---
name: acepe-dev-app-qa
description: "Required before visually inspecting or QAing the Acepe desktop dev app, current dev app, Tauri WebView, session display, agent panel, or any UI-visible Acepe change. Use when the user says the dev app looks wrong, asks to inspect the app, asks for visual QA, or when a change affects desktop UI."
argument-hint: "[optional: screen, session id, or bug description]"
---

# Acepe Dev App QA

Use this skill before any visual QA or app inspection for Acepe.

The normal path is **repo QA wrapper first**. The wrapper talks to the real dev
Tauri WebView while hiding raw MCP ceremony, keeping QA fast, compact, and
consistent. It can inspect DOM, screenshots, route, app state, and
Tauri-specific behavior in the same runtime the user sees.

## Wrapper-First Recipes (read first)

Use `packages/desktop/scripts/acepe-qa.ts` through the package script:

```bash
cd packages/desktop
bun run qa doctor
bun run qa observe
bun run qa reset-onboarding
bun run qa inspect --selector=.onboarding-preview-panel --limit=3
bun run qa click --selector=.theme-toggle
bun run qa screenshot
```

The wrapper handles driver startup, MCP wrapper unwrapping, compact summaries,
schema validation, and JSON artifacts under `/tmp`. It is the preferred path for
common actions: validating the dev target, resetting onboarding, inspecting DOM
selectors, clicking by selector/text, and taking screenshots.
Successful UI QA commands also update `.codex/state/ui-qa-evidence.json`; this
is the evidence stamp used by the Codex Stop hook to enforce that UI changes
were verified after the latest code edit.

Do not use direct Hypothesi/Tauri MCP CLI commands as the normal QA interface.
If the wrapper lacks a primitive, add a small command or helper under
`packages/desktop/scripts/acepe-qa/` and use that wrapper command for the QA
pass. This keeps driver startup, output unwrapping, evidence stamps, schema
validation, and target guardrails in one maintained path.

Common wrapper commands:

| Need | Command |
|---|---|
| Confirm dev target and bridge | `bun run qa doctor` |
| Summarize current app state | `bun run qa observe` |
| Inspect DOM facts | `bun run qa inspect --selector=<selector> --limit=3` |
| Click by selector or text | `bun run qa click --selector=<selector>` / `bun run qa click --text=<text>` |
| Type/send composer text | `bun run qa send --text=<message>` |
| Wait for visible text | `bun run qa watch --text=<text>` |
| Capture screenshot | `bun run qa screenshot` |
| Reset onboarding | `bun run qa reset-onboarding` |

If an interaction needs more detail than these commands expose, improve the
wrapper first. Repeated ad hoc raw MCP snippets are a workflow bug.

## Hard Rule

Do not open or inspect `/Applications/Acepe.app` for dev QA.

That is the installed production bundle. It does not prove anything about the current checkout.

For dev QA, inspect only one of these:

1. the repo QA wrapper attached to the running dev app from this checkout
2. the running Tauri dev app from this checkout, normally `packages/desktop/src-tauri/target/debug/acepe`
3. Computer Use attached to the dev Tauri window, only after proving it is not `/Applications/Acepe.app`

Do not run `bun dev`. The user manages the dev server — with one sanctioned
exception: if the built binary is stale relative to the Rust change you are
QA-ing, you may stop and restart the dev process so the rebuild picks up your
code (see Step 1b). Always note that you restarted it.

## Required Order

### 1. Confirm The Dev App Exists

Confirm the dev process is running from this repo:

```bash
ps aux | rg 'packages/desktop|target/debug/acepe|tauri dev|vite dev' | rg -v rg
```

Also check whether production Acepe is running, so you do not inspect the wrong app:

```bash
ps aux | rg '/Applications/Acepe.app|com.acepe.app|target/debug/acepe|tauri dev' | rg -v rg
```

If only `/Applications/Acepe.app` is visible, stop and tell the user dev QA is blocked because the dev Tauri window is not available.

### 1b. Verify The Built Binary Matches Your Changes (and restart if stale)

QA is only valid against a build that actually contains the code under test. The
two layers behave differently:

- **Frontend (`.svelte` / `.ts` under `packages/desktop/src`)** is hot-reloaded
  by Vite (~4s). No restart needed — just wait for HMR, then QA.
- **Rust (`packages/desktop/src-tauri/**/*.rs`)** requires a recompiled binary.
  `tauri dev` normally rebuilds + relaunches on a Rust change, but a build can be
  stale if the running binary predates your edit/commit, if the rebuild was never
  triggered, or if the watcher missed the change.

**Detect a stale binary** before trusting Rust-dependent QA:

```bash
BIN=packages/desktop/src-tauri/target/debug/acepe
# Any Rust source newer than the running binary ⇒ stale.
find packages/desktop/src-tauri/src -name '*.rs' -newer "$BIN" | head
# Or compare directly: binary build time vs your latest Rust commit time.
ls -l --time-style=+%s "$BIN" 2>/dev/null || stat -f '%m %N' "$BIN"
git log -1 --format='%ct %h %s' -- packages/desktop/src-tauri
```

If the binary mtime is older than the newest relevant `.rs` source/commit, the
running app does **not** contain your Rust change. Your QA result would be
meaningless (you'd be testing the old producer/backend).

**Sanctioned restart (the one exception to "the user manages the dev server").**
When — and only when — the binary is stale **and** your QA depends on a Rust
change that isn't in it, you may stop the running dev process and restart it so
the rebuild picks up your code. State clearly in your QA notes that you did this.

1. Identify the dev processes (do not guess — list them):

   ```bash
   ps aux | rg 'bun run tauri dev|tauri dev|vite dev|target/debug/acepe' | rg -v rg
   ```

2. Stop them with `kill <PID>` on the **specific PIDs** — never `pkill` /
   `killall` (forbidden, and they can hit unrelated processes). Kill the
   top-level launcher (`bun run tauri dev`) first; it cascades to the children.
   Kill the `acepe` binary PID too if it lingers.

   ```bash
   kill <bun-run-tauri-dev-PID> <vite-dev-PID> <acepe-binary-PID>
   ```

3. Restart from `packages/desktop` as a detached background process (use the
   exact command the user runs), redirecting output to a log:

   ```bash
   cd packages/desktop && (bun run tauri dev >/tmp/acepe-dev.log 2>&1 &)
   ```

4. Wait for the Rust rebuild to finish and the bridge to come back up before
   resuming QA (a debug rebuild can take a few minutes):

   ```bash
   # Poll for the bridge port to listen again (PID changes after relaunch).
   for i in $(seq 1 60); do
     PID=$(pgrep -f 'target/debug/acepe' | head -1)
     [ -n "$PID" ] && lsof -Pan -p "$PID" -iTCP 2>/dev/null | rg -q LISTEN && { echo "up: $PID"; break; }
     sleep 5
   done
   tail -5 /tmp/acepe-dev.log
   ```

5. Re-confirm freshness (Step 1b detection should now report no stale sources),
   then re-attach the driver session and continue the normal QA pass.

If you are unsure whether a restart is warranted, or the rebuild fails, stop and
tell the user rather than leaving the dev server down.

### 2. Use The QA Wrapper

Before trying Computer Use or a normal browser, use the repo QA wrapper from
`packages/desktop`. It is the maintained interface to the real dev Tauri
WebView and should be extended when a new QA primitive is needed.

Minimum useful QA pass:

1. `bun run qa doctor` to prove the dev app, bridge, WebView, and binary
   freshness.
2. `bun run qa observe` to capture compact route, panel, composer, and visible
   error facts.
3. `bun run qa inspect --selector=<selector>` or another wrapper primitive to
   inspect the affected state.
4. `bun run qa screenshot` for final visual evidence when the change is visual.

This wrapper-backed path is the best evidence because Acepe is a Tauri app. A
browser at `localhost:1420` does not include the real Tauri WebView runtime or
Tauri APIs.

If the wrapper cannot perform the needed action, improve
`packages/desktop/scripts/acepe-qa/` before repeating the same raw interaction.
Document the new wrapper primitive in this skill when it becomes part of normal
QA.

### 3. Use Computer Use Only As Fallback

Use Computer Use only after the repo QA wrapper is unavailable or blocked.

Before interacting, confirm the target window belongs to the dev binary.

Do not call Computer Use with app name `Acepe` unless you have already proved that the active Acepe window is the dev binary. App name alone often resolves to `/Applications/Acepe.app`.

If Computer Use attaches to `/Applications/Acepe.app`, stop immediately. Do not
inspect the screenshot or continue the QA pass there.

### 4. Do Not Use Localhost Browser QA

Do not use browser-only `localhost` evidence for Acepe desktop visual QA.

Acepe is a Tauri desktop app. A normal browser at `localhost:1420` does not run
inside the real Tauri WebView and does not prove Tauri APIs, app shell behavior,
desktop routing, runtime state, permissions, or session display.

If both the repo QA wrapper and safe dev-window Computer Use are unavailable, visual QA is
blocked. Report it as blocked instead of trying localhost.

## What To Capture

For every visual QA pass, capture enough evidence to prove what the user sees:

- target identity: dev binary path or QA wrapper target
- whether the QA wrapper was used; if not, why not
- screenshot or DOM summary of the affected screen
- console errors, if any
- current route or active session id, if relevant
- one or two concrete observations in plain language

## Session Display Bugs

For agent panel, transcript, session list, or tool-call display bugs:

- Invoke `god-architecture-check` before changing code.
- Do not fix order, identity, lifecycle, tool state, or transcript rows in Svelte.
- Create the red test at the Rust/provider/session-open/projection seam when the bug is product truth.
- TypeScript may only project canonical facts to display props.

## Final Report Template

Use this shape in the final answer:

```text
Dev app target: <path or QA wrapper target>
QA wrapper: <used / unavailable, with reason>
Visual QA: <what was seen>
Verified: <commands/tests>
Blocked: <only if the dev app or QA wrapper was unavailable>
```
