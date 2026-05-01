<script lang="ts">
import { AgentPanelConversationEntry, setIconConfig } from "@acepe/ui";
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import { setContext, untrack } from "svelte";
import { VList, type VListHandle } from "virtua/svelte";
import { SESSION_CONTEXT_KEY_EXPORT } from "../../../hooks/use-session-context.js";
import { getChatPreferencesStore } from "../../../store/chat-preferences-store.svelte.js";
import type { TurnState } from "../../../store/types.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import { DEFAULT_STREAMING_ANIMATION_MODE } from "../../../types/streaming-animation-mode.js";
import AssistantMessage from "../../messages/assistant-message.svelte";
import MessageWrapper from "../../messages/message-wrapper.svelte";
import UserMessage from "../../messages/user-message.svelte";
import {
	createAutoScroll,
	type ScrollPositionProvider,
} from "../logic/create-auto-scroll.svelte.js";
import {
	createGraphSceneEntryIndex,
	findGraphSceneEntryForDisplayEntry,
} from "../logic/graph-scene-entry-match.js";
import {
	THREAD_FOLLOW_CONTROLLER_CONTEXT,
	ThreadFollowController,
} from "../logic/thread-follow-controller.svelte.js";
import {
	buildVirtualizedDisplayEntriesFromScene,
	findLastAssistantSceneIndex,
	getLatestRevealTargetKey,
	getVirtualizedDisplayEntryKey,
	getVirtualizedDisplayEntryTimestampMs,
	resolveDisplayEntryThinkingDurationMs,
	shouldObserveRevealResize,
	THINKING_DISPLAY_ENTRY,
	type VirtualizedDisplayEntry,
} from "../logic/virtualized-entry-display.js";
import { mapVirtualizedDisplayEntryToConversationEntry } from "../scene/desktop-agent-panel-scene.js";
import { useTheme } from "../../../../components/theme/context.svelte.js";
import { getWorkerPool } from "../../../utils/worker-pool-singleton.js";
import {
	pierreDiffsUnsafeCSS,
	registerCursorThemeForPierreDiffs,
} from "../../../utils/pierre-diffs-theme.js";

const MAX_VIEWPORT_RECOVERY_FRAMES = 8;
const MAX_EMPTY_RENDER_FRAMES = 4;
const NATIVE_FALLBACK_ENTRY_LIMIT = 80;

type VirtualizedEntryListProps = {
	panelId: string;
	sceneEntries?: readonly AgentPanelSceneEntryModel[];
	turnState: TurnState;
	isWaitingForResponse: boolean;
	projectPath: string | undefined;
	/** Session ID for detecting session changes */
	sessionId: string | null;
	/** Whether the panel is in fullscreen mode (centers content with max-width) */
	isFullscreen?: boolean;
	/** Pre-computed modified files state from parent (avoids duplicate aggregateFileEdits calls) */
	modifiedFilesState?: ModifiedFilesState | null;
	/** Callback fired when near-bottom state changes (edge-triggered) */
	onNearBottomChange?: (isNearBottom: boolean) => void;
	/** Callback fired when near-top state changes */
	onNearTopChange?: (isNearTop: boolean) => void;
};

type AssistantDisplayEntry = Extract<VirtualizedDisplayEntry, { type: "assistant" }>;
type UserDisplayEntry = Extract<VirtualizedDisplayEntry, { type: "user" }>;
type IndexedDisplayEntry = {
	entry: VirtualizedDisplayEntry;
	index: number;
};

const EMPTY_ASSISTANT_MESSAGE: AssistantDisplayEntry["message"] = {
	chunks: [],
};
const EMPTY_USER_MESSAGE: UserDisplayEntry["message"] = {
	content: { type: "text", text: "" },
	chunks: [],
};

