# 9. PTY via bun:ffi, not a bundled Node

Date: 2026-08-23
Status: accepted

## Context

`node-pty` does not run under Bun, so AC-038's terminal spawns a discovered
Node binary as a PTY host. Electrobun bundles Bun, not Node: a user without
Node gets no terminal. AC-053 required choosing between bundling Node
(~50MB), replacing node-pty, or keeping the terminal in the Rust sidecar.

## Decision

Replace the PTY layer with direct `bun:ffi` calls into libSystem. A spike
proved the mechanism end to end: `openpty` returns a live master/slave pair,
a shell spawned on the slave runs, and the master reads its output back
(`openpty rc=0`, `read from master: PTY_ALIVE_42`).

The discovered-Node host remains as a runtime fallback until the FFI path
passes AC-038's full suite, then it is deleted.

## Consequences

- No Node runtime dependency and no ~50MB bundle growth.
- The terminal leaves the AC-047 "keep in sidecar" list.
- Linux needs the same spike against glibc/musl before #243 closes there;
  macOS is proven.
