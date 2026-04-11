---
title: Keep autonomous mode as a Rust-side session policy hook
date: 2026-04-11
last_updated: 2026-04-11
category: best-practices
module: desktop ACP runtime
problem_type: best_practice
component: autonomous mode
severity: high
applies_when:
  - autonomous permission approval must work consistently across providers
  - provider launch profiles or reconnect flows are drifting out of sync
  - frontend permission stores are attempting to enforce backend policy
  - new agent providers need autonomous behavior without custom UI logic
symptoms:
  - Claude autonomous mode silently regresses when launch-profile mapping changes
  - Copilot autonomous mode stops auto-approving after projection or hydration changes
  - provider support depends on reconnect logic or provider-specific execution profiles
  - permission rows appear pending in the UI even though autonomous should have handled them
root_cause: architecture_split
resolution_type: architectural_fix
related_components:
  - session-policy
  - cc-sdk-client
  - inbound-request-router
  - codex-native-client
  - interaction-projection
  - session-connection-manager
  - permission-store
tags:
  - autonomous-mode
  - permissions
  - rust-hooks
  - provider-abstraction
  - claude
  - copilot
  - codex
  - cursor
  - opencode
---

# Keep autonomous mode as a Rust-side session policy hook

## Context

Autonomous mode had split into two separate enforcement paths:

1. **Provider-owned execution-profile plumbing** in Rust and Tauri (`acp_set_execution_profile`, launch-profile mapping, reconnect-on-toggle behavior).
2. **Frontend auto-accept fallback** in `PermissionStore` and `main-app-view.svelte`.

That split created two different failure classes on the same day:

- **Claude drifted at launch time.** Autonomous behavior depended on mapping build mode to a provider-specific bypass profile, so provider/runtime changes could silently break it.
- **Copilot drifted at render time.** Autonomous behavior depended on frontend permission-store logic that stopped running once projection hydration became authoritative.

Both bugs came from the same mistake: autonomous was modeled as a provider/UI behavior instead of an Acepe-owned session policy.

## Guidance

Treat autonomous mode as **backend policy owned by Acepe**, enforced at the Rust permission boundary for every provider.

The durable architecture is:

1. **Backend session policy is the source of truth.**

   `SessionPolicyRegistry` stores `autonomous_enabled` by session id, and the frontend only toggles that backend state with `acp_set_session_autonomous`.

2. **Permission auto-approval happens at provider hook points, not in the UI.**

   - Claude: `cc_sdk_client.rs`
   - Copilot/Cursor/OpenCode: `inbound_request_router/permission_handlers.rs`
   - Codex native: `codex_native_client.rs`

3. **Auto-approved permissions still emit canonical interaction data.**

   Rust marks them `auto_accepted: true`, and projection registration records them as already approved instead of pending.

4. **The frontend renders projection state; it does not enforce autonomous policy.**

   `PermissionStore` may still drain already-pending permissions when autonomy is enabled mid-turn, but it no longer decides whether new permissions should auto-approve.

## Invariant

If a permission should be auto-approved, the provider-facing Rust boundary must:

- decide that before forwarding to the frontend,
- emit a canonical permission payload with `auto_accepted: true`, and
- project the interaction as approved rather than pending.

The UI should never need a second autonomous decision path for newly arriving permissions.

## One-way-door decisions from this fix

- Delete provider-owned autonomous execution-profile mapping (`map_execution_profile_mode_id`, `AutonomousApplyStrategy`, `acp_set_execution_profile`).
- Delete frontend auto-accept wiring (`setAutoAccept`, `maybeAutoAcceptPending`, `main-app-view` predicate wiring).
- Default autonomous support to `build` mode at the shared provider contract so new build-mode providers inherit support automatically.
- Keep the two policy exemptions in Rust:
  - **Exit-plan approvals are never auto-accepted.**
  - **Child-tool-call permissions are auto-accepted even outside live autonomous toggles.**

## Why this is safer

- Provider quirks stay at adapter edges.
- Autonomous behavior no longer depends on reconnect timing or launch-profile drift.
- Projection state becomes authoritative for both history and pending-action UI.
- Adding providers like Cursor or OpenCode no longer requires new frontend permission logic.