let {
	panelId,
	sceneEntries,
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
const chatPrefs = getChatPreferencesStore();
const streamingAnimationMode = $derived(
	chatPrefs?.streamingAnimationMode ?? DEFAULT_STREAMING_ANIMATION_MODE
);
const sceneEntriesById = $derived(createGraphSceneEntryIndex(sceneEntries));

// ===== EDIT TOOL THEME =====
const themeState = useTheme();
const editToolTheme = $derived({
	theme: themeState.effectiveTheme,
	themeNames: { dark: "Cursor Dark", light: "pierre-light" },
	workerPool: getWorkerPool(),
	onBeforeRender: registerCursorThemeForPierreDiffs,
	unsafeCSS: pierreDiffsUnsafeCSS,
});
let thinkingNowMs = $state(Date.now());

$effect(() => {
	if (!isWaitingForResponse) {
		return;
	}

	thinkingNowMs = Date.now();
	const intervalId = window.setInterval(() => {
		thinkingNowMs = Date.now();
	}, 1000);

	return () => {
		window.clearInterval(intervalId);
	};
});

// ===== ICON CONTEXT (for nested components) =====
setIconConfig({ basePath: "/svgs/icons" });

// ===== SESSION CONTEXT (for nested components) =====
// Set consolidated session context for all nested message/tool-call components
// This eliminates prop drilling for projectPath, turnState, and modifiedFilesState
// Use getters to ensure reactivity (values update when they change)
setContext(SESSION_CONTEXT_KEY_EXPORT, {
	get sessionId() {
			return sessionId ?? undefined;
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
function getKey(entry: VirtualizedDisplayEntry | undefined, index?: number): string {
	if (!entry) {
		reportMissingVirtualizedEntry(index);
		return `missing-entry-${String(index ?? "unknown")}`;
	}

	return getVirtualizedDisplayEntryKey(entry);
}

function getUserMessage(entry: VirtualizedDisplayEntry | undefined): UserDisplayEntry["message"] {
	return entry?.type === "user" ? entry.message : EMPTY_USER_MESSAGE;
}

function getAssistantMessage(
	entry: VirtualizedDisplayEntry | undefined
): AssistantDisplayEntry["message"] {
	return entry?.type === "assistant" ? entry.message : EMPTY_ASSISTANT_MESSAGE;
}

function getMergedAssistantMessage(
	entry: VirtualizedDisplayEntry | undefined,
	thinkingDurationMs: number | null
): AssistantDisplayEntry["message"] {
	if (entry?.type !== "assistant_merged") {
		return EMPTY_ASSISTANT_MESSAGE;
	}

	return {
		chunks: entry.message.chunks,
		model: entry.message.model,
		displayModel: entry.message.displayModel,
		receivedAt: entry.message.receivedAt,
		thinkingDurationMs: thinkingDurationMs ?? entry.message.thinkingDurationMs,
	};
}

function getSharedEntry(
	entry: VirtualizedDisplayEntry | undefined,
	thinkingDurationMs: number | null
) {
	const graphEntry = getGraphSceneEntry(entry);
	if (graphEntry !== undefined) {
		return graphEntry;
	}
	return mapVirtualizedDisplayEntryToConversationEntry(
		entry ?? THINKING_DISPLAY_ENTRY,
		turnState,
		isStreaming &&
			entry !== undefined &&
			entry.type !== "thinking" &&
			((entry.type === "assistant" && entry.id === (lastAssistantId ?? "")) ||
				(entry.type === "assistant_merged" && entry.memberIds.includes(lastAssistantId ?? ""))),
		activeRootToolCallId,
		thinkingDurationMs ?? undefined
	);
}

function getGraphSceneEntry(
	entry: VirtualizedDisplayEntry | undefined
): AgentPanelSceneEntryModel | undefined {
	return findGraphSceneEntryForDisplayEntry(entry, sceneEntriesById);
}

function isStreamingAssistantEntry(
	entry: VirtualizedDisplayEntry | undefined,
	index: number
): boolean {
	return (
		isStreaming &&
		entry?.type === "assistant" &&
		entry.id === (lastAssistantId ?? "") &&
		index === displayEntries.length - 1
	);
}

function isStreamingMergedAssistantEntry(
	entry: VirtualizedDisplayEntry | undefined,
	index: number
): boolean {
	return (
		isStreaming &&
		entry?.type === "assistant_merged" &&
		entry.memberIds.includes(lastAssistantId ?? "") &&
		index === displayEntries.length - 1
	);
}

let warnedMissingEntryKeys = new Set<string>();

function reportMissingVirtualizedEntry(index: number | undefined): void {
	if (!import.meta.env.DEV) {
		return;
	}

	const warningKey = `${sessionId ?? "pre-session"}:${String(index ?? "unknown")}:${displayEntries.length}`;
	if (warnedMissingEntryKeys.has(warningKey)) {
		return;
	}
	warnedMissingEntryKeys.add(warningKey);

	const nearbyEntries = displayEntries
		.slice(Math.max(0, (index ?? 0) - 2), Math.min(displayEntries.length, (index ?? 0) + 3))
		.map((entry) => {
			if (!entry) {
				return { type: "missing" };
			}

			return {
				type: entry.type,
				key: getVirtualizedDisplayEntryKey(entry),
			};
		});

	console.warn("[AGENT_PANEL_MISSING_ENTRY]", {
		panelId,
		sessionId,
		index,
		displayEntriesLength: displayEntries.length,
		mergedEntriesLength: mergedEntries.length,
		isWaitingForResponse,
		turnState,
		nearbyEntries,
	});
}

const activeRootToolCallId = $derived.by(() => {
	if (turnState !== "streaming") {
		return null;
	}

	const sceneArr = sceneEntries ?? [];
	if (sceneArr.length === 0) {
		return null;
	}

	const lastEntry = sceneArr[sceneArr.length - 1];
	if (!lastEntry || lastEntry.type !== "tool_call") {
		return null;
	}

	// Use AgentToolEntry.status — "done"/"error"/"cancelled" mean the tool call is finished.
	if (
		lastEntry.status === "done" ||
		lastEntry.status === "error" ||
		lastEntry.status === "cancelled"
	) {
		return null;
	}

	return lastEntry.id;
});

// ===== DISPLAY ENTRIES =====
const mergedEntries = $derived(buildVirtualizedDisplayEntriesFromScene(sceneEntries ?? []));
const thinkingIndicatorStartedAtMs = $derived.by(() => {
	if (!isWaitingForResponse) {
		return null;
	}

	for (let index = mergedEntries.length - 1; index >= 0; index -= 1) {
		const entry = mergedEntries[index];
		if (!entry) {
			continue;
		}
		const timestampMs = getVirtualizedDisplayEntryTimestampMs(entry);
		if (timestampMs !== null) {
			return timestampMs;
		}
	}

	return null;
});
// Avoid spread-based allocation on every streaming update — reuse the merged
// reference directly when no thinking indicator is needed. When waiting, pre-allocate
// the result array to the known size rather than using concat/spread.
const displayEntriesRaw = $derived.by((): readonly VirtualizedDisplayEntry[] => {
	if (!isWaitingForResponse) return mergedEntries;
	const result: VirtualizedDisplayEntry[] = [];
	result.length = mergedEntries.length + 1;
	let writeIndex = 0;
	for (const entry of mergedEntries) {
		result[writeIndex] = entry;
		writeIndex += 1;
	}
	result[writeIndex] = {
		type: THINKING_DISPLAY_ENTRY.type,
		id: THINKING_DISPLAY_ENTRY.id,
		startedAtMs: thinkingIndicatorStartedAtMs,
	};
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
let lastRenderedSessionId = $state(untrack(() => sessionId));
const displayEntries = $derived(
	initialHydrationComplete ? displayEntriesRaw : ([] as readonly VirtualizedDisplayEntry[])
);
const nativeFallbackEntries = $derived.by((): readonly IndexedDisplayEntry[] => {
	const startIndex = Math.max(0, displayEntries.length - NATIVE_FALLBACK_ENTRY_LIMIT);
	const result: IndexedDisplayEntry[] = [];
	for (let index = startIndex; index < displayEntries.length; index += 1) {
		const entry = displayEntries[index];
		if (!entry) {
			continue;
		}
		result.push({ entry, index });
	}
	return result;
});
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

// Fullscreen session switches reuse this component instance now, so reset only the
// scroll/follow machinery instead of remounting the whole list and replaying hydration.
$effect(() => {
	if (sessionId === lastRenderedSessionId) {
		return;
	}

	lastRenderedSessionId = sessionId;
	warnedMissingEntryKeys.clear();
	autoScroll.reset();
	followController.reset();
	useNativeFallback = false;
	viewportNudgeOffsetPx = 0;
	historicalScrollApplied = false;

	let frameCount = 0;
	let sessionSwitchRafId: number | null = null;
	const revealAfterSwitchSettle = () => {
		frameCount += 1;
		if (frameCount < 2) {
			sessionSwitchRafId = requestAnimationFrame(revealAfterSwitchSettle);
			return;
		}
		sessionSwitchRafId = null;
		autoScroll.revealLatest(true);
	};

	if (displayEntries.length > 0) {
		sessionSwitchRafId = requestAnimationFrame(revealAfterSwitchSettle);
	}

	return () => {
		if (sessionSwitchRafId !== null) {
			cancelAnimationFrame(sessionSwitchRafId);
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
		const sceneArr = sceneEntries ?? [];
		const idx = findLastAssistantSceneIndex(sceneArr);
		return idx >= 0 ? (sceneArr[idx]?.id ?? null) : null;
	})
);
let lastAssistantProcessedLength = untrack(() => (sceneEntries ?? []).length);
$effect(() => {
	const sceneArr = sceneEntries ?? [];
	const count = sceneArr.length;
	if (count === lastAssistantProcessedLength) return;
	if (count > lastAssistantProcessedLength) {
		for (let i = count - 1; i >= lastAssistantProcessedLength; i--) {
			const e = sceneArr[i];
			if (e && e.type === "assistant") {
				lastAssistantId = e.id;
				break;
			}
		}
	} else {
		const idx = findLastAssistantSceneIndex(sceneArr);
		lastAssistantId = idx >= 0 ? (sceneArr[idx]?.id ?? null) : null;
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
</script>

<!--
	Virtual scrolling using Virtua with passive wheel detection.
	VList config:
	- bufferSize: pixels of content to render outside viewport (800px = ~6 items)
	- itemSize: estimated average item height in px for initial layout calculations
	- contain: strict prevents layout recalculation from propagating to parent
-->
<div bind:this={wrapperRef} use:wheelAction class="h-full min-h-0" style={wrapperStyle}>
	{#snippet renderEntry(entry: VirtualizedDisplayEntry | undefined, index: number)}
		{#if entry}
			{@const mergedThoughtDurationMs = resolveDisplayEntryThinkingDurationMs(
				displayEntries,
				index,
				thinkingNowMs
			)}
			{@const sharedEntry = getSharedEntry(entry, mergedThoughtDurationMs)}
			<MessageWrapper
				entryIndex={index}
				entryKey={getKey(entry, index)}
				messageId={entry.type === "user" ? entry.id : undefined}
				observeRevealResize={entry
					? shouldObserveRevealResize(displayEntries, entry, isStreaming)
					: false}
				revealEntryIndex={revealDisplayIndex}
				{isFullscreen}
			>
				{#if entry.type === "user"}
					<UserMessage message={getUserMessage(entry)} />
				{:else if entry.type === "assistant"}
					<AssistantMessage
						message={getAssistantMessage(entry)}
						isStreaming={isStreamingAssistantEntry(entry, index)}
						revealMessageKey={getKey(entry, index)}
						{projectPath}
						{streamingAnimationMode}
					/>
				{:else if entry.type === "assistant_merged"}
					<AssistantMessage
						message={getMergedAssistantMessage(entry, mergedThoughtDurationMs)}
						isStreaming={isStreamingMergedAssistantEntry(entry, index)}
						revealMessageKey={getKey(entry, index)}
						{projectPath}
						{streamingAnimationMode}
					/>
					{:else}
					<AgentPanelConversationEntry entry={sharedEntry} iconBasePath="/svgs/icons" {editToolTheme} />
				{/if}
			</MessageWrapper>
		{:else}
			{@const _missingEntryWarning = reportMissingVirtualizedEntry(index)}
		{/if}
	{/snippet}

	{#if useNativeFallback}
		<div
			bind:this={fallbackViewportRef}
			data-testid="native-fallback"
			class="h-full overflow-y-auto"
			onscroll={handleFallbackScroll}
		>
			{#each nativeFallbackEntries as item (getKey(item.entry))}
				<div use:bindFallbackRow={getKey(item.entry)}>
					{@render renderEntry(item.entry, item.index)}
				</div>
			{/each}
		</div>
	{:else}
		{#key `${sessionId ?? "pre-session"}:${vlistRenderKey}`}
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
