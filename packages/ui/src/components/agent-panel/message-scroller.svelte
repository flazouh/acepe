<script lang="ts">
import type { Snippet } from "svelte";

import {
	type StickToBottomController,
	createStickToBottomController,
} from "./stick-to-bottom-effects.js";
import MessageScrollerItem from "./message-scroller-item.svelte";
import {
	createArrayMessageScrollerItemSource,
	type MessageScrollerItem as Item,
	type MessageScrollerItemSource,
	type MessageScrollerRangeState,
} from "./message-scroller-types.js";
import {
	measureAgentPanelPerformance,
	recordAgentPanelPerformanceSample,
	type AgentPanelPerformanceRecorder,
} from "./agent-panel-performance-profile.js";
import {
	createMessageScrollerVirtualLayoutFromSource,
	createMessageScrollerVirtualWindowFromSourceLayout,
	type MessageScrollerMeasuredHeight,
	resolveMessageScrollerVirtualAnchorFromSourceLayout,
	resolveMessageScrollerVirtualRowTopFromSourceLayout,
} from "./message-scroller-virtual-layout.js";

const DEFAULT_VIEWPORT_HEIGHT_PX = 800;
const MEASURE_WRITE_THRESHOLD_PX = 0.5;
const SCROLL_MEASURE_DEFER_MS = 140;
const SOURCE_CHANGE_ANCHOR_BOTTOM_THRESHOLD_PX = 24;
const VIRTUAL_LEAD_OVERSCAN_VIEWPORTS = 1.25;
const MIN_VIRTUAL_LEAD_OVERSCAN_PX = 1_000;
const MAX_VIRTUAL_LEAD_OVERSCAN_PX = 2_400;
const VIRTUAL_TRAIL_OVERSCAN_VIEWPORTS = 0.25;
const MIN_VIRTUAL_TRAIL_OVERSCAN_PX = 600;
const MAX_VIRTUAL_TRAIL_OVERSCAN_PX = 900;
const VIRTUAL_WINDOW_SCROLL_BUCKET_PX = 900;
const VIRTUALIZATION_ROW_THRESHOLD = 200;
const MAX_MEASURED_HEIGHT_ENTRIES = 2_000;
const EMPTY_ITEMS: readonly Item[] = [];
const EMPTY_MEASURED_HEIGHTS_BY_KEY = new Map<string, number>();

interface Props {
	items?: readonly Item[];
	itemSource?: MessageScrollerItemSource;
	/** Estimated pixels occupied by unloaded transcript history before itemSource[0]. */
	virtualLeadingSpacePx?: number;
	/** Renders one row's content; receives the item. */
	renderItem: Snippet<[Item]>;
	/** Accessible name for the scrollable transcript region (host-provided copy). */
	ariaLabel: string;
	/** Notified when follow/unread state changes (drives host-side affordances). */
	onFollowStateChange?: (state: {
		released: boolean;
		hasUnreadBelow: boolean;
	}) => void;
	/** Notified when top/bottom edge state changes (drives host scroll controls). */
	onEdgeStateChange?: (state: { atTop: boolean; atBottom: boolean }) => void;
	/** Notified when the virtual row window moves, so hosts can prefetch row pages. */
	onVisibleRangeChange?: (state: MessageScrollerRangeState) => void;
	/** Hands the live controller to the host for imperative onSend/jumpToLatest. */
	onReady?: (controller: StickToBottomController) => void;
	/** Optional dev/test profiler sink. It must not drive product state. */
	profileRecorder?: AgentPanelPerformanceRecorder;
}

let {
	items = EMPTY_ITEMS,
	itemSource,
	virtualLeadingSpacePx = 0,
	renderItem,
	ariaLabel,
	onFollowStateChange,
	onEdgeStateChange,
	onVisibleRangeChange,
	onReady,
	profileRecorder,
}: Props = $props();

