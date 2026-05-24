---
name: acepe-dev-app-qa
description: "Required before visually inspecting or QAing the Acepe desktop dev app, current dev app, Tauri WebView, session display, agent panel, or any UI-visible Acepe change. Use when the user says the dev app looks wrong, asks to inspect the app, asks for visual QA, or when a change affects desktop UI."
argument-hint: "[optional: screen, session id, or bug description]"
---

# Acepe Dev App QA

Use this skill before any visual QA or app inspection for Acepe.

The normal path is **Tauri MCP first**. It is the only preferred QA surface for
Acepe desktop UI because it talks to the real dev WebView and can inspect DOM,
console, screenshots, route, app state, and Tauri-specific behavior in the same
runtime the user sees.

## Hard Rule

Do not open or inspect `/Applications/Acepe.app` for dev QA.

That is the installed production bundle. It does not prove anything about the current checkout.

For dev QA, inspect only one of these:

1. the Tauri MCP bridge attached to the running dev app from this checkout
2. the running Tauri dev app from this checkout, normally `packages/desktop/src-tauri/target/debug/acepe`
3. Computer Use attached to the dev Tauri window, only after proving it is not `/Applications/Acepe.app`

Do not run `bun dev`. The user manages the dev server.

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

### 2. Use Tauri MCP First

Before trying Computer Use or a normal browser, check whether Tauri MCP is
available. Prefer it whenever available.

Acepe's repo MCP configs expose the server as `tauri` through:

```text
npx -y @hypothesi/tauri-mcp-server@0.11.1
```

In Codex, first use `tool_search` for `Tauri MCP` or `tauri mcp`. If it is
available, the callable tools normally appear with MCP names like
`mcp__tauri__driver_session`, `mcp__tauri__webview_screenshot`, and
`mcp__tauri__webview_execute_js`.

If `tool_search` does not expose a `tauri` MCP namespace for this turn, try the
repo-configured MCP server over stdio before giving up:

```bash
npx -y @hypothesi/tauri-mcp-server@0.11.1
```

Send normal MCP JSON-RPC messages over stdio:

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call` with tools such as `driver_session`, `ipc_get_backend_state`,
  `webview_dom_snapshot`, `webview_execute_js`, `read_logs`, and
  `webview_screenshot`

This path is still Tauri MCP evidence. The verified server is
`mcp-server-tauri` version `0.11.1`, and it exposes 20 tools. If both the
native MCP namespace and the stdio MCP server are unavailable, report that exact
fact before using the fallback path.

Use Tauri MCP to inspect the real dev WebView:

- attach to the running dev Tauri target
- read the current route or active screen
- inspect DOM text and structure
- inspect console errors and warnings
- capture screenshots
- click, type, and trigger user flows
- evaluate app state when the MCP supports it
- verify Tauri-only behavior that normal `localhost` cannot prove, especially `invoke`
- confirm the UI is from the current checkout, not the installed production app

Verified Tauri MCP methods:

- `driver_session`: start, stop, or check status for the bridge session. Use
  `status` first, then `start` with port `9223` when needed.
- `ipc_get_backend_state`: read app metadata, Tauri version, and environment.
  Use this early to prove the connected target is a debug Tauri app.
- `manage_window`: list windows, inspect a window, or resize it. Use `list`
  early to confirm the WebView URL and active window.
- `webview_dom_snapshot`: inspect visible DOM structure and text.
- `webview_execute_js`: read route, app state, selected session ids, or targeted
  DOM facts from inside the WebView. Return values must be JSON-serializable.
  For return values, use an IIFE such as `(() => { return 5; })()`, not a bare
  function expression.
- `webview_screenshot`: capture visual proof from the real Tauri WebView.
- `webview_find_element`: find elements by selector, XPath, text, or ref id.
- `webview_interact`: click, scroll, swipe, focus, or long-press.
- `webview_keyboard`: type text or send key events. The `type` action requires
  both a selector and text; use `press` for keyboard shortcuts.
- `webview_wait_for`: wait for text, elements, or app events.
- `webview_get_styles`: inspect computed CSS when layout or color is the issue.
- `webview_select_element`: ask the user to click an element and return
  metadata plus a screenshot.
- `webview_get_pointed_element`: inspect an element the user Alt+Shift-clicked.
- `read_logs`: read console, mobile, or system logs.
- `ipc_execute_command`: execute Tauri IPC commands when the bug is backend or
  command-boundary related. It is for commands supported by the bridge; if a
  command returns "Unsupported Tauri command", inspect the frontend flow or
  monitor IPC instead of assuming arbitrary app commands are callable.
- `ipc_monitor`, `ipc_get_captured`, `ipc_emit_event`: monitor and replay Tauri
  IPC traffic when debugging command/event flow.
- `list_devices`: list mobile devices and simulators.
- `get_setup_instructions`: inspect the bridge setup if the MCP server is
  present but the app cannot connect.

Minimum useful QA pass:

1. `driver_session` with `status`, then `start` on port `9223` if disconnected.
2. `ipc_get_backend_state` and `manage_window list` to confirm the connected app.
3. `webview_dom_snapshot` or `webview_execute_js` to inspect the affected state.
4. `read_logs` with console logs when UI behavior is wrong.
5. `webview_screenshot` for final visual evidence.

This is the best evidence because Acepe is a Tauri app. A browser at
`localhost:1420` does not include the real Tauri WebView runtime or Tauri APIs.

If Tauri MCP is unavailable, say exactly how you checked or why it is unavailable.

### 2b. Codex CLI Path When The Tauri MCP Namespace Is Missing

Sometimes Codex does not expose callable tools like `mcp__tauri__...` even
though the dev app and bridge are running. In that case, use the Tauri MCP
companion CLI. This is still Tauri MCP evidence because it talks to the same
bridge inside the real dev WebView.

First prove the dev app is running and find the bridge port:

```bash
ps -p <dev-acepe-pid> -o pid,comm,args
lsof -Pan -p <dev-acepe-pid> -iTCP | rg LISTEN
```

For the Acepe dev app, the bridge normally listens on port `9223`.

Start or attach the driver session:

```bash
npx -y -p @hypothesi/tauri-mcp-cli@0.10.0 tauri-mcp driver-session start --port 9223
```

Confirm the target is the dev WebView, not `/Applications/Acepe.app`:

```bash
npx -y -p @hypothesi/tauri-mcp-cli@0.10.0 tauri-mcp manage-window \
  --action list \
  --app-identifier 9223 \
  --json
