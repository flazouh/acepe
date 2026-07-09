---
title: Session open freeze from closed SDK control channel
date: 2026-07-02
category: performance-issues
module: cc_sdk
problem_type: performance_issue
component: assistant
symptoms:
  - Opening a historical Claude session made the Acepe dev app feel frozen.
  - The native target/debug/acepe process stayed at very high CPU.
  - Sampling showed Tokio workers repeatedly polling the SDK control handler.
root_cause: async_timing
resolution_type: code_fix
severity: high
tags: [cc-sdk, session-open, high-cpu, control-channel, tokio]
---

# Session open freeze from closed SDK control channel

## Problem
Opening historical session 20 could make the app look frozen and push the native Acepe process into a sustained high CPU spin.

## Symptoms
- `target/debug/acepe` jumped to several hundred percent CPU after reopening the session.
- A process sample pointed at `acepe_lib::cc_sdk::internal_query::Query::start_control_handler`.
- The affected Claude process had already exited because the account was over its monthly spend limit.

## What Didn't Work
- Looking only at transcript replay and snapshot hydration did not explain the CPU burn. Those paths explained what appeared on screen, but not why Tokio workers stayed hot.
- Treating historical sessions as read-only would avoid some reconnect behavior, but it would violate the session-open architecture rule. Historical sessions must still be able to reconnect after snapshot hydration.

## Solution
Make the SDK control handler exit when the sender side of the channel closes.

Before, the loop kept running after `recv().await` returned `None`:

```rust
loop {
    let control_message = control_rx.recv().await;
    if let Some(control_message) = control_message {
        // handle message
    }
}
```

After, the loop is tied to the channel lifetime:

```rust
while let Some(control_message) = control_rx.recv().await {
    // handle message
}
```

The handler now returns its `JoinHandle` so a unit test can prove the task exits when the SDK control sender is dropped.

## Why This Works
For Tokio `mpsc`, `recv().await` returns `None` when all senders are dropped. If code ignores that `None` and loops again, the next `recv().await` returns `None` immediately. That creates a tight loop:

```text
sender dropped
     |
     v
recv() -> None
     |
     v
loop again immediately
     |
     v
high CPU forever
```

`while let Some(...)` stops the task at the channel boundary, so a closed Claude/stdout/control path cannot leave a background task spinning.

## Prevention
- For every async receiver loop, decide what should happen when the channel closes. Prefer `while let Some(message) = rx.recv().await` unless the closed state needs explicit handling.
- Add a regression test that drops the sender and uses a short timeout to verify the task exits.
- When a freeze is paired with high CPU, sample the process before changing replay or UI code. The hot stack can quickly separate display bugs from background-task spins.

## Related Issues
- `packages/desktop/src-tauri/src/cc_sdk/internal_query.rs`