let contentEl: HTMLElement | undefined = $state();
let bottomSpacerEl: HTMLElement | undefined = $state();
let controller: StickToBottomController | undefined;
let viewportResizeObserver: ResizeObserver | null = null;
let bottomSpacerPx = $state(0);
let scrollTopPx = $state(0);
let scrollDirection: "backward" | "forward" | "none" = $state("none");
let viewportHeightPx = $state(DEFAULT_VIEWPORT_HEIGHT_PX);
let measuredHeightsRevision = $state(0);
let measuredHeightFlushFrame: number | null = null;
let measuredHeightFlushTimer: ReturnType<typeof setTimeout> | null = null;
let viewportScrollActive = $state(false);
let viewportScrollSettleTimer: ReturnType<typeof setTimeout> | null = null;
let lastVisibleRangeSignature: string | null = null;
let lastSourceAnchorSignature: string | null = null;
let pendingSourceChangeAnchor = $state<{
	readonly rowId: string;
	readonly viewportOffsetPx: number;
	readonly signature: string;
} | null>(null);
const measuredHeightsByIndex = new Map<number, MessageScrollerMeasuredHeight>();
const pendingMeasuredHeightsByIndex = new Map<
	number,
	MessageScrollerMeasuredHeight
>();

const effectiveItemSource = $derived(
	itemSource ?? createArrayMessageScrollerItemSource(items),
);
const itemCount = $derived(effectiveItemSource.length);
const safeVirtualLeadingSpacePx = $derived(
	Number.isFinite(virtualLeadingSpacePx)
		? Math.max(0, virtualLeadingSpacePx)
		: 0,
);
const hasLeadingVirtualSpace = $derived(safeVirtualLeadingSpacePx > 0);
const isVirtualized = $derived(
	itemCount > 0 &&
		(itemCount > VIRTUALIZATION_ROW_THRESHOLD || hasLeadingVirtualSpace),
);
const virtualizationThreshold = $derived(
	hasLeadingVirtualSpace ? 0 : VIRTUALIZATION_ROW_THRESHOLD,
);
const virtualScrollTopPx = $derived(
	isVirtualized ? Math.max(0, scrollTopPx - safeVirtualLeadingSpacePx) : scrollTopPx,
);
const virtualWindowScrollTopPx = $derived(
	isVirtualized
		? Math.max(
				0,
				Math.round(virtualScrollTopPx / VIRTUAL_WINDOW_SCROLL_BUCKET_PX) *
					VIRTUAL_WINDOW_SCROLL_BUCKET_PX,
			)
		: virtualScrollTopPx,
);
const profiledItemSource = $derived.by(() => {
	recordAgentPanelPerformanceSample(profileRecorder, {
		phase: "message-scroller.items-input",
		durationMs: 0,
		itemCount,
		nodeCount: null,
	});
	return effectiveItemSource;
});
const virtualLayout = $derived.by(() => {
	measuredHeightsRevision;
	return measureAgentPanelPerformance(
		profileRecorder,
		{ phase: "message-scroller.virtual-layout", itemCount },
		() =>
			createMessageScrollerVirtualLayoutFromSource({
				itemSource: profiledItemSource,
				measuredHeightsByKey: EMPTY_MEASURED_HEIGHTS_BY_KEY,
				measuredHeightsByIndex,
				useMeasuredHeightsByKey: false,
			}),
	);
});
const virtualLeadOverscanPx = $derived(
	Math.min(
		MAX_VIRTUAL_LEAD_OVERSCAN_PX,
		Math.max(
			MIN_VIRTUAL_LEAD_OVERSCAN_PX,
			viewportHeightPx * VIRTUAL_LEAD_OVERSCAN_VIEWPORTS,
		),
	),
);
const virtualTrailOverscanPx = $derived(
	Math.min(
		MAX_VIRTUAL_TRAIL_OVERSCAN_PX,
		Math.max(
			MIN_VIRTUAL_TRAIL_OVERSCAN_PX,
			viewportHeightPx * VIRTUAL_TRAIL_OVERSCAN_VIEWPORTS,
		),
	),
);
const virtualOverscanBeforePx = $derived(
	scrollDirection === "backward"
		? virtualLeadOverscanPx
		: virtualTrailOverscanPx,
);
const virtualOverscanAfterPx = $derived(
	scrollDirection === "backward"
		? virtualTrailOverscanPx
		: virtualLeadOverscanPx,
);
const virtualWindow = $derived.by(() => {
	return measureAgentPanelPerformance(
		profileRecorder,
		{ phase: "message-scroller.virtual-window", itemCount },
		() =>
			createMessageScrollerVirtualWindowFromSourceLayout({
				itemSource: profiledItemSource,
				layout: virtualLayout,
				scrollTopPx: virtualWindowScrollTopPx,
				viewportHeightPx,
				overscanPx: virtualLeadOverscanPx,
				overscanBeforePx: virtualOverscanBeforePx,
				overscanAfterPx: virtualOverscanAfterPx,
				virtualizationThreshold,
			}),
	);
});
const virtualizedContentHeightPx = $derived(
	isVirtualized
		? safeVirtualLeadingSpacePx + virtualWindow.totalPx + bottomSpacerPx
		: null,
);

