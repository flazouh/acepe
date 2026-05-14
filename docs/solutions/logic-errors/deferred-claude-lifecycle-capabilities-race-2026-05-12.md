---
title: Deferred Claude sessions must promote lifecycle with capabilities
date: 2026-05-12
category: logic-errors
module: acp-session-lifecycle
problem_type: logic_error
component: assistant
severity: high
symptoms:
  - Claude Code agent panel stayed stuck on connecting after streaming tool calls
  - Follow-up send stayed disabled because canonical canSend never became true
  - The user's pending message could render below early tool-call rows
root_cause: async_timing
resolution_type: code_fix
related_components:
  - claude-cc-sdk-client
  - session-supervisor
  - session-state-graph
  - agent-panel-materializer
tags:
  - claude-code
  - deferred-session
  - session-lifecycle
  - can-send
  - optimistic-user-entry
  - god-architecture
---

# Deferred Claude sessions must promote lifecycle with capabilities

## Problem

Claude Code deferred sessions could start streaming tool calls while the panel still showed a connecting state and refused follow-up sends. The UI was correctly reading canonical actionability; the Rust deferred-session path had not promoted lifecycle authority with the capabilities needed for a canonical `Ready` transition.

## Symptoms

- The Claude Code thread remained visually stuck on connecting after provider output was already streaming.
- `actionability.canSend` stayed false/null because the canonical lifecycle never reached `Ready`.
- Session-state graph patches were logged before the frontend had a canonical projection for that session.
- During the first-send race, the optimistic user message could appear below tool-call rows.

## What Didn't Work

- Patching TypeScript sendability would have violated GOD architecture. `canSend`, lifecycle, activity, turn state, and capabilities are canonical-owned, so a frontend fallback would only hide the missing backend transition.
- Re-reading hot state or local connection state would have recreated the split-brain behavior that prior GOD work removed.
- Appending pending user rows at the tail was too broad: it preserved old behavior for normal transcripts but failed when tool-call deltas arrived before the canonical user row.

## Solution

Promote deferred Claude sessions through the Rust lifecycle authority and carry real capabilities through the reserved first-send activation:

- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs`
  - Thread `SessionRegistry` access through the existing `AppHandle` state path at Claude provider identity promotion.
  - Build `SessionGraphCapabilities` from the cached `ResumeSessionResponse` snapshot.
  - Call `SessionSupervisor::reserve_with_capabilities` instead of `reserve`, so the promoted deferred session checkpoint is `Reserved` with the provider's model/mode/command/config capabilities.

- `packages/desktop/src-tauri/src/acp/commands/interaction_commands.rs`
  - When a reserved first-send succeeds, build `ConnectionComplete` from the supervisor checkpoint capabilities rather than hardcoded defaults.
  - Keep the degraded fallback explicit and logged when capabilities are unexpectedly missing.

- `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts`
  - Insert a local optimistic user entry before tool-call rows only when no canonical user row exists yet.
  - If canonical user history exists, append the optimistic row at the tail so prior-turn tool calls stay attached to their original user turn.

- `packages/desktop/src/lib/acp/components/agent-panel/logic/agent-panel-display-model.ts`
  - Mirror the display-model row ordering guard for assistant-only rows while keeping row semantics canonical-derived.

## Why This Works

`SessionGraphRuntimeRegistry::apply_session_update_with_graph_seed` intentionally skips graph updates for sessions without a lifecycle checkpoint. That guard prevents provider facts from creating lifecycle existence. The fix preserves the guard and moves the missing creation step to the correct Rust seam: verified Claude provider identity promotion.

Once the promoted session has a supervisor checkpoint with capabilities, the reserved first-send path can emit a `ConnectionComplete` whose lifecycle reducer transitions the graph to `Ready`. `SessionGraphLifecycle::actionability_for_lifecycle` can then derive `canSend` canonically, so the composer becomes sendable without any TypeScript fallback.

The optimistic ordering fix handles the distinct presentation race without mutating canonical transcript state. A pending local user row is only spliced ahead of tool calls in the fresh-deferred case where there is no canonical user row yet; historical user/tool rows remain in their existing order.

## Prevention

- For deferred providers, lifecycle reservation must happen at the verified provider identity promotion seam, before buffered provider updates are drained into product state.
- Reserved-first-send `ConnectionComplete` should use supervisor checkpoint capabilities. Avoid adding a second live capability authority at send time.
- Tests should cover both sides of optimistic ordering:
  - no canonical user + early tool row -> pending user appears before the tool row
  - prior canonical user + prior tool row -> pending user appends after prior-turn rows
- Never repair missing `canSend` by reading frontend hot state. Missing canonical lifecycle means the upstream Rust lifecycle/envelope path is incomplete.

## Related Issues

- `docs/solutions/logic-errors/pre-reservation-provider-update-lifecycle-race-2026-04-30.md` — complementary lifecycle authority rule: provider updates must not create session lifecycle; explicit reservation/promotion must.
- `docs/solutions/best-practices/canonical-session-projection-ui-derivation-2026-05-01.md` — UI actionability derives from canonical projection only.
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md` — lifecycle/actionability and raw lane authority constraints.
