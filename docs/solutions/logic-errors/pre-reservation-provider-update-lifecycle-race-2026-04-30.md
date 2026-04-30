---
title: Pre-reservation provider updates must not create session lifecycle
date: 2026-04-30
category: logic-errors
module: acp-session-lifecycle
problem_type: logic_error
component: assistant
severity: critical
symptoms:
  - Fresh Copilot sessions failed immediately with MetadataCommitFailed
  - Session creation reported that the lifecycle runtime checkpoint was already reserved
  - Early provider capability updates could race ahead of session creation
root_cause: async_timing
resolution_type: code_fix
related_components:
  - session-supervisor
  - session-state-graph
  - acp-ui-event-dispatcher
  - pre-reservation-event-buffer
tags:
  - session-lifecycle
  - provider-events
  - pre-reservation
  - god-architecture
  - copilot
---

# Pre-reservation provider updates must not create session lifecycle

## Problem

Some providers can emit safe capability/configuration facts before `acp_new_session` has finished metadata promotion and lifecycle reservation. Copilot exposed the race with `available_commands_update`: the update reached the dispatcher, the runtime graph replaced a missing checkpoint by inserting one, and the later call to `SessionSupervisor::reserve` failed with `AlreadyReserved`.

That was a lifecycle authority leak. Provider facts were able to create session existence.

## Symptoms

- Fresh Copilot sessions failed immediately after creation with `Creation failed (MetadataCommitFailed)`.
- The creation failure reported that the lifecycle runtime checkpoint was already reserved.
- The failing session had received early provider capability/config events before `acp_new_session` reached `reserve`.

## What Didn't Work

- Treating this as a Copilot-specific reopen/session-history issue only explained stale persisted sessions, not the instant crash on brand-new sessions.
- Patching TypeScript sendability or open-state fallback would have created a second lifecycle authority and left provider events able to create Rust lifecycle state.
- Letting arbitrary runtime graph update paths seed supervisor checkpoints preserved the race: capability updates are facts about a session, not proof that the session exists.

## Solution

Make `SessionSupervisor` the only lifecycle-existence authority and turn pre-reservation ingress into bounded delivery plumbing.

1. **Supervisor updates are update-only.** `replace_checkpoint`, runtime graph update paths, lifecycle transitions, and session-update persistence now require an existing lifecycle checkpoint. Unknown sessions return/log `SessionNotFound` instead of creating entries.
2. **Reservation is explicit.** `reserve` is the normal creator for new sessions, and reviewed restore/seed paths remain the only other creation paths. New-session reservation can carry initial provider capabilities without changing lifecycle status from `Reserved`.
3. **Ingress gates before projection mutation.** `AcpUiEventDispatcher::enqueue` checks lifecycle existence before deriving domain events, mutating `ProjectionRegistry`, persisting journal rows, or building graph envelopes.
4. **Only safe facts can wait.** Pre-reservation `AvailableCommandsUpdate`, `CurrentModeUpdate`, and `ConfigOptionUpdate` are buffered in memory under hard count/byte caps. Transcript, interaction, turn, lifecycle, telemetry, missing-session-id, and unknown/future updates are rejected before product state mutation.
5. **Drain after reservation.** `acp_new_session` begins a per-session drain guard, reserves lifecycle, drains buffered safe facts through the normal dispatcher path, then builds the session-open result from the post-drain runtime graph.
6. **No desktop fallback.** TypeScript stays a canonical-envelope/open-snapshot consumer; no `canonical ?? hotState` repair path or provider-specific Copilot branch was added.

## Architecture invariant

```text
Provider update
    |
    v
Does SessionSupervisor own lifecycle?
    |
    +-- yes --> normal canonical graph path
    |
    +-- no  --> safe capability/config fact?
                 |
                 +-- yes --> bounded delivery buffer only
                 +-- no  --> reject with sanitized edge diagnostic

Only acp_new_session reserve/restore paths create lifecycle existence.
```

## Why This Works

The fix moves the ordering boundary to the earliest shared Rust ingress point. Before any provider update can mutate projections, persist journal state, or advance the runtime graph, the dispatcher checks whether `SessionSupervisor` already owns lifecycle for that session.

If lifecycle exists, the update flows through the normal canonical reducer. If lifecycle does not exist, only explicitly safe capability/config facts may wait in the delivery buffer. The buffer is not semantic state: it is in-memory, bounded, cleaned up on failure/close, and drained only after `reserve` has created lifecycle existence.

## Prevention

- Early capability updates cannot create phantom sessions.
- Fresh sessions no longer fail because provider facts outran `reserve`.
- Buffered facts cannot become a second semantic authority; they are replayed only through the canonical reducer after lifecycle exists.
- Unsafe orphan updates never materialize UI product state.
- Regression tests should cover unknown-session runtime updates, pre-reservation dispatcher buffering/rejection, same-session drain ordering, and new-session open snapshots built from the post-drain runtime graph.

## Verification

- Supervisor regression: unknown provider update does not create a checkpoint and does not block later reservation.
- Dispatcher regressions: eligible pre-lifecycle capability facts buffer; unsafe/no-session updates reject; drained facts replay after lifecycle; live same-session updates wait behind the draining buffer; buffer count caps hold.
- Command regressions: explicit lifecycle fixtures still produce canonical connection snapshots, resume validation remains lifecycle-backed, and new-session open snapshots come from the post-drain runtime graph.

## Related Issues

- `docs/solutions/logic-errors/reserved-first-send-routed-through-resume-2026-04-28.md`
- `docs/solutions/architectural/canonical-reattach-failure-classification-2026-04-30.md`
- `docs/solutions/architectural/provider-owned-session-identity-2026-04-27.md`
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md`