function visibleRangeState(): MessageScrollerRangeState {
	return {
		startIndex: virtualWindow.startIndex,
		endIndex: virtualWindow.endIndex,
		itemCount,
		beforePx: virtualWindow.beforePx,
		afterPx: virtualWindow.afterPx,
		totalPx: virtualWindow.totalPx,
		isVirtualized,
		scrollActive: viewportScrollActive,
	};
}

function visibleRangeSignature(state: MessageScrollerRangeState): string {
	return [
		state.startIndex,
		state.endIndex,
		state.itemCount,
		Math.round(state.beforePx),
		Math.round(state.afterPx),
		Math.round(state.totalPx),
		Math.round(safeVirtualLeadingSpacePx),
		state.isVirtualized ? "v" : "flow",
		state.scrollActive ? "scrolling" : "settled",
	].join(":");
}

function sourceAnchorSignature(): string {
	return [
		itemCount,
		Math.round(safeVirtualLeadingSpacePx),
	].join(":");
}

function shouldPreserveSourceChangeAnchor(viewport: HTMLElement): boolean {
	if (!isVirtualized) {
		return false;
	}
	const distanceFromBottom =
		viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
	return distanceFromBottom > SOURCE_CHANGE_ANCHOR_BOTTOM_THRESHOLD_PX;
}

function readMountedSourceChangeAnchor(): {
	readonly rowId: string;
	readonly viewportOffsetPx: number;
} | null {
	const viewport = contentEl?.parentElement;
	if (!contentEl || !(viewport instanceof HTMLElement)) {
		return null;
	}
	if (!shouldPreserveSourceChangeAnchor(viewport)) {
		return null;
	}
	const viewportRect = viewport.getBoundingClientRect();
	const candidates = contentEl.querySelectorAll<HTMLElement>(
		"[data-anchor][data-row-id]",
	);
	for (const el of candidates) {
		const rect = el.getBoundingClientRect();
		const intersectsViewport =
			rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
		if (!intersectsViewport) {
			continue;
		}
		const rowId = el.getAttribute("data-row-id");
		if (rowId === null) {
			continue;
		}
		const topPx = viewport.scrollTop + rect.top - viewportRect.top;
		return {
			rowId,
			viewportOffsetPx: topPx - viewport.scrollTop,
		};
	}
	return null;
}

function applyPendingSourceChangeAnchor(input: {
	readonly rowId: string;
	readonly viewportOffsetPx: number;
	readonly signature: string;
	readonly clearWhenDone: boolean;
}): void {
	if (
		pendingSourceChangeAnchor === null ||
		pendingSourceChangeAnchor.signature !== input.signature ||
		input.signature !== sourceAnchorSignature()
	) {
		return;
	}
	const viewport = contentEl?.parentElement;
	if (!(viewport instanceof HTMLElement)) {
		pendingSourceChangeAnchor = null;
		return;
	}
	const rowTopPx = resolveRowTop(input.rowId);
	if (rowTopPx === null) {
		pendingSourceChangeAnchor = null;
		return;
	}
	const nextScrollTopPx = Math.max(0, rowTopPx - input.viewportOffsetPx);
	if (Math.abs(viewport.scrollTop - nextScrollTopPx) > MEASURE_WRITE_THRESHOLD_PX) {
		viewport.scrollTop = nextScrollTopPx;
		readViewportGeometry(viewport);
	}
	if (input.clearWhenDone) {
		pendingSourceChangeAnchor = null;
	}
}

