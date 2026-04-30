---
title: Agent Panel Composer Split-Brain From Non-Canonical Actionability
date: 2026-04-30
category: ui-bugs
module: acp-session-state
problem_type: ui_bug
component: assistant
symptoms:
  - Agent Panel showed Interrupt after the canonical session had completed.
  - Agent Panel showed Planning next moves while canonical activity was idle.
  - The user saw Send appear to do nothing even though the agent produced a completed response.
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - svelte-agent-panel
  - canonical-session-projection
tags: [acp, session-state, agent-panel, canonical-authority, god, composer, stale-ui, svelte]
---

# Agent Panel Composer Split-Brain From Non-Canonical Actionability

## Problem

After a Copilot ACP turn completed, Rust's canonical `SessionStateGraph` correctly reported the session as ready, idle, completed, and sendable, but the frontend still rendered active-turn UI such as `Interrupt` and `Planning next moves`. The send path had worked; the user-visible failure was that the Agent Panel and composer were reading stale non-canonical state for fields that overlap the canonical projection.

## Symptoms

- `acp_get_session_state` returned `lifecycle.status = "ready"` and `lifecycle.actionability.canSend = true`.
- The same snapshot returned `activity.kind = "idle"` and `turnState = "Completed"`.
- The Agent Panel still showed active-work affordances such as `Interrupt` or `Planning next moves`.
- The user could reasonably conclude that sending a message did nothing, even though the streaming log contained tool calls and a final assistant response.

## What Didn't Work

- Treating the raw streaming log as the source of truth for the user-visible bug was misleading. The log proved the agent responded; it did not explain why the panel stayed visually busy.
- Looking for a Rust turn-completion failure was also misleading. The canonical backend query already had the correct terminal state.
- Adding a `canonical ?? hotState` fallback would have preserved the split-brain. If stale runtime state remained reachable, it could keep overriding the canonical completed/idle state.

## Solution

Move the Agent Panel composer/actionability surface to a single canonical derivation. `deriveCanonicalAgentPanelSessionState` maps the canonical projection into the exact UI contract needed by the panel and input:

```ts
const canonicalPanelSessionState = $derived.by(() =>
  deriveCanonicalAgentPanelSessionState({
    lifecycle: canonicalProjection?.lifecycle ?? null,
    activity: canonicalProjection?.activity ?? null,
    turnState: canonicalProjection?.turnState ?? null,
    hasEntries: sessionEntries.length > 0,
    hasOptimisticPendingEntry,
  })
);

const panelSessionStatus = $derived(canonicalPanelSessionState.sessionStatus);
const sessionIsConnected = $derived(canonicalPanelSessionState.isConnected);
const sessionIsStreaming = $derived(canonicalPanelSessionState.isStreaming);
const showPlanningIndicator = $derived(canonicalPanelSessionState.showPlanningIndicator);
const sessionCanSubmit = $derived(canonicalPanelSessionState.canSubmit);
const sessionShowStop = $derived(canonicalPanelSessionState.showStop);
```

The old path in `agent-panel.svelte` composed `deriveLiveSessionWorkProjection`, operation/interaction snapshots, legacy presentation status, and runtime `canSubmit/showStop`. That made the panel a reader of two competing session-state systems. Removing that path for status, Send/Stop, and planning made `CanonicalSessionProjection` the only authority.

`AgentInput` also had to prefer the canonical parent prop for busy/stop state:

```ts
const isAgentBusy = $derived(
  props.sessionShowStop ?? sessionRuntimeState?.canCancel ?? false
);
```

For established sessions, the parent now always passes `sessionShowStop` from the canonical derivation, so stale `sessionRuntimeState?.canCancel` cannot override a canonical `false`.

Regression coverage lives in `session-status-mapper.test.ts`:

```ts
expect(
  deriveCanonicalAgentPanelSessionState({
    lifecycle: lifecycle("ready"),
    activity: {
      kind: "idle",
      activeOperationCount: 0,
      activeSubagentCount: 0,
      dominantOperationId: null,
      blockingInteractionId: null,
    },
    turnState: "Completed",
    hasEntries: true,
  })
).toEqual({
  sessionStatus: "done",
  isConnected: true,
  isStreaming: false,
  showPlanningIndicator: false,
  canSubmit: true,
  showStop: false,
});
```

## Why This Works

The GOD architecture rule is that lifecycle, activity, turn state, terminal failure, and actionability have one frontend source: the Rust-owned canonical projection. The fixed derivation uses only `canonicalProjection.lifecycle`, `canonicalProjection.activity`, and `canonicalProjection.turnState` for fields that describe session actionability or activity.

`hasOptimisticPendingEntry` is the only local input mixed in. It is a pre-canonical UI affordance used while the initial send has not yet materialized a canonical session; it does not assert lifecycle, turn state, or actionability once canonical data exists.

## Prevention

- Treat Send/Stop, `isAgentBusy`, planning indicators, and session presentation status as canonical-overlap fields. They should not read `runtimeState`, hot state, or legacy work projections.
- Do not add `canonical ?? hotState` fallbacks for lifecycle, turn, activity, or actionability. If canonical is missing, fix the upstream canonical envelope path or handle the pre-canonical state explicitly.
- Keep the completed-idle regression test: `ready + canSend + activity.idle + turnState.Completed` must render as sendable with no stop/planning affordance.
- When adding new composer affordances, put the mapping in `deriveCanonicalAgentPanelSessionState` first so the boundary stays testable and auditable.

## Related Issues

- `docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md` establishes the canonical graph authority model.
- `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md` documents the migration away from hot-state authority.
- `docs/solutions/ui-bugs/agent-panel-graph-materialization-rendering-bug-2026-04-28.md` covers a sibling Agent Panel split-brain in transcript/operation rendering.
- `docs/solutions/logic-errors/reserved-first-send-routed-through-resume-2026-04-28.md` covers the same `canonical ?? hotState` anti-pattern in send routing.
