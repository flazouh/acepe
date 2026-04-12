<script lang="ts">
import { AgentPanelConversationEntry, setIconConfig } from "@acepe/ui";
import { setContext, untrack } from "svelte";
import { VList, type VListHandle } from "virtua/svelte";
import type { SessionEntry } from "../../../application/dto/session.js";
import { SESSION_CONTEXT_KEY_EXPORT } from "../../../hooks/use-session-context.js";
import type { TurnState } from "../../../store/types.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import AssistantMessage from "../../messages/assistant-message.svelte";
import MessageWrapper from "../../messages/message-wrapper.svelte";
import UserMessage from "../../messages/user-message.svelte";
import { ToolCallRouter } from "../../tool-calls/index.js";
import { buildToolPresentation } from "../../tool-calls/tool-presentation.js";
import {
	createAutoScroll,
	type ScrollPositionProvider,
} from "../logic/create-auto-scroll.svelte.js";
import {
	THREAD_FOLLOW_CONTROLLER_CONTEXT,
	ThreadFollowController,
} from "../logic/thread-follow-controller.svelte.js";
import {
	buildVirtualizedDisplayEntries,
	getLatestRevealTargetKey,
	getVirtualizedDisplayEntryKey,
	shouldObserveRevealResize,
	THINKING_DISPLAY_ENTRY,
	type VirtualizedDisplayEntry,
} from "../logic/virtualized-entry-display.js";
import { mapVirtualizedDisplayEntryToConversationEntry } from "../scene/desktop-agent-panel-scene.js";

const MAX_VIEWPORT_RECOVERY_FRAMES = 8;
const MAX_EMPTY_RENDER_FRAMES = 4;

type VirtualizedEntryListProps = {
	panelId: string;
	entries: readonly SessionEntry[];
	turnState: TurnState;
	isWaitingForResponse: boolean;
	projectPath: string | undefined;
	/** Session ID for detecting session changes */
	sessionId: string;
	/** Whether the panel is in fullscreen mode (centers content with max-width) */
	isFullscreen?: boolean;
	/** Pre-computed modified files state from parent (avoids duplicate aggregateFileEdits calls) */
	modifiedFilesState?: ModifiedFilesState | null;
	/** Callback fired when near-bottom state changes (edge-triggered) */
	onNearBottomChange?: (isNearBottom: boolean) => void;
	/** Callback fired when near-top state changes */
	onNearTopChange?: (isNearTop: boolean) => void;
};

let {
	panelId,
	entries,
	turnState,
	isWaitingForResponse,
	projectPath,
	sessionId,
	isFullscreen = false,
	modifiedFilesState = null,
	onNearBottomChange,
	onNearTopChange,
}: VirtualizedEntryListProps = $props();

// Derive isStreaming from turnState for scroll behavior
const isStreaming = $derived(turnState === "streaming");

// ===== ICON CONTEXT (for nested components) =====
setIconConfig({ basePath: "/svgs/icons" });

// ===== SESSION CONTEXT (for nested components) =====
// Set consolidated session context for all nested message/tool-call components
// This eliminates prop drilling for projectPath, turnState, and modifiedFilesState
// Use getters to ensure reactivity (values update when they change)
setContext(SESSION_CONTEXT_KEY_EXPORT, {
	get sessionId() {
		return sessionId;
	},
	get panelId() {
		return panelId;
	},
	get projectPath() {
		return projectPath;
	},
	get turnState() {
		return turnState;
	},
	get modifiedFilesState() {
		return modifiedFilesState ?? undefined;
	},
});

// Also maintain legacy modifiedFilesState context for backward compatibility
setContext("modifiedFilesState", {
	get current() {
		return modifiedFilesState;
	},
});

// ===== REFS =====
let vlistRef: VListHandle | undefined = $state(undefined);
let wrapperRef: HTMLDivElement | null = $state(null);
let fallbackViewportRef: HTMLDivElement | null = $state(null);
let viewportNudgeOffsetPx = $state(0);
let useNativeFallback = $state(false);
const fallbackRowRefs = new Map<string, HTMLElement>();