function readViewportGeometry(
	node: HTMLElement,
	options: {
		readonly trackScrollDirection: boolean;
		readonly updateViewportHeight: boolean;
	} = {
		trackScrollDirection: false,
		updateViewportHeight: true,
	},
): void {
	const nextScrollTopPx = node.scrollTop;
	if (options.trackScrollDirection) {
		if (nextScrollTopPx > scrollTopPx) {
			scrollDirection = "forward";
		} else if (nextScrollTopPx < scrollTopPx) {
			scrollDirection = "backward";
		}
	}
	scrollTopPx = nextScrollTopPx;
	if (options.updateViewportHeight) {
		viewportHeightPx =
			node.clientHeight > 0 && Number.isFinite(node.clientHeight)
				? node.clientHeight
				: DEFAULT_VIEWPORT_HEIGHT_PX;
	}
}

function handleViewportScroll(event: Event): void {
	readViewportGeometry(event.currentTarget as HTMLElement, {
		trackScrollDirection: true,
		updateViewportHeight: false,
	});
	deferMeasuredHeightWritesUntilScrollSettles();
}

$effect(() => {
	const state = visibleRangeState();
	const signature = visibleRangeSignature(state);
	if (signature === lastVisibleRangeSignature) {
		return;
	}
	lastVisibleRangeSignature = signature;
	onVisibleRangeChange?.(state);
});

$effect.pre(() => {
	const signature = sourceAnchorSignature();
	if (signature === lastSourceAnchorSignature) {
		return;
	}
	if (lastSourceAnchorSignature === null) {
		lastSourceAnchorSignature = signature;
		pendingSourceChangeAnchor = null;
		return;
	}
	const anchor = readMountedSourceChangeAnchor();
	pendingSourceChangeAnchor =
		anchor === null
			? null
			: {
					rowId: anchor.rowId,
					viewportOffsetPx: anchor.viewportOffsetPx,
					signature,
				};
	lastSourceAnchorSignature = signature;
});

$effect(() => {
	const anchor = pendingSourceChangeAnchor;
	if (anchor === null) {
		return;
	}
	queueMicrotask(() => {
		applyPendingSourceChangeAnchor({
			rowId: anchor.rowId,
			viewportOffsetPx: anchor.viewportOffsetPx,
			signature: anchor.signature,
			clearWhenDone: false,
		});
	});
	if (typeof requestAnimationFrame === "function") {
		requestAnimationFrame(() => {
			applyPendingSourceChangeAnchor({
				rowId: anchor.rowId,
				viewportOffsetPx: anchor.viewportOffsetPx,
				signature: anchor.signature,
				clearWhenDone: true,
			});
		});
		return;
	}
	setTimeout(() => {
		applyPendingSourceChangeAnchor({
			rowId: anchor.rowId,
			viewportOffsetPx: anchor.viewportOffsetPx,
			signature: anchor.signature,
			clearWhenDone: true,
		});
	}, 0);
});

function recordItemSize(
	itemKey: string,
	itemIndex: number,
	heightPx: number,
): void {
	if (!Number.isFinite(heightPx) || heightPx <= 0) {
		return;
	}
	if (!Number.isInteger(itemIndex) || itemIndex < 0) {
		return;
	}
	const previousMeasurement = measuredHeightsByIndex.get(itemIndex);
	if (
		previousMeasurement !== undefined &&
		previousMeasurement.itemKey === itemKey &&
		Math.abs(previousMeasurement.heightPx - heightPx) <=
			MEASURE_WRITE_THRESHOLD_PX
	) {
		return;
	}
	pendingMeasuredHeightsByIndex.set(itemIndex, {
		itemKey,
		heightPx,
	});
	scheduleMeasuredHeightFlush();
}

function measuredHeightForItem(
	itemKey: string,
	itemIndex: number,
): number | null {
	measuredHeightsRevision;
	const measurement = measuredHeightsByIndex.get(itemIndex);
	if (measurement === undefined || measurement.itemKey !== itemKey) {
		return null;
	}
	if (!Number.isFinite(measurement.heightPx) || measurement.heightPx <= 0) {
		return null;
	}
	return measurement.heightPx;
}

