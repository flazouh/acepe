---
title: Agent panel content viewport rows should stay scene-owned and timer-local
date: 2026-05-01
category: best-practices
module: agent-panel
problem_type: best_practice
component: assistant
severity: medium
applies_when:
  - Reworking virtualized agent-panel content rows in Svelte 5
  - Adding a new AgentPanel scene entry union member
  - Deriving active or streaming row state across session switches
  - Passing shared renderer snippet context across package boundaries
  - Reading session turn or activity state in agent-panel content
tags:
  - agent-panel
  - viewport
  - svelte-5
  - renderer
  - canonical
  - virtualization
  - missing-rows
  - timers
root_cause: logic_error
resolution_type: code_fix
---

# Agent panel content viewport rows should stay scene-owned and timer-local

## Context

The Plan 004 agent-panel content rewrite replaced an overgrown `VirtualizedEntryList` with `SceneContentViewport`. The user-visible problem was unreliable content: rows sometimes failed to load while scrolling, blank conversation areas appeared, and the panel felt too brittle for long-running agent work.

The successful architecture is a narrow chain:

```text
SessionStateGraph
  -> materializeAgentPanelSceneFromGraph
  -> scene entries
  -> scene display rows
  -> SceneContentViewport
  -> AgentPanelConversationEntry
```

The follow-up review found that the remaining defects shared one theme: state or types were owned at the wrong layer. The viewport still broadcast a thinking timer to every row, cached assistant identity across sessions, dropped rich assistant message data while building display rows, and kept one content-parent fallback to forbidden hot-state fields. Svelte-only checks also caught type failures that the fast TypeScript check did not.

## Guidance

### 1. Keep the viewport responsible for layout, not row semantics

`SceneContentViewport` should own scroll, virtualization, fallback windows, and row wrapping. It should not reinterpret transcript DTOs or choose desktop-local row renderers. Every content row should resolve to an `AgentPanelConversationEntry` model and render through the shared component.

```svelte
<AgentPanelConversationEntry
	entry={sharedEntry}
	iconBasePath="/svgs/icons"
	{editToolTheme}
	{projectPath}
	{streamingAnimationMode}
	renderAssistantBlock={renderAssistantBlock}
/>
```

When a display row cannot be matched to canonical scene data, make the degradation explicit:

```ts
return {
	id: `missing:${displayKey}`,
	type: "missing",
	diagnosticLabel: displayKey,
};
```

Do not silently rebuild content from transcript-shaped rows just to avoid a blank panel. A visible `missing` row is better than an invisible architecture violation.

### 2. Do not broadcast live timers from the virtualized viewport

A `$state` timer read inside a `VList` render snippet subscribes every visible item to that timer. Even when only one row displays a live "thinking" duration, all visible rows re-evaluate every second.

Avoid this pattern:

```ts
let thinkingNowMs = $state(Date.now());

$effect(() => {
	thinkingNowMs = Date.now();
	const intervalId = window.setInterval(() => {
		thinkingNowMs = Date.now();
	}, 1000);

	return () => window.clearInterval(intervalId);
});
```

```svelte
{#snippet renderEntry(entry, index)}
	{@const durationMs = resolveSceneDisplayRowThinkingDurationMs(displayEntries, index, thinkingNowMs)}
	<AgentPanelConversationEntry entry={getSharedEntry(entry, durationMs, index)} />
{/snippet}
```

Instead, keep active timer state in the thinking row that actually needs it. Completed assistant thought durations should be resolved from stable timestamps or stored `thinkingDurationMs` without a live `now` dependency:

```svelte
{#snippet renderEntry(entry, index)}
	{@const durationMs = resolveSceneDisplayRowThinkingDurationMs(displayEntries, index)}
	<AgentPanelConversationEntry entry={getSharedEntry(entry, durationMs, index)} />
{/snippet}
```

This preserves virtualization performance: ordinary user, assistant, and tool rows do not subscribe to a timer they never display.

### 3. Derive streaming identity from the current scene snapshot

Do not cache `lastAssistantId` or processed-entry lengths in viewport state. That state crosses session boundaries and can be wrong on the first render after a session switch, especially when the next session has the same display-row shape.