// ===== AUTO-SCROLL =====
const autoScroll = createAutoScroll();
const followController = new ThreadFollowController({
	isFollowing: () => autoScroll.following,
	isNearBottom: () => autoScroll.isNearBottom(),
	revealListBottom: (force?: boolean) => autoScroll.revealLatest(force),
	getLatestTargetKey: () => {
		return getLatestRevealTargetKey(displayEntries);
	},
	getLatestUserTargetKey: () => {
		for (let i = displayEntries.length - 1; i >= 0; i -= 1) {
			const entry = displayEntries[i];
			if (entry?.type === "user") {
				return getKey(entry);
			}
		}
		return null;
	},
});
setContext(THREAD_FOLLOW_CONTROLLER_CONTEXT, followController);

// Sync VList ref to auto-scroll — Virtua's VListHandle satisfies ScrollPositionProvider directly.
// Cleanup clears the stale provider and cancels pending RAFs on unmount, preventing
// "null is not an object (evaluating 'get(ref).getScrollSize')" when virtua's internal
// ref is disposed before ThreadFollowController's pending RAF fires.
function createFallbackScrollProvider(viewport: HTMLDivElement): ScrollPositionProvider {
	return {
		getScrollSize: () => viewport.scrollHeight,
		getViewportSize: () => viewport.clientHeight,
		getScrollOffset: () => viewport.scrollTop,
		scrollToIndex: (index: number) => {
			const entry = displayEntries[index];
			if (!entry) {
				return;
			}
			const row = fallbackRowRefs.get(getKey(entry));
			if (row) {
				row.scrollIntoView({ block: "end" });
				return;
			}
			viewport.scrollTop = viewport.scrollHeight;
		},
	};
}

function bindFallbackRow(node: HTMLElement, key: string): { destroy: () => void } {
	fallbackRowRefs.set(key, node);
	return {
		destroy() {
			fallbackRowRefs.delete(key);
		},
	};
}

$effect(() => {
	const provider =
		useNativeFallback && fallbackViewportRef
			? createFallbackScrollProvider(fallbackViewportRef)
			: vlistRef;
	autoScroll.setVListRef(provider);
	return () => {
		autoScroll.setVListRef(undefined);
		followController.reset();
	};
});

// ===== HELPERS =====
function findLastAssistantIndex(sessionEntries: readonly SessionEntry[]): number {
	return sessionEntries.findLastIndex((e) => e.type === "assistant");
}

function getKey(entry: VirtualizedDisplayEntry): string {
	return getVirtualizedDisplayEntryKey(entry);
}

const activeRootToolCallId = $derived.by(() => {
	if (turnState !== "streaming" || entries.length === 0) {
		return null;
	}

	const lastEntry = entries[entries.length - 1];
	if (!lastEntry || lastEntry.type !== "tool_call") {
		return null;
	}

	const toolCall = lastEntry.message;
	if (toolCall.status === "completed" || toolCall.status === "failed") {
		return null;
	}

	if (toolCall.result !== null && toolCall.result !== undefined) {
		return null;
	}

	return toolCall.id;
});

// ===== DISPLAY ENTRIES =====
const mergedEntries = $derived(buildVirtualizedDisplayEntries(entries));
// Avoid spread-based allocation on every streaming update — reuse the merged
// reference directly when no thinking indicator is needed. When waiting, pre-allocate
// the result array to the known size rather than using concat/spread.
const displayEntriesRaw = $derived.by((): readonly VirtualizedDisplayEntry[] => {
	if (!isWaitingForResponse) return mergedEntries;
	const result = new Array<VirtualizedDisplayEntry>(mergedEntries.length + 1);
	for (let i = 0; i < mergedEntries.length; i++) {
		result[i] = mergedEntries[i]!;
	}
	result[mergedEntries.length] = THINKING_DISPLAY_ENTRY;
	return result;
});