function clearMeasuredHeightFlush(): void {
	if (measuredHeightFlushFrame !== null) {
		cancelAnimationFrame(measuredHeightFlushFrame);
		measuredHeightFlushFrame = null;
	}
	if (measuredHeightFlushTimer !== null) {
		clearTimeout(measuredHeightFlushTimer);
		measuredHeightFlushTimer = null;
	}
}

function clearViewportScrollSettleTimer(): void {
	if (viewportScrollSettleTimer === null) {
		return;
	}
	clearTimeout(viewportScrollSettleTimer);
	viewportScrollSettleTimer = null;
}

function deferMeasuredHeightWritesUntilScrollSettles(): void {
	viewportScrollActive = true;
	scheduleViewportScrollSettleFlush();
}

function scheduleViewportScrollSettleFlush(): void {
	clearViewportScrollSettleTimer();
	viewportScrollSettleTimer = setTimeout(() => {
		viewportScrollActive = false;
		viewportScrollSettleTimer = null;
		flushMeasuredHeightWrites();
	}, SCROLL_MEASURE_DEFER_MS);
}

function scheduleMeasuredHeightFlush(): void {
	if (viewportScrollActive) {
		scheduleViewportScrollSettleFlush();
		return;
	}
	if (measuredHeightFlushFrame !== null || measuredHeightFlushTimer !== null) {
		return;
	}
	if (typeof requestAnimationFrame === "function") {
		measuredHeightFlushFrame = requestAnimationFrame(() => {
			measuredHeightFlushFrame = null;
			flushMeasuredHeightWrites();
		});
		return;
	}
	measuredHeightFlushTimer = setTimeout(() => {
		measuredHeightFlushTimer = null;
		flushMeasuredHeightWrites();
	}, 0);
}

function flushMeasuredHeightWrites(): void {
	clearMeasuredHeightFlush();
	if (pendingMeasuredHeightsByIndex.size === 0) {
		return;
	}
	measureAgentPanelPerformance(
		profileRecorder,
		{
			phase: "message-scroller.measured-height-flush",
			itemCount: pendingMeasuredHeightsByIndex.size,
		},
		() => {
			let changed = false;
			for (const [itemIndex, measurement] of pendingMeasuredHeightsByIndex) {
				const previousMeasurement = measuredHeightsByIndex.get(itemIndex);
				if (
					previousMeasurement !== undefined &&
					previousMeasurement.itemKey === measurement.itemKey &&
					Math.abs(previousMeasurement.heightPx - measurement.heightPx) <=
						MEASURE_WRITE_THRESHOLD_PX
				) {
					continue;
				}
				measuredHeightsByIndex.set(itemIndex, measurement);
				changed = true;
			}
			pendingMeasuredHeightsByIndex.clear();
			if (changed) {
				pruneMeasuredHeightsByIndex();
				measuredHeightsRevision += 1;
			}
		},
	);
}

function pruneMeasuredHeightsByIndex(): void {
	while (measuredHeightsByIndex.size > MAX_MEASURED_HEIGHT_ENTRIES) {
		const oldest = measuredHeightsByIndex.keys().next();
		if (oldest.done === true) {
			return;
		}
		measuredHeightsByIndex.delete(oldest.value);
	}
}

function resolveRowTop(rowId: string): number | null {
	return measureAgentPanelPerformance(
		profileRecorder,
		{ phase: "message-scroller.resolve-row-top", itemCount },
		() => {
			flushMeasuredHeightWrites();
			if (isVirtualized) {
				const rowTopPx = resolveMessageScrollerVirtualRowTopFromSourceLayout({
					itemSource: profiledItemSource,
					layout: virtualLayout,
					rowId,
				});
				return rowTopPx === null ? null : safeVirtualLeadingSpacePx + rowTopPx;
			}
			const el = contentEl?.querySelector<HTMLElement>(
				`[data-row-id="${CSS.escape(rowId)}"]`,
			);
			return el ? el.offsetTop : null;
		},
	);
}

