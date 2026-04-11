---
date: 2026-04-11
topic: permission-autonomy-architecture
---

# Autonomous Mode as an Acepe-Side Policy

## Problem Frame

On 2026-04-11 we debugged and shipped two fixes for "autonomous mode does not work":

1. **Claude Code** — `cc_sdk_client::resume_session` was clobbering the `pending_mode_id` seeded by `seed_client_launch_mode`, **and** `new_session`'s eagerly-cached `pending_options` never got rebuilt when `set_session_mode` fired before the first prompt. Both fixed in the same session.
2. **GitHub Copilot** — refactor #90 (`1ae1ebcc8`, Apr 8) rewired permission ingestion to flow through `InteractionStore.applyProjectionInteraction`, orphaning the `shouldAutoAccept` callback registered in `main-app-view.svelte:490`. It had been dead code for ~3 days. Fixed by adding `PermissionStore.maybeAutoAcceptPending` and calling it from the hydration callback.

Each fix is correct. Together they tell us the **architecture** is the real bug: "autonomous mode" means two operationally-different things in the codebase, owned by different layers, with no single point of enforcement.

## What The Codebase Actually Looks Like Today

Verified during the brainstorm:

| Provider | Autonomous enforcement today |
|---|---|
| **Claude Code** | Native: CLI launched with `bypassPermissions` via `LaunchProfile` strategy. CLI stops sending permission requests. |
| **Codex** | Native: `codex_native_config.rs` resolves autonomous build to `approvalPolicy: "never"` in the CLI config. CLI stops sending permission requests. |
| **Copilot** | In theory: `session/set_mode` with an autopilot URI. In practice: we don't know if the CLI honors it, and until today Acepe's frontend auto-accept was silently dead code. |
| **Cursor** | Not supported — default `autonomous_supported_mode_ids()` returns `&[]`. Toggle disabled. |
| **OpenCode** | Not supported — same as Cursor. |

**Also verified:** production permission ingestion has a **single** write point — `InteractionStore.applyPermissionInteraction` inside `replaceSessionProjection`. The "three channels" framing in an earlier draft of this doc was wrong. Both the session-update path and the legacy inbound path converge through `hydrateInteractionProjection` → `api.getSessionProjection` → `replaceSessionProjection`.

## The Reframe

The current architecture treats autonomous as a **provider capability** that each provider implements its own way. That's why we have:

- `autonomous_apply_strategy` enum (`LaunchProfile` vs `PostConnect`)
- `shouldReconnectForAutonomous` + reconnect-on-toggle path
- `acp_set_execution_profile` Tauri command
- `map_execution_profile_mode_id` per provider
- Claude's `seed_client_launch_mode` fighting with `reset_pending_mode_for_safe_resume`
- Copilot's autopilot URI hope
- A separate frontend auto-accept fallback that was silently broken

**The correct model is simpler:**

> Autonomous mode = the user has granted **Acepe** blanket permission to approve on their behalf. Acepe auto-accepts every incoming permission request while the toggle is on. That is the entire enforcement mechanism.

Provider-specific CLI launch flags (`bypassPermissions`, `approvalPolicy: "never"`) become a **separable throughput optimization**, opt-in and orthogonal to the autonomous toggle. They are not what autonomous means.

## Why This Works

1. **Uniform across providers.** Every provider that can send permission requests gets autonomous mode for free. Cursor and OpenCode now support autonomous with zero provider changes.

2. **Structurally prevents both bugs we just fixed.** The Claude launch-flag bug can't exist because we don't pass launch flags. The Copilot dead-code bug can't exist because frontend auto-accept is the **only** mechanism, not a fallback, so it can't drift out of test coverage.

3. **Toggle on/off is instantaneous and reconnect-free.** Today, enabling autonomous on Claude requires disconnecting and reconnecting with a new launch profile. In the new model, flipping `hotState.autonomousEnabled` is enough — the running CLI keeps asking, Acepe starts saying yes. Disabling mid-stream is equally trivial: Acepe stops saying yes, the next request surfaces normally. No race windows, no reconnect logic.

4. **Observability and auditability.** Every auto-accepted decision flows through the same code path and can be logged, surfaced in the UI, or replayed for debugging. Today, bypass-at-launch means we have no record of what the CLI was allowed to do.

5. **One place to test.** Integration test: "when `autonomousEnabled = true`, a permission request arriving through `applyPermissionInteraction` triggers an allow reply and does not land in `permissionsPending` as pending." One test, every provider covered.

## The Only Real Tradeoff

**IPC roundtrip cost.** For Claude and Codex, every tool call now bounces CLI → Acepe → auto-accept → CLI instead of being bypassed at the CLI. Each roundtrip is single-digit milliseconds on local Tauri IPC. A turn with 50 tool calls adds maybe ~250ms on top of the 30+ seconds the LLM itself takes. Observably zero.

**If** a power user later wants the raw throughput of CLI-level bypass, it can be exposed as a **separate** opt-in setting ("skip the permission roundtrip for this provider") that has nothing to do with the autonomous toggle. Out of scope for this refactor; easy to add later.

## Scope of This Refactor

### In scope — delete

