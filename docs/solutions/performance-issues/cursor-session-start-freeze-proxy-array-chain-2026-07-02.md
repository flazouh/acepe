---
title: Cursor session start freeze from proxy-backed session list arrays
date: 2026-07-02
category: performance-issues
module: session-store
problem_type: performance_issue
component: desktop
symptoms:
  - Starting a Cursor session made the Acepe WebView appear frozen.
  - The Rust process stayed mostly idle.
  - The WebKit WebContent process used about one full CPU core.
root_cause: frontend_proxy_chain
resolution_type: code_fix
severity: high
tags: [cursor, session-list, svelte, webkit, proxy, high-cpu]
---

# Cursor session start freeze from proxy-backed session list arrays

## Problem
Starting a Cursor session could freeze the desktop app even though the Rust backend was not busy.

## Symptoms
- `target/debug/acepe` stayed low CPU.
- `com.apple.WebKit.WebContent` stayed near 100% CPU.
- A WebContent sample showed JavaScript repeatedly inside Proxy property lookup and property descriptor code.

## Root Cause
The session-list store used custom `Proxy` arrays for prepend and patch helpers.

Those arrays looked like arrays for simple index reads, but they were not normal arrays:

```text
Svelte state
  |
  v
Proxy array
  |
  v
older Proxy array
  |
  v
older Proxy array
```

When Svelte/WebKit inspected or enumerated the list, it had to walk a chain of proxy handlers. Also, `Object.keys(proxyArray)` returned `[]`, which is not normal array behavior.

## Solution
Materialize the session-list arrays as normal arrays in `session-cold-index.ts`.

The fixed helpers now copy the list into a plain array when prepending or patching. This keeps the session-list state boring and enumerable:

```text
Svelte state
  |
  v
plain Array
```

## Why This Works
The session list is UI-facing derived state. It does not need lazy proxy behavior. A normal array is easier for Svelte and WebKit to inspect, diff, and render.

The regression test checks that prepended and patched arrays expose normal keys and entries.

## Prevention
- Avoid storing custom `Proxy` collections in Svelte state unless there is a strong need.
- If a value claims to be an array, make sure `Object.keys`, `Object.entries`, iteration, `.map`, and indexing all behave like a normal array.
- When a freeze affects only WebContent CPU, sample WebContent before changing Rust paths.

## Related Issues
- `packages/desktop/src/lib/acp/store/session-cold-index.ts`
- `packages/desktop/src/lib/acp/store/__tests__/session-cold-index.test.ts`