// Topmost anchor-eligible row at or below the current scroll position — the
// row held stationary while the reader is scrolled up and content above grows.
function resolveAnchor(): { rowId: string; topPx: number } | null {
	if (!contentEl) {
		return null;
	}
	return measureAgentPanelPerformance(
		profileRecorder,
		{ phase: "message-scroller.resolve-anchor", itemCount },
		() => {
			flushMeasuredHeightWrites();
			const scrollTop = contentEl.parentElement?.scrollTop ?? scrollTopPx;
			if (isVirtualized) {
				const anchor = resolveMessageScrollerVirtualAnchorFromSourceLayout({
					itemSource: profiledItemSource,
					layout: virtualLayout,
					scrollTopPx: Math.max(0, scrollTop - safeVirtualLeadingSpacePx),
				});
				return anchor === null
					? null
					: {
							rowId: anchor.rowId,
							topPx: safeVirtualLeadingSpacePx + anchor.topPx,
						};
			}
			const candidates = contentEl.querySelectorAll<HTMLElement>(
				"[data-anchor][data-row-id]",
			);
			for (const el of candidates) {
				if (el.offsetTop >= scrollTop) {
					const rowId = el.getAttribute("data-row-id");
					return rowId ? { rowId, topPx: el.offsetTop } : null;
				}
			}
			return null;
		},
	);
}

function setBottomSpacerPx(heightPx: number): void {
	measureAgentPanelPerformance(
		profileRecorder,
		{ phase: "message-scroller.set-bottom-spacer", itemCount },
		() => {
			bottomSpacerPx = heightPx;
			if (bottomSpacerEl) {
				bottomSpacerEl.style.height = `${heightPx}px`;
			}
		},
	);
}

function attachController(node: HTMLElement): { destroy(): void } {
	const firstChild = node.firstElementChild;
	const contentNode =
		contentEl ??
		(firstChild instanceof HTMLElement ? firstChild : undefined);
	readViewportGeometry(node);
	viewportResizeObserver?.disconnect();
	viewportResizeObserver =
		typeof ResizeObserver === "function"
			? new ResizeObserver(() => readViewportGeometry(node))
			: null;
	viewportResizeObserver?.observe(node);
	controller = createStickToBottomController(node, {
		content: contentNode,
		readScrollMetrics: () => ({
			scrollTop: node.scrollTop,
			scrollHeight: virtualizedContentHeightPx ?? node.scrollHeight,
			clientHeight: viewportHeightPx,
		}),
		resolveAnchor,
		resolveRowTop,
		getBottomSpacerPx: () => bottomSpacerPx,
		setBottomSpacerPx,
		getProfileRecorder: () => profileRecorder,
		shouldCoalesceScrollHandling: () => isVirtualized,
		shouldNotifyContentResize: () => itemCount <= VIRTUALIZATION_ROW_THRESHOLD,
		onStateChange: (state) => {
			onFollowStateChange?.(state);
		},
		onEdgeStateChange: (state) => {
			onEdgeStateChange?.(state);
		},
	});
	recordAgentPanelPerformanceSample(profileRecorder, {
		phase: "message-scroller.controller-attached",
		durationMs: 0,
		itemCount,
		nodeCount: contentEl?.querySelectorAll("[data-row-id]").length ?? null,
	});
	onReady?.(controller);
	return {
		destroy() {
			clearViewportScrollSettleTimer();
			clearMeasuredHeightFlush();
			viewportResizeObserver?.disconnect();
			viewportResizeObserver = null;
			controller?.destroy();
			controller = undefined;
		},
	};
}
</script>