// Restored historical sessions can mount while the panel is still settling into the
// layout tree. Virtua's root ResizeObserver ignores callbacks when offsetParent is null,
// leaving the viewport size at 0 and the rendered range empty even though totalSize is set.
// Fix: on the first mount with preloaded entries, give VList an empty dataset for one frame
// and then remount it with the real entries once layout has settled.
let shouldDeferInitialHydration = untrack(() => displayEntriesRaw.length > 0);
let hydrationFrameId: number | null = null;
let initialHydrationComplete = $state(!shouldDeferInitialHydration);
const displayEntries = $derived(
	initialHydrationComplete ? displayEntriesRaw : ([] as readonly VirtualizedDisplayEntry[])
);
const vlistRenderKey = $derived(initialHydrationComplete ? "hydrated" : "deferred");
const wrapperStyle = $derived(
	viewportNudgeOffsetPx === 0 ? "height: 100%;" : `height: calc(100% - ${viewportNudgeOffsetPx}px);`
);

$effect(() => {
	if (initialHydrationComplete || !shouldDeferInitialHydration) {
		return;
	}

	if (hydrationFrameId !== null) {
		return;
	}

	hydrationFrameId = requestAnimationFrame(() => {
		hydrationFrameId = null;
		initialHydrationComplete = true;
		shouldDeferInitialHydration = false;
	});

	return () => {
		if (hydrationFrameId !== null) {
			cancelAnimationFrame(hydrationFrameId);
			hydrationFrameId = null;
		}
	};
});

$effect(() => {
	if (!initialHydrationComplete || useNativeFallback || displayEntries.length === 0 || !vlistRef) {
		viewportNudgeOffsetPx = 0;
		return;
	}

	let cancelled = false;
	let attempts = 0;
	let recoveryFrameId: number | null = null;

	const recoverViewport = () => {
		if (cancelled) {
			return;
		}

		const viewportSize = vlistRef?.getViewportSize() ?? 0;
		if (viewportSize > 0) {
			viewportNudgeOffsetPx = 0;
			return;
		}

		if (attempts >= MAX_VIEWPORT_RECOVERY_FRAMES) {
			viewportNudgeOffsetPx = 0;
			if (import.meta.env.DEV) {
				console.warn(
					"[VLIST_FALLBACK]",
					"reason=zero_viewport",
					`sessionId=${sessionId}`,
					`entries=${displayEntries.length}`
				);
			}
			useNativeFallback = true;
			return;
		}

		viewportNudgeOffsetPx = viewportNudgeOffsetPx === 0 ? 1 : 0;
		attempts += 1;
		recoveryFrameId = requestAnimationFrame(recoverViewport);
	};

	recoveryFrameId = requestAnimationFrame(recoverViewport);

	return () => {
		cancelled = true;
		viewportNudgeOffsetPx = 0;
		if (recoveryFrameId !== null) {
			cancelAnimationFrame(recoveryFrameId);
		}
	};
});

$effect(() => {
	if (
		!initialHydrationComplete ||
		useNativeFallback ||
		displayEntries.length === 0 ||
		!wrapperRef
	) {
		return;
	}

	let cancelled = false;
	let remainingFrames = MAX_EMPTY_RENDER_FRAMES;
	let probeFrameId: number | null = null;

	const probeRenderedEntries = () => {
		if (cancelled) {
			return;
		}

		const renderedEntryCount = wrapperRef?.querySelectorAll("[data-entry-key]").length ?? 0;
		if (renderedEntryCount > 0) {
			return;
		}

		if (remainingFrames <= 0) {
			viewportNudgeOffsetPx = 0;
			if (import.meta.env.DEV) {
				console.warn(
					"[VLIST_FALLBACK]",
					"reason=no_rendered_entries",
					`sessionId=${sessionId}`,
					`entries=${displayEntries.length}`
				);
			}
			useNativeFallback = true;
			return;
		}

		remainingFrames -= 1;
		probeFrameId = requestAnimationFrame(probeRenderedEntries);
	};

	probeFrameId = requestAnimationFrame(probeRenderedEntries);

	return () => {
		cancelled = true;
		if (probeFrameId !== null) {
			cancelAnimationFrame(probeFrameId);
		}
	};
});

