---
name: acepe-dev-app-qa
description: "Required before visually inspecting or QAing the Acepe desktop dev app, current dev app, Electrobun WebView, session display, agent panel, or any UI-visible Acepe change. Use when the user says the dev app looks wrong, asks to inspect the app, asks for visual QA, or when a change affects desktop UI."
argument-hint: "[optional: screen, session id, or bug description]"
---

# Acepe Dev App QA

Use this skill before any visual QA or app inspection for Acepe.

The normal path is **repo QA wrapper first**. The wrapper talks to the real
Electrobun WebView while hiding raw MCP ceremony, keeping QA fast, compact, and
consistent. It can inspect DOM, screenshots, route, app state, and
Electrobun-specific behavior in the same runtime the user sees.

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

Do not use direct Hypothesi/Electrobun QA CLI commands as the normal QA interface.
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

In a multi-panel workspace, generic `send` and `watch` calls are insufficient
unless their selectors are scoped beneath a previously proven panel root.
Numeric selector indexes are diagnostic helpers only; they are not stable
session or provider identity.

## Hard Rule

**After every UI-affecting change, DOM verification through the QA CLI is mandatory
before the task is done.** Tests and typecheck do not replace inspecting the real
dev WebView.

Minimum pass from `packages/desktop`:

1. `bun run qa doctor`
2. `bun run qa observe` (or navigate to the affected screen first)
3. **`bun run qa inspect --selector=<selector>`** — pick a selector that proves the
   change; cite the returned DOM facts in your summary
4. `bun run qa screenshot` when the change is visual or layout-related

The QA action must prove the behavior that changed:

- Static visual/style changes may pass with inspect + screenshot.
- Interaction bugs must run the interaction through `click`, `send`, `watch`, or
  a dedicated QA command, then inspect the resulting DOM/app state.
- Timing, scroll, streaming, animation, and layout-transition bugs must run a
  probe that samples the transition after the code change. A static `inspect` or
  screenshot is not enough.
- Horizontal containment bugs must be checked at the narrowest supported panel
  width. Inspect stable container and control hooks and prove every visible
  control stays within the container (`child.left >= container.left` and
  `child.right <= container.right`); a screenshot alone is not sufficient.
- If a plan names a QA probe, that probe is mandatory completion evidence.
- If the needed app/session state is unavailable, report behavioral QA as
  blocked and say what static evidence was collected. Do not call static DOM
  inspection a pass for the behavior.

Record evidence via the wrapper (`.codex/state/ui-qa-evidence.json`).

## Evidence Integrity: Prove The Exact Target

For session, provider, or multi-panel QA, first prove the identity of the exact
panel under test. A successful action or matching text somewhere else in the
WebView is not evidence.

Before interacting, capture all available target facts:

- canonical session id
- provider/agent id
- panel id or a stable panel-root selector
- visible header/icon/title that distinguishes the target

Then scope the action **and** every assertion to that same panel root.

Hard evidence rules:

- Never treat keyboard focus, visual position, "first composer", or a selector
  index as provider/session identity. Panel order changes during open, close,
  fullscreen, hydration, and HMR.
- Never use a global `watch --text` result as proof in a multi-panel workspace.
  The same text may exist in another panel, the sidebar, the submitted user
  prompt, or stale history.
- Do not put the exact expected response in the prompt. Use a construction such
  as `Return the word formed by S U C C E S S without spaces`, then assert the
  contiguous response only inside the target transcript.
- Inspect the target transcript subtree after the action. Prove the submitted
  user row and the distinct agent response row belong to the same session.
- Inspect errors inside the same target panel. `visible errors: 0` globally is
  supporting evidence only, not target-scoped proof.
- For provider-specific QA, the final screenshot must show enough identity and
  result together to connect them: provider icon/name or session header plus the
  resulting transcript/error state.
- If the wrapper cannot target a panel by stable session/provider identity,
  improve the wrapper first. Do not substitute `--selector-index`, focus, or
  manual visual guessing and call the result verified.
- If target identity cannot be proven, report QA as blocked or invalid. Tests
  may still pass, but do not describe live app behavior as verified.
- If the user identifies the wrong target, immediately invalidate the earlier
  evidence and rerun from target identification. Do not defend or reuse it.

Minimum session/provider evidence chain:

