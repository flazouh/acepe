---
title: Agent panel restored sessions must render from the canonical graph scene
date: 2026-04-28
category: ui-bugs
module: agent-panel
problem_type: ui_bug
component: assistant
severity: high
symptoms:
  - Restored sessions showed minimal transcript-derived tool rows instead of rich canonical tool calls
  - The agent panel flickered from a minimal restored view to a richer connected view
  - Planning-next-move and tool-call rows were missing or collapsed in restored sessions
  - Virtualized display rows could miss canonical scene entries after assistant row merging
  - Stale non-terminal provider operations could be restored as running when the journal was ahead
root_cause: logic_error
resolution_type: code_fix
related_components:
  - session-graph
  - transcript-adapters
  - operation-projection
  - session-open-snapshot
tags:
  - agent-panel
  - session-graph
  - materialization
  - restored-sessions
  - transcript
  - canonical
  - lifecycle
  - rendering
---

# Agent panel restored sessions must render from the canonical graph scene

## Problem

Restored agent-panel sessions rendered from transcript-shaped compatibility DTOs before live connect/replay delivered richer operation evidence. The user-visible result was a minimal restored panel that later flickered into the full connected panel with proper tool calls, planning rows, and action state.

The architecture invariant is: transcript snapshots are the ordering/history spine only. Tool semantics, operation output, permission/question state, lifecycle, activity, and actionability must flow through the canonical session graph into an `AgentPanelSceneModel`.

## Symptoms

- Restored sessions showed placeholder or minimal tool-call rows even though `SessionOpenFound` already contained rich operation snapshots.
- Planning-next-move/tool-call activity disappeared or collapsed until connect/replay updated frontend state.
- The panel appeared in a minimal state, disappeared or changed lifecycle state, then reappeared with full connected content.
- Consecutive assistant rows merged by virtualization shifted display indexes, so canonical tool scene entries were silently missed and the legacy desktop tool renderer took over.
- When provider history lagged behind the journal, non-terminal operations from stale provider projections could be restored as if they were still running.

## What Didn't Work

- **Enriching transcript adapters.** Transcript snapshots are intentionally text/order-only. Making them carry rich tool evidence duplicates the operation graph and reintroduces provider-specific semantics at the wrong layer.
- **Hydrating operation state from transcript rows.** This creates split authority: restored transcript rows can overwrite or compete with canonical operation snapshots.
- **Relying on connect/replay to repair the UI.** That makes restored-open incomplete by design and causes the exact minimal-to-rich flicker users saw.
- **Matching scene rows by display index.** The virtualized list can merge consecutive assistant messages into one display row, while graph scene entries remain transcript-aligned. Index equality is not a valid invariant.
- **Treating stale provider projections as live truth.** If the canonical journal is ahead, a provider snapshot cannot safely resurrect in-progress tools from older history.

## Solution

### Build the scene from the graph, not from transcript DTOs

Add a pure graph materialization boundary:

```ts
materializeAgentPanelSceneFromGraph({
	panelId,
	graph,
	header,
	composer,
	strips,
	cards,
	sidebars,
	chrome,
});
```

The materializer walks `graph.transcriptSnapshot.entries` for ordering, then resolves semantics from graph-owned stores:

- `operations` for rich tool title, status, arguments, output, task children, todos, questions, and degradation state,
- `interactions` for permission/question/approval truth,
- `lifecycle`, `activity`, and `actionability` for header status and CTAs.

Transcript tool rows without matching operation evidence render explicitly as pending or degraded canonical scene rows, not as successful placeholder content.

### Demote transcript adapters to spine-only

`SessionEntryStore` no longer hydrates `OperationStore` from preloaded or transcript rows. The transcript snapshot adapter now emits minimal tool spine messages, and the desktop `ToolCallRouter` is only an optimistic fallback before canonical scene entries exist.

This keeps restored-open and live updates on the same authority path:

```text
provider facts/history/live events
  -> provider adapter edge
  -> canonical session graph
  -> graph-to-scene materializer
  -> AgentPanelSceneModel
  -> @acepe/ui
```

### Match virtualized rows by id, not by index

The virtualized display list can merge assistant rows, so display indexes and scene indexes diverge.

