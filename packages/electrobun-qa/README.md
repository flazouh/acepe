# electrobun-qa

A QA and automation driver for [Electrobun](https://github.com/blackboardsh/electrobun) apps.

Electrobun apps have no automation story. Playwright and Puppeteer drive Chromium over CDP; an Electrobun app is a native window hosting a system WebView with no debugging port. Until now the only way to check one was to look at it.

```bash
electrobun-qa run <<'EOF'
const win = await firstWindow()
cliLog(await snapshotText())

await click({ text: 'New session' })
await waitForText('Untitled session')

cliLog(await pageInfo())
EOF
```

## Why a script runtime, not a verb CLI

`qa inspect --selector=X` then `qa click --selector=Y` is one process per step, no conditionals or loops, results degraded to stdout for the caller to regex, and state free to change between spawns.

A heredoc runtime with preloaded helpers is one round trip, real control flow, and structured values. The design follows [ego-browser](https://github.com/ego-browser), whose helper vocabulary it deliberately mirrors so the muscle memory transfers.

## How it reaches the DOM

Electrobun's `BrowserView.executeJavascript(js)` is **fire and forget** — it calls `evaluateJavascriptWithNoCompletion`, so there is no return channel. Injecting a script that tries to call home fails: the plain `postMessage` fallback arrives unauthenticated, because Electrobun encrypts its IPC socket.

Electrobun already solved this internally. `__electrobunInternalBridge` is a duplex channel with request/response semantics, used for webview tags and drag regions. `electrobun-qa` ships a **preload that registers a `qa:*` namespace on that bridge**.

```
electrobun-qa CLI  ──unix socket──▶  QA host (Bun)  ──internal bridge──▶  QA preload  ──▶  DOM
```

Three things follow:

1. **It works with any Electrobun app.** Adoption is one `preload` option. Nothing about your app's RPC schema matters.
2. **No new network surface.** A unix socket in the runtime dir, not a TCP port that evaluates arbitrary JavaScript.
3. **Typed results**, because the channel is request/response by construction.

## Helpers

| Group | Helpers |
|---|---|
| Windows | `listWindows`, `firstWindow`, `useWindow`, `windowInfo` |
| Observation | `snapshotText`, `snapshotDom`, `pageInfo`, `captureScreenshot` |
| Interaction | `click`, `doubleClick`, `hover`, `typeText`, `fillInput`, `pressKey`, `scrollBy` |
| Waiting | `waitForText`, `waitForSelector`, `waitForIdle`, `wait` |
| Evaluation | `js`, `queryAll` |
| Output | `cliLog`, `help` |

`click` and friends accept `{ selector }` or `{ text }`. Text matching is what you reach for first and what survives markup churn.

## Setup

```ts
import { qaPreloadScript, makeQaBridgeClient, makeQaSession, startQaHost } from "electrobun-qa"

const win = new BrowserWindow({
  title, url, frame, rpc,
  preload: qaSurfaceEnabled ? qaPreloadScript : null,
})
```

Then start the host with a sender bound to that webview's `executeJavascript`.

## Safety

The preload and host are **absent from signed builds**. An eval channel in a shipped app is remote code execution, so the gate is a build flag with a test on it, not a comment.

Every helper has a deadline and fails with a named error — `QaEvalTimeout: webview did not answer token qa-1`. A hang is never an acceptable failure.

## Verification philosophy

`snapshotText` returns an accessibility-shaped text tree, not a picture. Screenshots prove a window exists and nothing more; they cannot tell you whether a 404 came from the framework or from your router. Verify the DOM.

## Status

Vendored and proven against a real app first. Intended for upstream as `@electrobun/qa`.

## License

MIT

## Parallel instances

One env key isolates everything an instance owns, so N agents can drive N apps concurrently:

```bash
ELECTROBUN_QA_APP_ID=com.myapp.lane1 ./MyApp.app/Contents/MacOS/launcher &
ELECTROBUN_QA_APP_ID=com.myapp.lane2 ./MyApp.app/Contents/MacOS/launcher &

ELECTROBUN_QA_APP_ID=com.myapp.lane1 electrobun-qa doctor
ELECTROBUN_QA_APP_ID=com.myapp.lane2 electrobun-qa run <<'EOF'
cliLog(await snapshotText())
EOF
```

Each key gets its own unix socket (`/tmp/electrobun-qa/<id>.sock`). Your app can reuse the same key to namespace its own per-instance state — Acepe scopes its database and seed fixtures with it. Without distinct keys, two instances race one socket and the second silently serves nobody.

## Resilience contract

- A client that dies mid-script cannot wedge the host: the listener drops that client's buffer and keeps accepting.
- A transient socket error retries twice at 300ms — but only when a connection had actually opened. Nothing listening fails fast with `QaAppNotRunning`.
- Every helper has a deadline and fails with a named error (`QaEvalTimeout: webview did not answer token qa-3`). No hangs.

## Field notes that shaped the design

- **DOM facts beat screenshots.** A screenshot proved a window existed but could not say whether a 404 came from the framework or the app router. `snapshotText` could.
- **Deterministic selectors beat text matching** for flows: `click({ text })` picks the first visible match and can hit a non-interactive ancestor. Prefer `click({ selector })` against `data-testid`/`data-qa` hooks for anything that must not flake.
- **Signed builds carry none of this.** The preload and host compile out unless the QA surface is explicitly enabled; an eval channel in a shipped app is remote code execution.
