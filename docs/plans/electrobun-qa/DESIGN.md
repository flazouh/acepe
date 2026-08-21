---
title: "electrobun-qa — design"
status: draft
date: 2026-08-21
---

# electrobun-qa

A QA and automation driver for Electrobun apps, modelled on `ego-browser`.

Electrobun has no automation story. Playwright and Puppeteer drive Chromium over CDP; an Electrobun app is a native window hosting a system WebView with no debugging port. Today the only way to check an Electrobun app is to look at it.

## The design in one line

**A script runtime with preloaded helpers, not a verb CLI.**

```bash
electrobun-qa run <<'EOF'
const win = await firstWindow()
cliLog(await snapshotText())
await click({ text: 'New session' })
await waitForText('Untitled session')
cliLog(await pageInfo())
EOF
```

## Why a script runtime beats a verb CLI

The verb form — `qa inspect --selector=X`, `qa click --selector=Y` — was the first thing we built, and it is the wrong shape:

1. **One process per step.** A five-step flow is five spawns, five connections, five teardowns.
2. **No composition.** Conditionals, loops, retries and derived selectors are impossible without a shell that reparses text output.
3. **Lossy results.** Everything degrades to stdout text and gets regex-scraped by the caller.
4. **Unstable between steps.** State can change between spawns, and nothing carries across.

ego-browser resolved this with a heredoc runtime whose helpers are preloaded. One round trip, real control flow, structured values. Copy that.

## Transport

The hard constraint: `BrowserView.executeJavascript(js)` calls `evaluateJavascriptWithNoCompletion`. **Fire and forget, no return channel.** Every naive driver dies here, and ours did — every eval timed out.

Electrobun already solved this internally. `__electrobunInternalBridge` is a duplex channel with `request(type, payload): Promise<unknown>` and `handleResponse`, used for webview tags and drag regions. It rides the same encrypted socket as the rest of Electrobun's IPC.

So: **ship a preload script that registers a `qa:*` namespace on the internal bridge.** Not a global the injected JS has to hunt for, not an HTTP eval endpoint, not a piggyback on the host app's RPC schema.

```
electrobun-qa CLI  ──unix socket──▶  Bun QA host  ──internal bridge──▶  QA preload  ──▶  DOM
```

Three consequences fall out of this:

1. **It works with any Electrobun app.** An app adopts it by adding `preload` to its BrowserView options. Nothing about the host app's RPC schema matters. That is what makes it upstreamable.
2. **No new network surface.** A unix socket in the user's runtime dir, not a TCP port that evaluates arbitrary JavaScript.
3. **Results come back typed**, because the channel is request/response by construction.

## Helper surface

Grouped by concern, following ego-browser's vocabulary so the muscle memory transfers.

| Group | Helpers |
|---|---|
| Windows | `listWindows`, `firstWindow`, `useWindow`, `windowInfo` |
| Observation | `snapshotText`, `snapshotDom`, `pageInfo`, `captureScreenshot` |
| Interaction | `click`, `doubleClick`, `hover`, `typeText`, `fillInput`, `pressKey`, `scrollBy` |
| Waiting | `waitForText`, `waitForSelector`, `waitForIdle`, `wait` |
| Evaluation | `js`, `queryAll` |
| Output | `cliLog`, `help` |

`click` and friends take `{ selector }` or `{ text }`. Text matching is what agents reach for first and what breaks least when markup changes.

## Non-negotiables

1. **DOM verification, never screenshots.** `snapshotText` returns an accessibility-shaped text tree, not a picture. A screenshot proves a window exists; it cannot tell you whether a 404 came from the framework or the router. That distinction cost real time on this project.
2. **Off in signed builds.** The preload and the QA host compile out unless explicitly enabled. An eval channel in a shipped app is remote code execution.
3. **Typed errors, never hangs.** Every helper has a deadline and fails with a named error. `QaEvalTimeout: webview did not answer token qa-1` is a good failure; a hang is not.
4. **Zero dependencies beyond Bun and Electrobun.**

## Package shape

```
packages/electrobun-qa/
  src/
    preload/          injected into the webview, registers qa:* on the internal bridge
    host/             Bun side: bridge client, socket server, session
    runtime/          the helper surface exposed to heredoc scripts
    cli.ts            electrobun-qa run | doctor | help
  README.md
```

Vendored into this repo first, proven against Acepe, then proposed upstream as `@electrobun/qa`.

## Proof it works

The acceptance bar is our own app, not a fixture:

1. `doctor` reports window title, url and count against a running Acepe build.
2. A heredoc creates a project, opens a session, sends a message, and asserts the streamed reply lands in the transcript — all DOM-verified.
3. Killing the Bun process mid-stream and reconnecting recovers, and the script observes it.
4. A signed build exposes no QA socket. Proven by test, not by comment.