```ts
export function createGraphSceneEntryIndex(
	sceneEntries: readonly AgentPanelSceneEntryModel[] | undefined
): ReadonlyMap<string, AgentPanelSceneEntryModel> | undefined {
	if (sceneEntries === undefined) return undefined;

	const entriesById = new Map<string, AgentPanelSceneEntryModel>();
	for (const sceneEntry of sceneEntries) {
		if (!entriesById.has(sceneEntry.id)) {
			entriesById.set(sceneEntry.id, sceneEntry);
		}
	}
	return entriesById;
}

export function findGraphSceneEntryForDisplayEntry(
	entry: VirtualizedDisplayEntry | undefined,
	sceneEntriesById: ReadonlyMap<string, AgentPanelSceneEntryModel> | undefined
): AgentPanelSceneEntryModel | undefined {
	if (
		entry === undefined ||
		entry.type === "thinking" ||
		entry.type === "assistant_merged" ||
		sceneEntriesById === undefined
	) {
		return undefined;
	}

	return sceneEntriesById.get(getVirtualizedDisplayEntryKey(entry));
}
```

Duplicate scene IDs indicate a violated graph/materializer invariant. The map keeps the first entry so rendering remains deterministic while tests and review can surface the upstream duplication instead of letting the virtualized list pick a row by position.

The regression test must include two assistant transcript rows collapsed into one `assistant_merged` display row before a tool row.

### Let canonical failure state drive scene status

The scene/header status must reflect canonical turn failure and graph activity even before lifecycle catches up.

```ts
function mapGraphStatus(graph: SessionStateGraph): AgentPanelSessionStatus {
	const lifecycleStatus = graph.lifecycle.status;
	if (
		lifecycleStatus === "failed" ||
		graph.activity.kind === "error" ||
		graph.turnState === "Failed"
	) {
		return "error";
	}

	// warming/running/done/idle/connected cases follow
}
```

### Keep operation evidence monotonic across replay

Rust projection and reducer paths use a shared `merge_operation_snapshot_evidence` so sparse replay cannot erase richer tool evidence. Conflicting replay degrades the canonical operation instead of duplicating it or pretending nothing happened.

This protects restored tool rows from losing title/output/result evidence when provider history replays a thinner version of the same operation.

### Degrade stale active provider operations on open

When provider projection history is behind the canonical journal, restored-open may keep transcript content but must not resurrect non-terminal operations as live work.

```rust
fn sanitize_operations_for_projection_frontier(
    operations: Vec<OperationSnapshot>,
    projection_is_behind_journal: bool,
) -> Vec<OperationSnapshot> {
    if !projection_is_behind_journal {
        return operations;
    }

    operations
        .into_iter()
        .map(downgrade_stale_active_operation)
        .collect()
}
```

Non-terminal stale operations become `OperationState::Degraded` with `OperationDegradationCode::AbsentFromHistory`. Terminal historical operations remain renderable as history.

## Why This Works

The fix removes split authority from the agent-panel rendering path. Transcript entries still provide ordering and stable row identity, but every semantic answer comes from the graph:

- What did the tool do? Operation snapshot.
- Is the tool pending, running, blocked, completed, failed, or degraded? Operation state.
- Is the session failed, running, detached, or ready? Lifecycle/activity/turn state.
- Can the user send, resume, retry, or archive? Actionability.

Because restored-open receives a graph snapshot before connect, the first render can be rich and canonical. Connect/replay becomes content-inert for already-restored history instead of being the step that repairs missing UI.

ID-based scene matching also makes the render path independent of presentation list shape. Virtualization can merge or split rows without losing the canonical scene entry for a tool row.

## Prevention

- Treat transcript adapters as spine-only. They may preserve order and row identity, but must not hydrate operation stores, preserve rich legacy tool DTOs, or synthesize semantic tool state.
- Add behavior tests that prove restored-open renders rich tool content before connect and that connect lifecycle updates do not mutate historical scene content.
- Add virtualized-list tests where assistant rows merge before a tool row; assert the graph scene entry is still selected by id.
- Add materializer tests for every status authority branch: lifecycle failed, activity error, turn failed, running operation, awaiting model, completed, idle, and empty connected state.
- Add Rust open-snapshot tests for provider projection lag. Non-terminal operations from stale projections should degrade; terminal operation history should remain renderable.
- Keep operation replay idempotent and monotonic: sparse replay must not erase richer evidence, and conflicting replay must degrade rather than duplicate.

## Related Issues

- `docs/solutions/logic-errors/reserved-first-send-routed-through-resume-2026-04-28.md` — sibling session-open authority fix for `Reserved` vs `Detached` routing.
- `docs/solutions/architectural/graph-backed-session-activity-authority-2026-04-23.md` — adjacent authority-chain doc for graph-backed activity.
- `docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md` — foundational graph authority and transcript/operation split.
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md` — broader target architecture this fix completes for the scene boundary.
- `docs/solutions/logic-errors/terminal-state-guard-missing-blocked-2026-04-25.md` — related state-protection pattern for lagging operation events.
- GitHub issues #144 and #147 are adjacent agent-panel architecture/UI-boundary work, but no issue directly covered graph-to-scene restore materialization.
