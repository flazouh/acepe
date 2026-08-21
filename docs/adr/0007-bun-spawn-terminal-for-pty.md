# ADR-0007: Give the shipped app a PTY through Bun.spawn, not Node and not Rust

## Status

Accepted — 2026-08-21

## Context

AC-038 needed a real PTY under Bun. `node-pty` does not load in the Bun process, and `ChildProcess.make("node")` starts Bun rather than Node. The first port therefore spawned a real Node binary, loaded `node-pty` in `ptyHost.mjs`, and spoke JSON to that host. Node was found from Hermes, Homebrew, or `PATH`.

That works on a developer machine. Electrobun bundles Bun, not Node. A user with no Node install gets no terminal. Searching Homebrew is a development convenience, not a shipping plan.

AC-053 required a choice:

1. Bundle a Node runtime with the app.
2. Replace `node-pty` with a PTY that runs under Bun.
3. Keep the terminal in the Rust sidecar next to `file_index`, and stop AC-047 from deleting that module.

AC-052 already kept `file_index` in TypeScript. Option 3 would be the remaining reason to keep Rust after cutover. Option 1 ships two JavaScript runtimes and grows the bundle for a host that exists only because `node-pty` cannot load.

Bun 1.3.5 added `Bun.spawn({ terminal })` and `Bun.Terminal`. Electrobun 1.18.0 bundles Bun 1.3.11, so the shipped app has that API. The inline `terminal: { cols, rows, data }` form makes the child the session leader on the PTY. A pre-built `new Bun.Terminal()` object does not, on current Bun.

## Decision

- Implement `PtyAdapter` with in-process `Bun.spawn` and an inline `terminal` option.
- Do not spawn Node. Do not discover Hermes or Homebrew. Do not bundle a Node runtime.
- Do not keep the terminal module in the Rust sidecar. AC-047 may still delete Rust for this path.
- Close the PTY from the subprocess `onExit` callback. Do not use `TerminalOptions.exit` for process status; that callback reports PTY stream lifetime, not the child exit code or signal.

## Consequences

**Better**

- A machine with no Node and no Homebrew can open an interactive terminal, because the PTY lives in the bundled Bun.
- The AC-038 suite keeps resize, signals, login-shell PATH capture, and 100 open-and-close cycles without a Node host process.
- Cutover no longer depends on a Node install next to Electrobun.

**Costs**

- `Bun.Terminal` is POSIX-only on the Bun version Electrobun 1.18 ships. Windows ConPTY is a later Bun/Electrobun upgrade, not this ticket.
- The adapter talks to the Bun global, so `@acepe/server` typechecks with `bun-types`.

## Alternatives rejected

- **Bundle Node and keep `node-pty`:** doubles the runtime in the app. The host exists only to load a Node addon. Electrobun already ships a PTY API.
- **Keep the terminal in the Rust sidecar:** cheap now, and it blocks AC-047 forever for this module after `file_index` already stayed in TypeScript.
- **Spawn a Bun child that still speaks the JSON host protocol:** extra process per terminal, same teardown surface as the Node host, no product gain once `Bun.spawn({ terminal })` works in-process.
- **`new Bun.Terminal()` then `Bun.spawn({ terminal })`:** the child does not become the PTY session leader, so job-control signals do not land. Use the inline `terminal` object on spawn.