// ===== SCROLL TO BOTTOM ON HISTORICAL SESSION LOAD =====
// When a session mounts with pre-existing entries (historical), shouldDeferInitialHydration
// is true. Once hydration completes and VList renders, force a scroll to the bottom so the
// user sees the most recent messages instead of the top of the conversation.
const isHistoricalLoad = shouldDeferInitialHydration;
let historicalScrollApplied = false;
$effect(() => {
	if (!isHistoricalLoad || historicalScrollApplied || !initialHydrationComplete) return;
	if (displayEntries.length === 0) return;

	historicalScrollApplied = true;

	// Wait two frames: one for VList to process the entries, one for layout to settle.
	let frameCount = 0;
	let scrollRafId: number | null = null;
	const scrollAfterSettle = () => {
		frameCount += 1;
		if (frameCount < 2) {
			scrollRafId = requestAnimationFrame(scrollAfterSettle);
			return;
		}
		scrollRafId = null;
		autoScroll.revealLatest(true);
	};
	scrollRafId = requestAnimationFrame(scrollAfterSettle);

	return () => {
		if (scrollRafId !== null) {
			cancelAnimationFrame(scrollRafId);
		}
	};
});

// Sync item count for scrollToIndex calculations
const displayEntryCount = $derived(displayEntries.length);
$effect(() => {
	autoScroll.setItemCount(displayEntryCount);
});

function revealDisplayIndex(index: number, force?: boolean): boolean {
	return autoScroll.revealIndex(index, force);
}

// Handle VList scroll events — Virtua's onscroll fires with (offset: number)
// but autoScroll.handleScroll reads from the provider internally
function handleVListScroll(_offset: number): void {
	autoScroll.handleScroll();
}

function handleFallbackScroll(): void {
	autoScroll.handleScroll();
}

// ===== NEAR-BOTTOM NOTIFICATION =====
// Read autoScroll.nearBottom (reactive $state) so this $effect re-runs
// whenever scroll position changes. Using autoScroll.isNearBottom() would
// only read from the non-reactive provider, giving no reactive dependency.
$effect(() => {
	onNearBottomChange?.(autoScroll.nearBottom);
});

$effect(() => {
	onNearTopChange?.(autoScroll.nearTop);
});

// ===== PASSIVE WHEEL LISTENER =====
function wheelAction(node: HTMLElement): { destroy: () => void } {
	node.addEventListener("wheel", autoScroll.handleWheel, { passive: true });
	return {
		destroy() {
			node.removeEventListener("wheel", autoScroll.handleWheel);
		},
	};
}

// ===== LAST ASSISTANT TRACKING (for streaming indicator) =====
// Initialize with untrack to avoid creating reactive dependencies at init time.
// This ensures the streaming indicator shows immediately on session restore / tab switch.
let lastAssistantId = $state<string | null>(
	untrack(() => {
		const idx = findLastAssistantIndex(entries);
		return idx >= 0 ? (entries[idx]?.id ?? null) : null;
	})
);
let lastAssistantProcessedLength = untrack(() => entries.length);
$effect(() => {
	const count = entries.length;
	if (count === lastAssistantProcessedLength) return;
	if (count > lastAssistantProcessedLength) {
		for (let i = count - 1; i >= lastAssistantProcessedLength; i--) {
			if (entries[i].type === "assistant") {
				lastAssistantId = entries[i].id;
				break;
			}
		}
	} else {
		const idx = findLastAssistantIndex(entries);
		lastAssistantId = idx >= 0 ? (entries[idx]?.id ?? null) : null;
	}
	lastAssistantProcessedLength = count;
});