- `autonomous_apply_strategy` enum (`provider.rs`)
- `LaunchProfile` / `PostConnect` branch logic throughout
- `shouldReconnectForAutonomous` and its reconnect path (`session-connection-manager.ts`)
- `acp_set_execution_profile` Tauri command (`interaction_commands.rs`)
- `map_execution_profile_mode_id` on every provider
- `seed_client_launch_mode` and `reset_pending_mode_for_safe_resume` in `cc_sdk_client.rs`
- Claude `map_execution_profile_mode_id` (`claude_code.rs`)
- Copilot `map_execution_profile_mode_id` + autopilot URI constants (`copilot.rs`)
- Codex autonomous mapping in `codex_native_config.rs` (the `FullAccess` path tied to the autonomous build mode)
- The `requires_post_connect_execution_profile_reset` lifecycle policy field and its associated resume-time reset in `session_commands.rs` (once nothing else uses it)

### In scope — add

- A single policy hook in `InteractionStore.applyPermissionInteraction` (or a thin `permissionIngestor` wrapper) that runs `shouldAutoAccept` before the permission lands in `permissionsPending` as pending. Implementation-level detail deferred to planning, but the **invariant** is: no permission can be written to `pending` without running the policy first.
- Collapse `PermissionStore` into `InteractionStore` (or fold the map into `PermissionStore` — pick one owner). Implementation choice deferred to planning.
- `setAutonomousEnabled` simplifies to a hotState flip + `drainPendingForSession` for already-queued permissions. No backend call needed.
- Every provider that currently returns a non-empty `autonomous_supported_mode_ids()` continues to; Cursor and OpenCode start returning `&["build"]` (or whatever the supported UI mode is) since they're now structurally supported.

### Out of scope

- The UX of the autonomous toggle itself (already shipped, unchanged).
- Any change to the underlying `session/set_mode` wiring used for non-autonomous mode switching (plan ↔ build stays as-is).
- A separate "CLI-level bypass" power-user setting. Noted as follow-up; not part of this work.
- Any change to child-session auto-accept semantics — they keep working through the same policy hook.
- Changing the set of permission categories, reply handlers, or exit-plan handling.

## Success Criteria

1. Enabling autonomous on Claude, Codex, Copilot, Cursor, and OpenCode all go through **one** code path and use **one** enforcement mechanism (Acepe-side auto-accept).
2. Toggling autonomous on or off mid-session does not disconnect the CLI or require a reconnect.
3. The two classes of bug we fixed on 2026-04-11 are provably impossible under the new architecture: there is no `pending_mode_id` / `pending_options` path to clobber, and the auto-accept hook is the single entry point for writing permissions into `pending` (so it cannot become dead code without every permission becoming dead code).
4. A new provider can be added without touching any autonomous-related code. Autonomous support is automatic.
5. One integration test verifies auto-accept fires for every provider that emits permission requests.
6. All 527+ existing `packages/desktop/src/lib/acp/store/` tests still pass.
7. Rust clippy stays clean on `packages/desktop/src-tauri`.

## Key Decisions (locked in for planning)

- **Autonomous is an Acepe-side policy, not a provider capability.** Provider-specific enforcement mechanisms (`bypassPermissions`, `approvalPolicy: "never"`) are removed from the autonomous path.
- **Single enforcement point:** the policy hook lives at the single production write site for permissions (`applyPermissionInteraction` or equivalent).
- **`PermissionStore` and `InteractionStore` get collapsed into one owner.** The current façade split is what let auto-accept become dead code. Which direction the collapse goes is an implementation choice for planning.
- **Cursor and OpenCode gain autonomous support as a side effect.** Not a goal, but we don't suppress it.
- **CLI-level bypass stays out of scope.** It can be added later as an orthogonal power-user setting.

## Open Questions (deferred to planning)

- [Architectural] Collapse direction: does `InteractionStore` absorb `PermissionStore`'s behaviors (reply, drain, batch progress, auto-accept), or does `PermissionStore` absorb the `permissionsPending` map? Decide in planning based on which produces the shorter diff and fewer test changes.
- [Architectural] Where exactly does the policy hook sit — inline in `applyPermissionInteraction`, a dedicated `ingestPermission(raw)` method, or a pre-write middleware? Same answer drives whether `maybeAutoAcceptPending` (added today) is kept as the public API or inlined.
- [Scope] Do we delete `autonomous_apply_strategy` in the same PR that introduces the new policy hook, or stage it (hook first, provider cleanup second) to keep the diff reviewable?
- [Testing] What's the minimum set of integration tests that would have caught *both* of today's bugs? At minimum: one per provider that verifies "autonomous on + incoming permission request = auto-accept fires and no pending permission is visible to the UI."
- [Migration] Is there any in-flight session state (e.g. live Claude sessions launched today with `bypassPermissions`) that needs to be handled specially during the refactor, or can we assume a session restart is acceptable?
- [Risk] Is the per-tool-call IPC roundtrip cost actually negligible, or does the `can_use_tool` handler in `cc_sdk_client.rs` have hidden overhead worth measuring before committing? Quick instrumentation during planning, not a blocker.

## Dependencies / Assumptions

- Tauri IPC roundtrip cost for per-tool-call permission requests is on the order of single-digit ms. (To be spot-checked.)
- Claude's `cc_sdk` client can run with the default (non-bypass) permission mode and still reliably receive and handle tool call permission events.
- Codex's native client similarly handles default-approval mode without surprises when the autonomous-tied `approvalPolicy: "never"` path is removed.
- Cursor and OpenCode's CLIs send permission requests for at least the operations users expect to autonomous-approve (shell, file write, etc.). To be confirmed during planning for each.

## Next Steps

-> `/ce:plan` for structured implementation planning.
