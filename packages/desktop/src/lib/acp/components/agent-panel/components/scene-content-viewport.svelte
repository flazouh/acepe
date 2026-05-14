<script lang="ts">
import { AgentPanelConversationEntry } from "@acepe/ui/agent-panel";
import { setIconConfig } from "@acepe/ui/icon-context";
import type {
	AgentPanelQuestionSelectEvent,
	AgentPanelSceneEntryModel,
	AssistantRenderBlockContext,
} from "@acepe/ui/agent-panel";
import { setContext, untrack } from "svelte";
import { VList, type VListHandle } from "virtua/svelte";
import { SESSION_CONTEXT_KEY_EXPORT } from "../../../hooks/use-session-context.js";
import { getChatPreferencesStore } from "../../../store/chat-preferences-store.svelte.js";
import type { TurnState } from "../../../store/types.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import { DEFAULT_STREAMING_ANIMATION_MODE } from "../../../types/streaming-animation-mode.js";
import ContentBlockRouter from "../../messages/content-block-router.svelte";
import MessageWrapper from "../../messages/message-wrapper.svelte";
import {
	createGraphSceneEntryIndex,
	findGraphSceneEntryForDisplayEntry,
} from "../logic/graph-scene-entry-match.js";
import {
	buildSceneDisplayRows,
	getLatestSceneDisplayRevealTargetKey,
	getSceneDisplayRowKey,
	getSceneDisplayRowTimestampMs,
	resolveSceneDisplayRowThinkingDurationMs,
	shouldObserveSceneDisplayRowRevealResize,
	THINKING_DISPLAY_ENTRY,
	type SceneDisplayRow,
} from "../logic/scene-display-rows.js";
import {
	buildNativeFallbackWindow,
	shouldRetryNativeFallback,
	type IndexedViewportEntry,
	type ViewportFallbackReason,
} from "../logic/viewport-fallback-controller.svelte.js";
import {
	createInitialTranscriptViewportState,
	reduceTranscriptViewportEvent,
	type TranscriptViewportState,
} from "../logic/transcript-viewport-controller.js";
import type {
	TranscriptViewportEvent,
	TranscriptViewportMeasurement,
} from "../logic/transcript-viewport-events.js";
import type { TranscriptViewportEffect } from "../logic/transcript-viewport-effects.js";
import {
	createNativeTranscriptRendererAdapter,
	createVirtuaTranscriptRendererAdapter,
	type TranscriptRendererAdapter,
	type VirtuaTranscriptHandle,
} from "../logic/transcript-renderer-adapter.js";
import { createTranscriptViewportScheduler } from "../logic/transcript-viewport-scheduler.svelte.js";
import type { TranscriptViewportRowSummary } from "../logic/transcript-viewport-row-summary.js";
import { useTheme } from "../../../../components/theme/context.svelte.js";
import { getWorkerPool } from "../../../utils/worker-pool-singleton.js";
import {
	pierreDiffsUnsafeCSS,
	registerCursorThemeForPierreDiffs,
} from "../../../utils/pierre-diffs-theme.js";

const MAX_VIEWPORT_RECOVERY_FRAMES = 8;
const MAX_EMPTY_RENDER_FRAMES = 4;
const NATIVE_FALLBACK_ENTRY_LIMIT = 80;
const NEAR_EDGE_THRESHOLD_PX = 24;
type SceneContentViewportProps = {
	panelId: string;
	sceneEntries?: readonly AgentPanelSceneEntryModel[];
	turnState: TurnState;
	isWaitingForResponse: boolean;
	waitingLabel?: string | null;
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
	onQuestionSelect?: (event: AgentPanelQuestionSelectEvent) => void;
};

type IndexedDisplayEntry = IndexedViewportEntry<SceneDisplayRow>;

