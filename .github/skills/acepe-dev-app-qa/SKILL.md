---
name: acepe-dev-app-qa
description: "Required before visually inspecting or QAing the Acepe desktop dev app, current dev app, Electrobun WebView, session display, agent panel, or any UI-visible Acepe change. Use when the user says the dev app looks wrong, asks to inspect the app, asks for visual QA, or when a change affects desktop UI."
argument-hint: "[optional: screen, session id, or bug description]"
---

# Acepe Dev App QA

Use this skill before any visual QA or app inspection for Acepe.

The normal path is **`bun run qa` first**. It wraps the `electrobun-qa` CLI in
`packages/electrobun-qa`, which reaches the real Electrobun WebView over a unix
socket at `/tmp/electrobun-qa/<app-id>.sock`. Unsigned builds open that socket
through a preload; signed builds carry none of it. There is no debugging port
and no Tauri bridge.

## Recipes (read first)

```bash
cd packages/desktop
bun run qa doctor   # window title, url, count
bun run qa help     # every helper and its signature

bun run qa run <<'EOF'
cliLog(await snapshotText('[data-sidebar-project-surface]'))
await click({ selector: '[data-testid="project-header"]' })
await waitForText('Untitled session')
cliLog(await pageInfo())
EOF
```

`run` executes a heredoc script with the helpers already in scope, so one round
trip gives you real control flow and structured values instead of a chain of
one-shot verb commands.

A successful `bun run qa run` writes `.codex/state/ui-qa-evidence.json`, the
stamp the Codex Stop hook checks to enforce that UI changes were verified after
the latest code edit. `doctor` does not stamp, because it proves only that a
window exists.

Helper groups:

| Group | Helpers |
|---|---|
| Windows | `listWindows`, `firstWindow`, `useWindow`, `windowInfo` |
| Observation | `snapshotText`, `snapshotDom`, `pageInfo` |
| Interaction | `click`, `doubleClick`, `hover`, `typeText`, `fillInput`, `pressKey`, `pasteText`, `scrollBy` |
| Waiting | `waitForText`, `waitForSelector`, `waitForIdle`, `wait` |
| Evaluation | `js`, `queryAll` |

Two things worth knowing before you write a script. `pressKey` dispatches
synthetic key events that terminal emulators drop, so use `pasteText` for
xterm.js and other rich text surfaces. `captureScreenshot` is disabled on
purpose: DOM facts are the evidence, and a picture cannot tell you whether a
404 came from the framework or the router.

If a helper is missing, add it to `packages/electrobun-qa`. Repeated ad hoc
snippets around the CLI are a workflow bug.

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
2. `bun run qa run` with a script that reaches the affected screen and reads the
   element or region proving the change; cite the returned DOM facts in your
   summary

The QA action must prove the behavior that changed:

- Static visual/style changes may pass with a `snapshotText`, `snapshotDom`, or
  `js` read of the changed element, including computed styles and rects.
- Interaction bugs must drive the interaction with `click`, `typeText`,
  `pasteText`, or `waitForText` in the same script, then read the resulting DOM.
- Timing, scroll, streaming, animation, and layout-transition bugs must run a
  script that samples the transition after the code change. A single static read
  is not enough.
- Horizontal containment bugs must be checked at the narrowest supported panel
  width. Read stable container and control hooks and prove every visible
  control stays within the container (`child.left >= container.left` and
  `child.right <= container.right`).
- If a plan names a QA probe, that probe is mandatory completion evidence.
- If the needed app/session state is unavailable, report behavioral QA as
  blocked and say what static evidence was collected. Do not call static DOM
  inspection a pass for the behavior.

A successful `bun run qa run` records the evidence stamp
(`.codex/state/ui-qa-evidence.json`).

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
- Never use an unscoped `waitForText` result as proof in a multi-panel
  workspace. The same text may exist in another panel, the sidebar, the
  submitted user prompt, or stale history.
- Do not put the exact expected response in the prompt. Use a construction such
  as `Return the word formed by S U C C E S S without spaces`, then assert the
  contiguous response only inside the target transcript.
- Inspect the target transcript subtree after the action. Prove the submitted
  user row and the distinct agent response row belong to the same session.
- Inspect errors inside the same target panel. `visible errors: 0` globally is
  supporting evidence only, not target-scoped proof.
- For provider-specific QA, the final read must show enough identity and result
  together to connect them: provider icon/name or session header plus the
  resulting transcript/error state, all inside the same panel subtree.
- If you cannot target a panel by stable session/provider identity, add the hook
  the script needs. Do not substitute a nth-of-type index, focus, or manual
  visual guessing and call the result verified.
- If target identity cannot be proven, report QA as blocked or invalid. Tests
  may still pass, but do not describe live app behavior as verified.
- If the user identifies the wrong target, immediately invalidate the earlier
  evidence and rerun from target identification. Do not defend or reuse it.

Minimum session/provider evidence chain:

```text
identify exact panel (session id + provider)
  -> target its composer by stable panel identity
  -> perform the action
  -> read response/error inside the same panel subtree
  -> report the panel identity and the result from that same subtree
```

Do not open or inspect `/Applications/Acepe.app` for dev QA.

That is the installed production bundle. It does not prove anything about the current checkout.

For dev QA, inspect only one of these:

1. the repo QA wrapper attached to the running Electrobun app from this checkout
2. the Electrobun app from this checkout, normally `packages/desktop/electrobun-build/stable-macos-arm64/Acepe.app`
3. Computer Use attached to that Electrobun window, only after proving it is not `/Applications/Acepe.app`

If the app is not running, start the dev loop from `packages/desktop`:

```bash
bun run app:dev # dev server under launchd, app opened in the background
bun run app:dev:stop # stops both
```

`app:dev` starts Vite on port 1420 through `launchctl`, exports
`ACEPE_DEV_URL=http://localhost:1420`, and opens the app with `open -g`. The
window then loads the dev server, so the app survives your shell commands and
never steals focus. It builds the bundle once when it is missing.

Never launch the app with `./launcher` inside a shell command and never use a
plain `open`. A `launcher` child dies when the command ends, and plain `open`
activates the window, which is what turns QA into a relaunch loop.

Acepe has no Rust and no Tauri. Always note when you started or rebuilt it.

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

- **Frontend (`.svelte` / `.ts` under `packages/desktop/src` and
  `packages/ui/src`)** needs no rebuild under `bun run app:dev`. Save the file,
  wait about 1 second, then QA. Confirm the window is on the dev server first:
  `bun run qa doctor` prints `url: http://localhost:1420`.
  HMR repaints the component in place in 80-180 ms, with no page reload, so app
  state survives the edit. A new Tailwind class lands within the same 250 ms,
  through a separate update (see `scripts/vite-defer-stylesheet-hmr.js`). If an
  edit does not show up, check that `resolve.dedupe` in
  `vite.config.js` still lists `svelte`: a second copy of the Svelte runtime
  silently swallows every component update.
- **Electrobun shell (`packages/desktop/src/bun` and `packages/electrobun-shell`)**
  and the Bun services need `bun run electrobun:build` and a new open of the app.

Acepe has no Rust binary. Do not look under `src-tauri`.

### 2. Use `bun run qa`

Before trying Computer Use or a normal browser, run `bun run qa` from
`packages/desktop`. It is the maintained interface to the real Electrobun
WebView. Extend `packages/electrobun-qa` when a helper is missing.

Minimum useful QA pass (required after UI-affecting changes):

1. `bun run qa doctor` to prove the app answers on its QA socket.
2. `bun run qa run` with a script that reaches the affected screen and reads the
   element proving the change. Include the returned facts in your report.

Evidence must match the bug. For interaction-driven bugs, drive the interaction
inside the script and report which user action ran and what changed in the DOM.
For timing, scroll, streaming, animation, or layout-transition bugs, a single
static read is not sufficient; sample the transition after the code change. If
that sampling is blocked by app/session state, report it as blocked instead of
downgrading to static DOM evidence.

This path is the best evidence because Acepe is an Electrobun app. A browser at
`localhost:1420` does not include the real Electrobun WebView runtime or
Electrobun APIs.

If a helper is missing, add it to `packages/electrobun-qa` before repeating the
same raw interaction, and document it here when it becomes part of normal QA.

### 3. Use Computer Use Only As Fallback

Use Computer Use only after `bun run qa` is unavailable or blocked.

Before interacting, confirm the target window belongs to the dev binary.

Do not call Computer Use with app name `Acepe` unless you have already proved that the active Acepe window is the dev binary. App name alone often resolves to `/Applications/Acepe.app`.

If Computer Use attaches to `/Applications/Acepe.app`, stop immediately. Do not
inspect the screenshot or continue the QA pass there.

### 4. Do Not Use Localhost Browser QA

Do not use browser-only `localhost` evidence for Acepe desktop visual QA.

Acepe is an Electrobun desktop app. A normal browser at `localhost:1420` does not run
inside the real Electrobun WebView and does not prove Electrobun APIs, app shell behavior,
desktop routing, runtime state, permissions, or session display.

If both `bun run qa` and safe dev-window Computer Use are unavailable, visual QA
is blocked. Report it as blocked instead of trying localhost.

## What To Capture

For every visual QA pass, capture enough evidence to prove what the user sees:

- target identity: dev binary path or QA socket
- whether `bun run qa` was used; if not, why not
- DOM summary of the affected screen
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
Dev app target: <path or QA socket>
QA CLI: <used / unavailable, with reason>
Visual QA: <what was seen>
Target proof: <session id + provider id + stable panel selector/header>
Scoped evidence: <action and assertion inside that target>
Verified: <commands/tests>
Blocked: <only if the dev app or the QA socket was unavailable>
```