// ===== PUBLIC API =====
export function scrollToBottom(options?: { force?: boolean }) {
	followController.requestLatestReveal({ force: options?.force });
}

export function prepareForNextUserReveal(options?: { force?: boolean }) {
	followController.prepareForNextUserReveal(options);
}

export function scrollToTop() {
	if (useNativeFallback && fallbackViewportRef) {
		fallbackViewportRef.scrollTop = 0;
		return;
	}
	vlistRef?.scrollToIndex(0);
}

function shouldUseDesktopToolRenderer(entry: Extract<SessionEntry, { type: "tool_call" }>): boolean {
	return buildToolPresentation({ toolCall: entry.message }).useDesktopRenderer;
}
</script>

<!--
	Virtual scrolling using Virtua with passive wheel detection.
	VList config:
	- bufferSize: pixels of content to render outside viewport (800px = ~6 items)
	- itemSize: estimated average item height in px for initial layout calculations
	- contain: strict prevents layout recalculation from propagating to parent
-->
<div bind:this={wrapperRef} use:wheelAction class="h-full min-h-0" style={wrapperStyle}>
	{#snippet renderEntry(entry: VirtualizedDisplayEntry, index: number)}
		{@const sharedEntry = mapVirtualizedDisplayEntryToConversationEntry(
			entry,
			turnState,
			isStreaming &&
				entry.type !== "thinking" &&
				((entry.type === "assistant" && entry.id === (lastAssistantId ?? "")) ||
					(entry.type === "assistant_merged_thoughts" &&
						entry.memberIds.includes(lastAssistantId ?? ""))) &&
				index === displayEntries.length - 1,
			activeRootToolCallId
		)}
		<MessageWrapper
			entryIndex={index}
			entryKey={getKey(entry)}
			messageId={entry.type === "user" ? entry.id : undefined}
			observeRevealResize={shouldObserveRevealResize(displayEntries, entry, isStreaming)}
			revealEntryIndex={revealDisplayIndex}
			{isFullscreen}
		>
			{#if entry.type === "user"}
				<UserMessage message={entry.message} />
			{:else if entry.type === "assistant"}
				<AssistantMessage
					message={entry.message}
					isStreaming={isStreaming &&
						entry.id === (lastAssistantId ?? "") &&
						index === displayEntries.length - 1}
					{projectPath}
				/>
			{:else if entry.type === "assistant_merged_thoughts"}
				<AssistantMessage
					message={entry.message}
					isStreaming={isStreaming &&
						entry.memberIds.includes(lastAssistantId ?? "") &&
						index === displayEntries.length - 1}
					{projectPath}
				/>
			{:else if entry.type === "tool_call" && shouldUseDesktopToolRenderer(entry)}
				<ToolCallRouter toolCall={entry.message} {turnState} {projectPath} />
			{:else}
				<AgentPanelConversationEntry entry={sharedEntry} iconBasePath="/svgs/icons" />
			{/if}
		</MessageWrapper>
	{/snippet}

	{#if useNativeFallback}
		<div
			bind:this={fallbackViewportRef}
			data-testid="native-fallback"
			class="h-full overflow-y-auto"
			onscroll={handleFallbackScroll}
		>
			{#each displayEntries as entry, index (getKey(entry))}
				<div use:bindFallbackRow={getKey(entry)}>
					{@render renderEntry(entry, index)}
				</div>
			{/each}
		</div>
	{:else}
		{#key `${sessionId}:${vlistRenderKey}`}
			<VList
				bind:this={vlistRef}
				data={displayEntries}
				{getKey}
				onscroll={handleVListScroll}
				bufferSize={800}
				itemSize={120}
				class="h-full"
				style="contain: strict;"
			>
				{#snippet children(entry: VirtualizedDisplayEntry, index: number)}
					{@render renderEntry(entry, index)}
				{/snippet}
			</VList>
		{/key}
	{/if}
</div>