let {
	panelId,
	sceneEntries,
	turnState,
	isWaitingForResponse,
	waitingLabel = null,
	projectPath,
	sessionId,
	isFullscreen = false,
	modifiedFilesState = null,
	onNearBottomChange,
	onNearTopChange,
	onQuestionSelect,
}: SceneContentViewportProps = $props();

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
let nativeFallbackRetryCount = $state(0);
const fallbackRowRefs = new Map<string, HTMLElement>();

function bindFallbackRow(node: HTMLElement, key: string): { destroy: () => void } {
	fallbackRowRefs.set(key, node);
	return {
		destroy() {
			fallbackRowRefs.delete(key);
		},
	};
}

// ===== HELPERS =====
function getKey(entry: SceneDisplayRow | undefined, index?: number): string {
	if (!entry) {
		reportMissingVirtualizedEntry(index);
		return `missing-entry-${String(index ?? "unknown")}`;
	}

	return getSceneDisplayRowKey(entry);
}

function createMergedAssistantSceneEntry(
	entry: SceneDisplayRow | undefined,
	thinkingDurationMs: number | null
): AgentPanelSceneEntryModel | undefined {
	if (entry?.type !== "assistant_merged") {
		return undefined;
	}

	const isStreaming = entry.isStreaming ?? false;

	return {
		id: entry.key,
		type: "assistant",
		markdown: entry.markdown,
		message: {
			chunks: entry.message.chunks,
			model: entry.message.model,
			displayModel: entry.message.displayModel,
			receivedAt: entry.message.receivedAt,
			thinkingDurationMs: thinkingDurationMs ?? entry.message.thinkingDurationMs,
		},
		isStreaming,
		tokenRevealCss: entry.tokenRevealCss,
		timestampMs: entry.timestamp?.getTime(),
	};
}

function createThinkingSceneEntry(
	entry: SceneDisplayRow | undefined,
	thinkingDurationMs: number | null
): AgentPanelSceneEntryModel | undefined {
	if (entry?.type !== "thinking") {
		return undefined;
	}

	if (entry.label !== null && entry.label !== undefined) {
		return {
			id: entry.id,
			type: "thinking",
			durationMs: thinkingDurationMs,
			startedAtMs: entry.startedAtMs,
			label: entry.label,
		};
	}

	return {
		id: entry.id,
		type: "thinking",
		durationMs: thinkingDurationMs,
		startedAtMs: entry.startedAtMs,
	};
}

function createMissingSceneEntry(
	entry: SceneDisplayRow | undefined,
	index: number | undefined
): AgentPanelSceneEntryModel {
	const displayKey = entry ? getSceneDisplayRowKey(entry) : `missing-entry-${String(index ?? "unknown")}`;
	reportMissingSceneEntry(entry, index, displayKey);
	return {
		id: `missing:${displayKey}`,
		type: "missing",
		diagnosticLabel: displayKey,
	};
}

function getSharedEntry(
	entry: SceneDisplayRow | undefined,
	thinkingDurationMs: number | null,
	index?: number
): AgentPanelSceneEntryModel {
	const graphEntry = getGraphSceneEntry(entry);
	if (graphEntry !== undefined) {
		return graphEntry;
	}

	const mergedAssistantEntry = createMergedAssistantSceneEntry(entry, thinkingDurationMs);
	if (mergedAssistantEntry !== undefined) {
		return mergedAssistantEntry;
	}

	const thinkingEntry = createThinkingSceneEntry(entry, thinkingDurationMs);
	if (thinkingEntry !== undefined) {
		return thinkingEntry;
	}

	return createMissingSceneEntry(entry, index);
}