```text
identify exact panel (session id + provider)
  -> target its composer by stable panel identity
  -> perform the action
  -> inspect response/error inside the same panel subtree
  -> capture screenshot showing target identity and result together
```

Do not open or inspect `/Applications/Acepe.app` for dev QA.

That is the installed production bundle. It does not prove anything about the current checkout.

For dev QA, inspect only one of these:

1. the repo QA wrapper attached to the running Electrobun app from this checkout
2. the Electrobun app from this checkout, normally `packages/desktop/electrobun-build/stable-macos-arm64/Acepe.app`
3. Computer Use attached to that Electrobun window, only after proving it is not `/Applications/Acepe.app`

If the app is not running, build it from `packages/desktop` with `bun run electrobun:build`
and open the resulting `Acepe.app`. Acepe has no Rust and no Tauri. Always
note when you started or rebuilt it.

## Required Order

### 1. Confirm The Dev App Exists

Confirm the dev process is running from this repo:

```bash
ps aux | rg 'packages/desktop/electrobun-build|electrobun|vite dev' | rg -v rg
```

Also check whether production Acepe is running, so you do not inspect the wrong app:

```bash
ps aux | rg '/Applications/Acepe.app|com.acepe.app|electrobun-build' | rg -v rg
```

If only `/Applications/Acepe.app` is visible, stop and tell the user dev QA is blocked because the Electrobun app from this checkout is not available.

### 1b. Verify The Built App Matches Your Changes

QA is only valid against a build that actually contains the code under test.

- **Frontend (`.svelte` / `.ts` under `packages/desktop/src`)** can use the Vite
  dev server when the Electrobun window loads `localhost:1420`. Wait for HMR,
  then QA.
- **Electrobun shell (`packages/desktop/src/bun` and `packages/electrobun-shell`)**
  needs `bun run electrobun:build` and a new open of the app.

Acepe has no Rust binary. Do not look under `src-tauri`.

### 2. Use The QA Wrapper

Before trying Computer Use or a normal browser, use the repo QA wrapper from
`packages/desktop`. It is the maintained interface to the real Electrobun
WebView and should be extended when a new QA primitive is needed.

Minimum useful QA pass (required after UI-affecting changes):

1. `bun run qa doctor` to prove the dev app, bridge, WebView, and binary
   freshness.
2. `bun run qa observe` to capture compact route, panel, composer, and visible
   error facts.
3. **`bun run qa inspect --selector=<selector>`** — mandatory DOM verification;
   choose a selector that proves the change landed; include key facts in your
   report.
4. `bun run qa screenshot` for final visual evidence when the change is visual.

Evidence must match the bug. For interaction-driven bugs, run `click`, `send`,
`watch`, or a dedicated scenario probe and report which user action was
performed, what changed in the DOM/app state, and where the artifact is. For
timing, scroll, streaming, animation, or layout-transition bugs, a static DOM
snapshot is not sufficient; run a transition-sampling probe after the code
change. If that probe is blocked by app/session state, report it as blocked
instead of downgrading to static DOM evidence.

This wrapper-backed path is the best evidence because Acepe is an Electrobun app. A
browser at `localhost:1420` does not include the real Electrobun WebView runtime or
Electrobun APIs.

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

Acepe is an Electrobun desktop app. A normal browser at `localhost:1420` does not run
inside the real Electrobun WebView and does not prove Electrobun APIs, app shell behavior,
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
- provider id and stable panel identity for session/provider QA
- selector or panel root used to scope both the action and assertion
- one or two concrete observations in plain language

## Session Display Bugs

For agent panel, transcript, session list, or tool-call display bugs:

- Invoke `god-architecture-check` before changing code.
- Do not fix order, identity, lifecycle, tool state, or transcript rows in Svelte.
- Create the red test at the provider/session-open/projection seam when the bug is product truth.
- TypeScript may only project canonical facts to display props.

## Final Report Template

Use this shape in the final answer:

```text
Dev app target: <path or QA wrapper target>
QA wrapper: <used / unavailable, with reason>
Visual QA: <what was seen>
Target proof: <session id + provider id + stable panel selector/header>
Scoped evidence: <action and assertion inside that target>
Verified: <commands/tests>
Blocked: <only if the dev app or QA wrapper was unavailable>
```