Prefer current-scene derivation:

```ts
function getLatestAssistantSceneId(): string | null {
	const sceneArr = sceneEntries ?? [];
	const index = findLastAssistantSceneIndex(sceneArr);
	return index >= 0 ? (sceneArr[index]?.id ?? null) : null;
}

function isStreamingMergedAssistantEntry(
	entry: SceneDisplayRow | undefined,
	index: number | undefined
): boolean {
	return (
		isStreaming &&
		entry?.type === "assistant_merged" &&
		entry.memberIds.includes(getLatestAssistantSceneId() ?? "") &&
		index === displayEntries.length - 1
	);
}
```

The viewport can afford this derivation because it only scans the current scene entries, and it avoids an entire class of session-switch bugs.

### 4. Treat scene entry unions as renderer contracts

Adding a new `AgentPanelConversationEntry` union member is not complete until every renderer that consumes the union handles it. `AgentMissingEntry` had to be added to both:

- `AgentPanelConversationEntry`, the main shared row dispatcher
- `agent-panel-scene-entry.svelte`, the scene renderer that maps task children

The task-child mapper also needs an explicit `missing` branch before the tool-call fallthrough:

```ts
if (child.type === "missing") {
	return {
		id: child.id,
		type: "missing",
		title: child.title,
		message: child.message,
		diagnosticLabel: child.diagnosticLabel,
	};
}
```

If a union grows but a renderer keeps assuming "not user/assistant/thinking means tool", Svelte type-checking will report the mismatch and runtime rendering can produce malformed rows.

### 5. Put shared snippet context types in the shared contract

Snippet context consumed across packages is part of the public component contract. `AssistantRenderBlockContext` belongs in `packages/ui/src/components/agent-panel/types.ts` and the `@acepe/ui/agent-panel` barrel export, not only inside `agent-panel-conversation-entry.svelte`.

```ts
export interface AssistantRenderBlockContext {
	group: ChunkGroup;
	isStreaming?: boolean;
	revealKey?: string;
	projectPath?: string;
	streamingAnimationMode?: StreamingAnimationMode;
	onRevealActivityChange?: (active: boolean) => void;
}
```

This keeps desktop renderer injection type-safe without depending on named exports from a Svelte component module.

### 6. Preserve rich assistant messages through display-row merging

Scene display rows are layout rows. They must not flatten assistant content and discard structured message fields. When an `AgentAssistantEntry` already carries `message`, explicitly preserve its rich fields while building or merging display rows:

```ts
function createAssistantMessageFromSceneEntry(entry: AgentAssistantEntry): AssistantMessage {
	if (entry.message !== undefined) {
		return {
			chunks: entry.message.chunks,
			model: entry.message.model,
			displayModel: entry.message.displayModel,
			receivedAt: entry.message.receivedAt,
			thinkingDurationMs: entry.message.thinkingDurationMs,
		};
	}

	return {
		chunks: [{ type: "message", block: { type: "text", text: entry.markdown } }],
	};
}
```

Explicit field copying is intentional here: it preserves provenance and avoids accidental merges that make display rows their own semantic authority.

### 7. Content parents must stay canonical-only for session state

`AgentPanelContent` may accept explicit props from a controller. Without props, turn and waiting state should come from the canonical projection and live work projection. It must not fall back to `SessionTransientProjection` fields such as `turnState` or `activity`.

```ts
const turnState = $derived<TurnState>(
	turnStateProp ??
		(canonicalProjection != null
			? mapCanonicalTurnStateToHotTurnState(canonicalProjection.turnState)
			: "idle")
);

const isWaitingForResponse = $derived(
	isWaitingProp ?? sessionWorkProjection?.canonicalActivity === "awaiting_model"
);
```

If canonical data is missing, use a neutral value. Do not write `canonical ?? hotState` fallback code; widening or fixing canonical emission is the upstream solution.

### 8. Run Svelte-aware checks for Svelte changes

The fast desktop check can miss Svelte component type errors. In this rewrite, `svelte-check` caught:

- an undeclared `NativeFallbackReason` type in a `$state<T>` annotation
- a missing `AssistantRenderBlockContext` barrel export
- `AgentMissingEntry` not being handled in a scene renderer that consumed the expanded union

Use `bun run check:svelte` when touching Svelte component contracts, even if `bun run check` is green. If legacy GOD migration errors are still present, compare the error list before and after the change so new Svelte-only failures are not hidden by the baseline.

## Why This Matters

The agent panel is a long-running supervision surface. Small render-path shortcuts become user-visible reliability problems:

| Shortcut | Failure mode |
|---|---|
| Timer at viewport scope | Every visible virtual row re-evaluates once per second |
| Cached assistant identity | Streaming marker can point at a previous session |
| Transcript fallback for missing rows | Blank or semantically wrong content hides canonical scene bugs |
| New union member without renderer updates | Svelte type errors or malformed task children |
| Svelte component type not exported from `types.ts` | Desktop cannot inject host-specific snippets safely |
| Hot-state fallback in content parent | GOD split-brain returns through a "temporary" reader patch |

All of these are ownership problems. The durable fix is to keep content semantics in the graph/scene model, row behavior in row components, viewport behavior in the viewport, and session state in the canonical projection.

## When to Apply

- Rewriting or debugging `SceneContentViewport`, virtualized row construction, native fallback, or scroll-follow behavior.
- Adding any new `AgentPanelConversationEntry` union member.
- Adding a live timer, RAF loop, resize observer, or scroll observer to a virtualized list.
- Passing snippet context or renderer hooks between `packages/ui` and `packages/desktop`.
- Reading `turnState`, activity, lifecycle, capability, model, mode, or actionability state from agent-panel content.

## Examples

### Bad: viewport-level active-row state

```ts
let lastAssistantId = $state<string | null>(null);
let lastAssistantProcessedLength = 0;

$effect(() => {
	const count = sceneEntries?.length ?? 0;
	// The component instance can survive session switches, so this cache can be stale.
	if (count > lastAssistantProcessedLength) {
		// scan append-only range
	}
	lastAssistantProcessedLength = count;
});
```

### Good: current-scene derivation

```ts
function getLatestAssistantSceneId(): string | null {
	const sceneArr = sceneEntries ?? [];
	const index = findLastAssistantSceneIndex(sceneArr);
	return index >= 0 ? (sceneArr[index]?.id ?? null) : null;
}
```

### Bad: live `now` dependency in every row

```svelte
{@const durationMs = resolveSceneDisplayRowThinkingDurationMs(rows, index, thinkingNowMs)}
```

### Good: static viewport calculation plus row-local live timer

```svelte
{@const durationMs = resolveSceneDisplayRowThinkingDurationMs(rows, index)}
```

```svelte
<AgentThinkingSceneEntry durationMs={entry.durationMs} startedAtMs={entry.startedAtMs} />
```

### Bad: forbidden hot-state fallback

```ts
const turnState = canonicalProjection != null
	? mapCanonicalTurnStateToHotTurnState(canonicalProjection.turnState)
	: hotState?.turnState ?? "idle";
```

### Good: canonical-only reader

```ts
const turnState = canonicalProjection != null
	? mapCanonicalTurnStateToHotTurnState(canonicalProjection.turnState)
	: "idle";
```

## Related

- `docs/solutions/ui-bugs/agent-panel-graph-materialization-rendering-bug-2026-04-28.md` — graph-to-scene authority and ID-based scene matching.
- `docs/solutions/ui-bugs/agent-panel-composer-split-brain-canonical-actionability-2026-04-30.md` — no `canonical ?? hotState` fallback for agent-panel actionability.
- `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md` — canonical projection widening and hot-state deletion rules.
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md` — umbrella GOD architecture authority.
- `docs/solutions/best-practices/reactive-state-async-callbacks-svelte-2026-04-15.md` — Svelte 5 async callback and timer guidance.
- `docs/solutions/best-practices/svelte5-unconditional-snippet-props-2026-04-12.md` — Svelte 5 snippet pitfalls in agent-panel scene composition.
- `docs/solutions/logic-errors/thinking-indicator-scroll-handoff-2026-04-07.md` — thinking indicator reveal and scroll-follow handoff.