<div class="message-scroller">
	<!--
	  The scroll container is intentionally focusable so keyboard scrolling
	  (PageDown / arrows) works and releases follow like a wheel/touch scroll —
	  an accessibility requirement, not a noninteractive decoration.
	-->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="message-scroller__viewport"
		tabindex="0"
		role="log"
		aria-live="polite"
		aria-label={ariaLabel}
		onscroll={handleViewportScroll}
		use:attachController
	>
		<div
			class={["message-scroller__content", isVirtualized && "is-virtualized"]}
			style:height={virtualizedContentHeightPx === null ? undefined : `${virtualizedContentHeightPx}px`}
			bind:this={contentEl}
		>
			<!-- Keyed by canonical row key so sliding the virtual window moves surviving rows instead of rebinding every row shell. -->
			{#each virtualWindow.items as item, windowItemOffset (item.key)}
				{@const itemIndex = virtualWindow.startIndex + windowItemOffset}
				{@const measuredHeightPx = measuredHeightForItem(item.key, itemIndex)}
				{@const rowEstimatePx = measuredHeightPx ?? item.estimatePx}
				{@const rowTopPx = safeVirtualLeadingSpacePx + (virtualLayout.offsets[itemIndex] ?? 0)}
				{@const shouldMeasureRow =
					!isVirtualized || !viewportScrollActive || item.isActiveTail}
				<div
					class={["message-scroller__row-shell", isVirtualized && "is-virtualized"]}
					style:transform={isVirtualized ? `translateY(${Math.round(rowTopPx)}px)` : undefined}
					data-virtual-row={isVirtualized ? "" : undefined}
				>
					<MessageScrollerItem
						itemKey={item.key}
						itemIndex={itemIndex}
						rowId={item.rowId}
						estimatePx={rowEstimatePx}
						sourceEstimatePx={item.estimatePx}
						{measuredHeightPx}
						isActiveTail={item.isActiveTail}
						anchorEligible={item.anchorEligible}
						measureSize={shouldMeasureRow}
						onSizeChange={recordItemSize}
					>
						{@render renderItem(item)}
					</MessageScrollerItem>
				</div>
			{/each}
			{#if !isVirtualized}
				<div
					class="message-scroller__send-anchor-spacer"
					bind:this={bottomSpacerEl}
					aria-hidden="true"
				></div>
			{/if}
		</div>
	</div>
</div>

<style>
	.message-scroller {
		position: relative;
		display: flex;
		min-height: 0;
		min-width: 0;
		flex: 1 1 auto;
		width: 100%;
		max-width: 100%;
	}

	.message-scroller__viewport {
		flex: 1 1 auto;
		min-height: 0;
		min-width: 0;
		width: 100%;
		max-width: 100%;
		overflow-y: scroll;
		overflow-x: hidden;
		scrollbar-gutter: stable;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--muted-foreground) 60%, transparent)
			color-mix(in srgb, var(--border) 12%, transparent);
		overflow-anchor: none;
		outline: none;
	}

	.message-scroller__content {
		display: flex;
		flex-direction: column;
		min-width: 0;
		width: 100%;
		max-width: 100%;
		overflow-anchor: none;
	}

	.message-scroller__content.is-virtualized {
		position: relative;
		display: block;
		flex: 0 0 auto;
	}

	.message-scroller__row-shell {
		min-width: 0;
		width: 100%;
		max-width: 100%;
		overflow-anchor: none;
	}

	.message-scroller__row-shell.is-virtualized {
		position: absolute;
		top: 0;
		left: 0;
		contain: layout style paint;
	}

	.message-scroller__row-shell.is-virtualized,
	.message-scroller__row-shell.is-virtualized > :global(*) {
		width: 100%;
		max-width: 100%;
	}

	.message-scroller__send-anchor-spacer {
		flex: 0 0 auto;
		height: 0;
		pointer-events: none;
	}

	.message-scroller__viewport::-webkit-scrollbar {
		width: 0.75rem;
	}

	.message-scroller__viewport::-webkit-scrollbar-track {
		background: color-mix(in srgb, var(--border) 12%, transparent);
		border-radius: 9999px;
	}

	.message-scroller__viewport::-webkit-scrollbar-thumb {
		min-height: 2rem;
		border: 0.1875rem solid transparent;
		border-radius: 9999px;
		background-color: color-mix(in srgb, var(--muted-foreground) 58%, transparent);
		background-clip: content-box;
	}

	.message-scroller__viewport:hover::-webkit-scrollbar-thumb,
	.message-scroller__viewport:focus-visible::-webkit-scrollbar-thumb {
		background-color: color-mix(in srgb, var(--muted-foreground) 74%, transparent);
	}
</style>