function getGraphSceneEntry(
	entry: SceneDisplayRow | undefined
): AgentPanelSceneEntryModel | undefined {
	return findGraphSceneEntryForDisplayEntry(entry, sceneEntriesById);
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
				key: getSceneDisplayRowKey(entry),
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

let warnedMissingSceneEntryKeys = new Set<string>();

function reportMissingSceneEntry(
	entry: SceneDisplayRow | undefined,
	index: number | undefined,
	displayKey: string
): void {
	if (!import.meta.env.DEV) {
		return;
	}

	const warningKey = `${sessionId ?? "pre-session"}:${displayKey}`;
	if (warnedMissingSceneEntryKeys.has(warningKey)) {
		return;
	}
	warnedMissingSceneEntryKeys.add(warningKey);

	console.warn("[AGENT_PANEL_MISSING_SCENE_ENTRY]", {
		panelId,
		sessionId,
		index,
		displayKey,
		displayEntryType: entry?.type,
		sceneEntryCount: sceneEntries?.length ?? 0,
	});
}

// ===== DISPLAY ENTRIES =====
const mergedEntries = $derived(buildSceneDisplayRows(sceneEntries ?? []));

const thinkingIndicatorStartedAtMs = $derived.by(() => {
	if (!isWaitingForResponse) {
		return null;
	}

	for (let index = mergedEntries.length - 1; index >= 0; index -= 1) {
		const entry = mergedEntries[index];
		if (!entry) {
			continue;
		}
		const timestampMs = getSceneDisplayRowTimestampMs(entry);
		if (timestampMs !== null) {
			return timestampMs;
		}
	}

	return null;
});
// Avoid spread-based allocation on every streaming update — reuse the merged
// reference directly when no thinking indicator is needed. When waiting, pre-allocate
// the result array to the known size rather than using concat/spread.
const displayEntriesRaw = $derived.by((): readonly SceneDisplayRow[] => {
	if (!isWaitingForResponse) return mergedEntries;
	const result: SceneDisplayRow[] = [];
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
		label: waitingLabel,
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
	initialHydrationComplete ? displayEntriesRaw : ([] as readonly SceneDisplayRow[])
);
const hasLiveAssistantDisplayEntry = $derived(
	displayEntries.some(
		(entry) =>
			entry.type === "assistant_merged" &&
			(entry.isStreaming === true || entry.tokenRevealCss !== undefined)
	)
);

function buildViewportRowSummary(rows: readonly SceneDisplayRow[]): TranscriptViewportRowSummary {
	let latestUserKey: string | null = null;
	const anchorEligibleKeys: string[] = [];
	for (const entry of rows) {
		const key = getSceneDisplayRowKey(entry);
		if (entry.type === "user") {
			latestUserKey = key;
		}
		if (entry.type !== "thinking") {
			anchorEligibleKeys.push(key);
		}
	}

	const lastEntry = rows.at(-1);
	return {
		version: rows.length,
		count: rows.length,
		firstKey: rows[0] === undefined ? null : getSceneDisplayRowKey(rows[0]),
		lastKey: lastEntry === undefined ? null : getSceneDisplayRowKey(lastEntry),
		latestUserKey,
		anchorEligibleKeys,
		reason: isWaitingForResponse ? "waiting-row-appended" : "rows-updated",
	};
}

let viewportState: TranscriptViewportState = $state(
	createInitialTranscriptViewportState({
		sessionId: untrack(() => sessionId),
		rows: buildViewportRowSummary([]),
	})
);
const shouldUseNativeList = $derived(viewportState.renderer.type === "fallback");
const nativeFallbackReason = $derived(
	viewportState.renderer.type === "fallback"
		? (viewportState.renderer.reason as ViewportFallbackReason)
		: null
);
const nativeFallbackEntries = $derived.by((): readonly IndexedDisplayEntry[] => {
	return buildNativeFallbackWindow(displayEntries, NATIVE_FALLBACK_ENTRY_LIMIT);
});
const vlistRenderKey = $derived(initialHydrationComplete ? "hydrated" : "deferred");
const wrapperStyle = $derived(
	viewportNudgeOffsetPx === 0 ? "height: 100%;" : `height: calc(100% - ${viewportNudgeOffsetPx}px);`
);

function getRowKeys(): readonly string[] {
	return displayEntries.map((entry) => getSceneDisplayRowKey(entry));
}

function getVirtuaHandle(): VirtuaTranscriptHandle | undefined {
	if (vlistRef === undefined || !("scrollTo" in vlistRef)) {
		return undefined;
	}
	return vlistRef as VListHandle & { scrollTo(offset: number): void };
}

const virtuaAdapter = createVirtuaTranscriptRendererAdapter({
	getHandle: getVirtuaHandle,
	getRowKeys,
});

const nativeAdapter = createNativeTranscriptRendererAdapter({
	getContainer: () => fallbackViewportRef,
	getRowKeys,
	getRowElement: (rowKey: string) => fallbackRowRefs.get(rowKey) ?? null,
});

const transcriptRendererAdapter: TranscriptRendererAdapter = {
	measureViewport() {
		return shouldUseNativeList ? nativeAdapter.measureViewport() : virtuaAdapter.measureViewport();
	},
	captureAnchor() {
		return shouldUseNativeList ? nativeAdapter.captureAnchor() : virtuaAdapter.captureAnchor();
	},
	measureAnchor(anchorKey) {
		return shouldUseNativeList
			? nativeAdapter.measureAnchor(anchorKey)
			: virtuaAdapter.measureAnchor(anchorKey);
	},
	revealRow(effect) {
		return shouldUseNativeList ? nativeAdapter.revealRow(effect) : virtuaAdapter.revealRow(effect);
	},
	revealTail(effect) {
		return shouldUseNativeList ? nativeAdapter.revealTail(effect) : virtuaAdapter.revealTail(effect);
	},
	applyScrollOffset(effect) {
		return shouldUseNativeList
			? nativeAdapter.applyScrollOffset(effect)
			: virtuaAdapter.applyScrollOffset(effect);
	},
	probeRendererHealth() {
		return shouldUseNativeList
			? nativeAdapter.probeRendererHealth()
			: virtuaAdapter.probeRendererHealth();
	},
	reportEffectOutcome(outcome) {
		virtuaAdapter.reportEffectOutcome(outcome);
	},
};

const viewportScheduler = createTranscriptViewportScheduler({
	adapter: transcriptRendererAdapter,
	getGeneration: () => viewportState.generation,
	getSessionId: () => viewportState.sessionId,
	dispatchEvent: (event) => dispatchViewportEvent(event),
});

function scheduleViewportEffects(effects: readonly TranscriptViewportEffect[]): void {
	viewportScheduler.schedule(effects);
}

function dispatchViewportEvent(event: TranscriptViewportEvent): void {
	if (event.type === "UserWheel" || event.type === "UserNavigationScroll") {
		viewportScheduler.cancel();
	}
	const result = reduceTranscriptViewportEvent(viewportState, event);
	viewportState = result.state;
	scheduleViewportEffects(result.effects);
}

function measureCurrentViewport(): TranscriptViewportMeasurement {
	const measurement = transcriptRendererAdapter.measureViewport();
	if (measurement.type === "measured") {
		return measurement.measurement;
	}
	return {
		scrollOffset: 0,
		scrollSize: 0,
		viewportSize: 0,
	};
}

$effect(() => {
	const rows = buildViewportRowSummary(displayEntries);
	const generation = untrack(() => viewportState.generation);
	untrack(() => {
		dispatchViewportEvent({
			type: "RowsChanged",
			sessionId,
			generation,
			rows,
		});
	});
});

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

	const previousSessionId = lastRenderedSessionId;
	lastRenderedSessionId = sessionId;
	warnedMissingEntryKeys.clear();
	warnedMissingSceneEntryKeys.clear();
	dispatchViewportEvent({
		type: "SessionChanged",
		sessionId,
		previousSessionId,
	});
	nativeFallbackRetryCount = 0;
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
		dispatchViewportEvent({
			type: "PublicScrollCommand",
			sessionId,
			generation: viewportState.generation,
			command: "bottom",
		});
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
	if (!initialHydrationComplete || shouldUseNativeList || displayEntries.length === 0 || !vlistRef) {
		viewportNudgeOffsetPx = 0;
		return;
	}

	let cancelled = false;
	let attempts = 0;
	let recoveryFrameId: number | null = null;
	const recoverySessionId = sessionId;
	const recoveryGeneration = untrack(() => viewportState.generation);

	const recoverViewport = () => {
		if (cancelled || sessionId !== recoverySessionId) {
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
			dispatchViewportEvent({
				type: "RendererFailed",
				sessionId,
				generation: recoveryGeneration,
				reason: "zero_viewport",
			});
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
		shouldUseNativeList ||
		displayEntries.length === 0 ||
		!wrapperRef
	) {
		return;
	}

	let cancelled = false;
	let remainingFrames = MAX_EMPTY_RENDER_FRAMES;
	let probeFrameId: number | null = null;
	const probeSessionId = sessionId;
	const probeGeneration = untrack(() => viewportState.generation);

	const probeRenderedEntries = () => {
		if (cancelled || sessionId !== probeSessionId) {
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
			dispatchViewportEvent({
				type: "RendererFailed",
				sessionId,
				generation: probeGeneration,
				reason: "no_rendered_entries",
			});
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

$effect(() => {
	if (
		!shouldUseNativeList ||
		!shouldRetryNativeFallback({
			reason: nativeFallbackReason,
			retryCount: nativeFallbackRetryCount,
		})
	) {
		return;
	}

	let cancelled = false;
	let frameCount = 0;
	let retryFrameId: number | null = null;
	const fallbackSessionId = sessionId;
	const fallbackGeneration = untrack(() => viewportState.generation);

	const retryVirtuaAfterFallback = () => {
		if (cancelled || sessionId !== fallbackSessionId) {
			return;
		}

		frameCount += 1;
		if (frameCount < 2) {
			retryFrameId = requestAnimationFrame(retryVirtuaAfterFallback);
			return;
		}

		retryFrameId = null;
		nativeFallbackRetryCount += 1;
		dispatchViewportEvent({
			type: "RendererRecovered",
			sessionId,
			generation: fallbackGeneration,
		});
	};

	retryFrameId = requestAnimationFrame(retryVirtuaAfterFallback);

	return () => {
		cancelled = true;
		if (retryFrameId !== null) {
			cancelAnimationFrame(retryFrameId);
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
		dispatchViewportEvent({
			type: "PublicScrollCommand",
			sessionId,
			generation: viewportState.generation,
			command: "bottom",
		});
	};
	scrollRafId = requestAnimationFrame(scrollAfterSettle);

	return () => {
		if (scrollRafId !== null) {
			cancelAnimationFrame(scrollRafId);
		}
	};
});

function requestRevealForIndex(index: number): void {
	if (viewportState.follow !== "following") {
		return;
	}
	const entry = displayEntries[index];
	if (entry === undefined) {
		return;
	}
	dispatchViewportEvent({
		type: "ExplicitRevealRequested",
		sessionId,
		generation: viewportState.generation,
		targetKey: getSceneDisplayRowKey(entry),
	});
}

function getFirstAnchorKey(): string | undefined {
	return viewportState.rows.anchorEligibleKeys[0];
}

function handleVListScroll(_offset: number): void {
	dispatchViewportEvent({
		type: "UserScroll",
		sessionId,
		generation: viewportState.generation,
		measurement: measureCurrentViewport(),
		anchorKey: getFirstAnchorKey(),
	});
}

function handleFallbackScroll(): void {
	dispatchViewportEvent({
		type: "UserScroll",
		sessionId,
		generation: viewportState.generation,
		measurement: measureCurrentViewport(),
	});
}

function isNearBottom(measurement: TranscriptViewportMeasurement | null): boolean {
	if (measurement === null) {
		return true;
	}
	const distanceFromBottom =
		measurement.scrollSize - measurement.viewportSize - measurement.scrollOffset;
	return distanceFromBottom <= NEAR_EDGE_THRESHOLD_PX;
}

function isNearTop(measurement: TranscriptViewportMeasurement | null): boolean {
	return (measurement?.scrollOffset ?? 0) <= NEAR_EDGE_THRESHOLD_PX;
}

$effect(() => {
	onNearBottomChange?.(
		viewportState.follow === "following" ? true : isNearBottom(viewportState.lastMeasurement)
	);
});

$effect(() => {
	onNearTopChange?.(isNearTop(viewportState.lastMeasurement));
});

// ===== PASSIVE WHEEL LISTENER =====
function wheelAction(node: HTMLElement): { destroy: () => void } {
	const handleWheel = (event: WheelEvent) => {
		const measured = measureCurrentViewport();
		const measurement =
			event.deltaY < 0
				? {
						scrollOffset: measured.scrollOffset,
						scrollSize: Math.max(measured.scrollSize, measured.viewportSize + NEAR_EDGE_THRESHOLD_PX + 1),
						viewportSize: measured.viewportSize,
				  }
				: measured;
		dispatchViewportEvent({
			type: "UserWheel",
			sessionId,
			generation: viewportState.generation,
			measurement,
			anchorKey: getFirstAnchorKey(),
		});
	};
	node.addEventListener("wheel", handleWheel, { passive: true });
	return {
		destroy() {
			node.removeEventListener("wheel", handleWheel);
		},
	};
}

// ===== PUBLIC API =====
export function scrollToBottom(options?: { force?: boolean }) {
	dispatchViewportEvent({
		type: "PublicScrollCommand",
		sessionId,
		generation: viewportState.generation,
		command: options?.force === false ? "follow" : "bottom",
	});
}

export function prepareForNextUserReveal(_options?: { force?: boolean }) {
	dispatchViewportEvent({
		type: "SendStarted",
		sessionId,
		generation: viewportState.generation,
	});
}

export function scrollToTop() {
	dispatchViewportEvent({
		type: "PublicScrollCommand",
		sessionId,
		generation: viewportState.generation,
		command: "top",
	});
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
	{#snippet renderAssistantBlock(context: AssistantRenderBlockContext)}
		{#if context.group.type === "text"}
			<ContentBlockRouter
				block={{ type: "text", text: context.group.text }}
				isStreaming={context.isStreaming}
				tokenRevealCss={context.tokenRevealCss}
				{projectPath}
				{streamingAnimationMode}
			/>
		{:else}
			<ContentBlockRouter block={context.group.block} {projectPath} />
		{/if}
	{/snippet}

	{#snippet renderEntry(entry: SceneDisplayRow | undefined, index: number)}
		{#if entry}
			{@const mergedThoughtDurationMs = resolveSceneDisplayRowThinkingDurationMs(
				displayEntries,
				index
			)}
			{@const sharedEntry = getSharedEntry(entry, mergedThoughtDurationMs, index)}
			<MessageWrapper
				entryIndex={index}
				entryKey={getKey(entry, index)}
				messageId={entry.type === "user" ? entry.id : undefined}
				observeRevealResize={entry
					? shouldObserveSceneDisplayRowRevealResize(displayEntries, entry, isStreaming)
					: false}
				onRevealResize={() => requestRevealForIndex(index)}
				{isFullscreen}
			>
				<AgentPanelConversationEntry
					entry={sharedEntry}
					iconBasePath="/svgs/icons"
					{editToolTheme}
					{projectPath}
					{streamingAnimationMode}
					renderAssistantBlock={renderAssistantBlock}
					{onQuestionSelect}
				/>
			</MessageWrapper>
		{:else}
			{@const _missingEntryWarning = reportMissingVirtualizedEntry(index)}
		{/if}
	{/snippet}

	{#if shouldUseNativeList}
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
				{#snippet children(entry: SceneDisplayRow, index: number)}
					{@render renderEntry(entry, index)}
				{/snippet}
			</VList>
		{/key}
	{/if}
</div>
