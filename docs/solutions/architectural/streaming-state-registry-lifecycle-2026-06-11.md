---
title: Per-session streaming state lifecycle ownership
date: 2026-06-11
category: architectural
module: acp/streaming_accumulator
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - Adding or testing per-session mutable state in Rust (DashMap globals, streaming buffers)
  - Tests bracket production helpers with manual cleanup to avoid cross-test pollution
  - Terminal tool updates require drop-before-cleanup ordering on concurrent DashMap borrows
tags: [streaming-state, registry, test-isolation, dashmap, lifecycle, finalize-tool]
---

# Per-session streaming state lifecycle ownership

## Context

Plan 012 refactored `streaming_accumulator.rs` from three module-level `LazyLock<DashMap>` globals into a `StreamingStateRegistry` with explicit lifecycle verbs. Before the registry, every streaming characterization test had to call `cleanup_session_streaming` / `cleanup_tool_streaming` around itself because state lived in process-global maps. Production callers also owned RefMut-drop ordering before cleanup to avoid DashMap deadlocks.

## Guidance

**Own lifecycle on the registry interface, not at call sites.**

| Verb | When | Replaces |
|------|------|----------|
| `seed_tool_name` / `accumulate_tool_delta` | Streaming in progress | Direct map mutation |
| `apply_tool_streaming_delta` | Delta + optional terminal in one call | Caller-scoped RefMut + separate cleanup |
| `finalize_tool` | Terminal tool status | `cleanup_tool_streaming` |
| `remove_session` | Session close | `cleanup_session_streaming` |

Production wiring uses a process-scoped singleton (`streaming_state_registry()`). Session close in `fork_close.rs` calls `remove_session`; terminal updates in `tool_calls.rs` call `finalize_tool` inside `apply_tool_streaming_delta`, with all RefMut borrows scoped before finalize.

**Test isolation:** Tests that exercise production code paths through module-level accessors should call `reset_streaming_state_for_test()` at the start of each test (clears the singleton's three maps). Do not reintroduce per-test cleanup brackets. Tests that can inject dependencies directly may construct `StreamingStateRegistry::new()` instead.

## Why This Matters

Global per-session maps without a lifecycle owner force every caller and test to remember cleanup ordering. That pattern showed up as:

- Deadlock-sensitive comments in `tool_calls.rs` ("drop RefMut before cleanup")
- Duplicate terminal cleanup at multiple sites
- Test suites that fail when run out of order unless manually scrubbed

Centralizing finalize ordering inside `apply_tool_streaming_delta` / `finalize_tool` keeps one private implementation of the drop-before-cleanup contract and makes tests order-independent via reset-at-start.

## When to Apply

- New per-session hot state in ACP (streaming, plan buffers, codex tag capture)
- Refactors that retire `LazyLock<DashMap>` globals
- Test modules where `cleanup_*` brackets appear around fixed session ids

## Examples

**Before (test scrubbing):**

```rust
cleanup_session_streaming(session_id);
seed_tool_name(session_id, tool_call_id, "Read", agent);
// ... exercise path ...
cleanup_session_streaming(session_id);
```

**After (reset-at-start):**

```rust
reset_streaming_state_for_test();
seed_tool_name(session_id, tool_call_id, "Read", agent);
// ... exercise path — terminal path clears via finalize_tool ...
```

**Registry finalize owns ordering (production):**

```rust
let (normalized, plan) = {
    let normalized = self.accumulate_tool_delta(...);
    let plan = self.process_plan_streaming(...);
    (normalized, plan)
};
if is_terminal {
    self.finalize_tool(session_id, tool_call_id);
    // ...
}
```

## Related

- Plan: `docs/plans/2026-06-11-012-refactor-streaming-state-lifecycle-plan.md`
- Semantic boundary: `docs/solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md`
- Lifecycle race pattern: `docs/solutions/logic-errors/pre-reservation-provider-update-lifecycle-race-2026-04-30.md`
