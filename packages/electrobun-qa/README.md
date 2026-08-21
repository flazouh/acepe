# electrobun-qa

A QA driver for Electrobun apps. Modelled on ego-browser: one script runtime with preloaded helpers, not a verb CLI.

```bash
electrobun-qa run <<'EOF'
cliLog(await snapshotText())
await click({ text: 'New session' })
cliLog(await snapshotText())
EOF
```

## Layout

- `src/preload/` injects `qa:*` handlers on `window.__electrobunInternalBridge`
- `src/host/` is the Bun side: bridge client, unix socket, one session per app
- `src/runtime/` is the helper surface for heredoc scripts
- `src/cli.ts` is `electrobun-qa run | doctor | help`

## Commands

- `doctor` reports window title, url, and count. It exits non-zero with `QaAppNotRunning` when no app is listening.
- `run` reads a script from stdin and executes it with helpers in scope. `cliLog` is the only output path.
- `help` lists the helper surface.

## Signed builds

The preload and the QA host are absent when `signed: true`. An eval channel in a shipped app is remote code execution.

## Adopt in an Electrobun app

1. If the build is unsigned, set BrowserView `preload` to `qaPreloadScript`.
2. Start `startQaHost` with `executeJavascript` from the window.
3. Bind `qa:result` on Electrobun internal message handlers with `bindQaResultHandler`.

This package does not import `@acepe/*`. It is a general Electrobun tool, proven here against Acepe.