```

Expected useful proof:

- window URL is the dev app URL, normally `http://localhost:1420/`
- process inspection shows `target/debug/acepe` from this checkout
- do not accept Computer Use attaching to `/Applications/Acepe.app` as proof

Useful CLI commands:

```bash
# Accessibility tree for the whole app or a scoped selector
npx -y -p @hypothesi/tauri-mcp-cli@0.10.0 tauri-mcp webview-dom-snapshot \
  --type accessibility \
  --selector 'main' \
  --app-identifier 9223

# DOM structure, useful for finding selectors/classes
npx -y -p @hypothesi/tauri-mcp-cli@0.10.0 tauri-mcp webview-dom-snapshot \
  --type structure \
  --selector 'aside, [role=complementary]' \
  --app-identifier 9223

# Run JavaScript in the real Tauri WebView. Always use an IIFE for return values.
npx -y -p @hypothesi/tauri-mcp-cli@0.10.0 tauri-mcp webview-execute-js \
  --app-identifier 9223 \
  --json \
  --script '(() => ({ href: location.href, title: document.title }))()'

# Click by ref from a DOM snapshot
npx -y -p @hypothesi/tauri-mcp-cli@0.10.0 tauri-mcp webview-interact \
  --app-identifier 9223 \
  --action click \
  --selector 'ref=e154'

# Type into a textbox by ref from a DOM snapshot
npx -y -p @hypothesi/tauri-mcp-cli@0.10.0 tauri-mcp webview-keyboard \
  --app-identifier 9223 \
  --action type \
  --selector 'ref=e542' \
  --text 'qa message'

# Read WebView console logs
npx -y -p @hypothesi/tauri-mcp-cli@0.10.0 tauri-mcp read-logs \
  --app-identifier 9223 \
  --source console

# Screenshot proof
npx -y -p @hypothesi/tauri-mcp-cli@0.10.0 tauri-mcp webview-screenshot \
  --app-identifier 9223 \
  --file /tmp/acepe-dev-qa.jpg
```

Notes from the verified Codex path:

- `tool_search` may fail to expose Tauri MCP tools even while the server is
  running.
- Computer Use with app name `acepe` may attach to `/Applications/Acepe.app`;
  reject that as dev QA evidence.
- The CLI option is `--app-identifier`, not `--appIdentifier`.
- `manage-window` requires `--action list`, `--action info`, or
  `--action resize`.
- `webview-execute-js` uses `--script`; the raw JSON field is not named
  `script` unless you use the exact raw format supported by the CLI.
- Text matching can be fragile for hidden/sidebar controls. Prefer DOM snapshot
  refs or precise selectors after inspecting structure.
- Acepe's composer is a `contenteditable` element, not a normal `<textarea>`.
  After using `webview-keyboard --action type`, verify that the editor has real
  `textContent` and that the send button state changed. If the DOM only shows a
  synthetic `value` property while `textContent` is empty, the app did not
  receive real input and that is not valid send-path QA.
- For contenteditable diagnostics, a controlled `webview-execute-js` probe may
  set `textContent` and dispatch an `InputEvent`, but label that as diagnostic
  evidence, not proof of the normal user typing path.

### 3. Use Computer Use Only As Fallback

Use Computer Use only after Tauri MCP is unavailable or blocked.

Before interacting, confirm the target window belongs to the dev binary.

Do not call Computer Use with app name `Acepe` unless you have already proved that the active Acepe window is the dev binary. App name alone often resolves to `/Applications/Acepe.app`.

If Computer Use attaches to `/Applications/Acepe.app`, stop immediately. Do not
inspect the screenshot or continue the QA pass there.

### 4. Do Not Use Localhost Browser QA

Do not use browser-only `localhost` evidence for Acepe desktop visual QA.

Acepe is a Tauri desktop app. A normal browser at `localhost:1420` does not run
inside the real Tauri WebView and does not prove Tauri APIs, app shell behavior,
desktop routing, runtime state, permissions, or session display.

If both Tauri MCP and safe dev-window Computer Use are unavailable, visual QA is
blocked. Report it as blocked instead of trying localhost.

## What To Capture

For every visual QA pass, capture enough evidence to prove what the user sees:

- target identity: dev binary path or Tauri MCP target
- whether Tauri MCP was used; if not, why not
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
Dev app target: <path or Tauri MCP target>
Tauri MCP: <used / unavailable, with reason>
Visual QA: <what was seen>
Verified: <commands/tests>
Blocked: <only if dev app/Tauri MCP was unavailable>
```
