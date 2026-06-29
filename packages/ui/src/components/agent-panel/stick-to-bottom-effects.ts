/**
 * DOM wiring for the pure {@link ./stick-to-bottom.js} controller: reads live
 * scroll geometry, applies the controller's {@link ScrollAction} to a real
 * element, and bridges scroll / interaction / resize events into the pure
 * transitions. The decision logic stays in `stick-to-bottom.ts`; this file only
 * touches the DOM.
 *
 * No `$effect` — lifecycle lives in {@link createStickToBottomController}'s
 * `destroy()` (and the `use:`-action wrapper at the bottom).
 */

import {
	anchorCorrectionPx,
	type ScrollAction,
	type ScrollMetrics,
	type StickState,
	initialStickState,
	isAtBottom,
	jumpToLatest as jumpToLatestState,
	onContentChange,
	openAt as openAtState,
	onScrollMeasure,
	onSend as onSendState,
} from "./stick-to-bottom.js";

/** Read the same-frame scroll geometry the pure controller reasons about. */
export function readScrollMetrics(el: HTMLElement): ScrollMetrics {
	return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
}

/** Resolve the content-top (px, in scroll coordinates) of a tracked row. */
export type ResolveRowTop = (rowId: string) => number | null;

/** The topmost row currently held stationary while released, with its top px. */
export type ResolveAnchor = () => { readonly rowId: string; readonly topPx: number } | null;

function maxScrollTop(el: HTMLElement): number {
	return Math.max(0, el.scrollHeight - el.clientHeight);
}

/**
 * Apply a {@link ScrollAction} to the element. Returns whether `scrollTop`
 * actually moved, so the caller can flag the resulting scroll event as
 * programmatic (and not mistake it for the reader scrolling away).
 */
export function applyScrollAction(
	el: HTMLElement,
	action: ScrollAction,
	resolveRowTop?: ResolveRowTop
): boolean {
	const before = el.scrollTop;
	switch (action.kind) {
		case "none":
			return false;
		case "toBottom":
			el.scrollTop = maxScrollTop(el);
			return el.scrollTop !== before;
		case "preserveAnchor":
			el.scrollTop = Math.max(0, before + action.deltaPx);
			return el.scrollTop !== before;
		case "anchorRowNearTop": {
			const rowTop = resolveRowTop?.(action.rowId) ?? null;
			if (rowTop === null) {
				return false;
			}
			el.scrollTop = Math.min(maxScrollTop(el), Math.max(0, rowTop - action.peekPx));
			return el.scrollTop !== before;
		}
	}
}

export type StickToBottomParams = {
	/** Element whose size changes signal a content change. Defaults to `scrollEl`. */
	readonly content?: HTMLElement;
	readonly thresholdPx?: number;
	/** Topmost tracked row while released — drives anchor-preserving correction. */
	readonly resolveAnchor?: ResolveAnchor;
	/** Row content-top resolver for the on-send anchor-near-top action. */
	readonly resolveRowTop?: ResolveRowTop;
	/** Notified whenever follow/unread state changes (e.g. to drive the unread pill). */
	readonly onStateChange?: (state: StickState) => void;
	/** Notified whenever top/bottom edge state may have changed. */
	readonly onEdgeStateChange?: (state: { readonly atTop: boolean; readonly atBottom: boolean }) => void;
	/** Monotonic clock in ms. Injectable for tests; defaults to `performance.now`. */
	readonly now?: () => number;
};

/**
 * After we move `scrollTop` ourselves (pin/anchor), ignore release for this long.
 * A burst of programmatic writes (placeholder swap, content-visibility
 * estimate→real, anchor corrections) emits several async `scroll` events; a
 * single-shot guard only neutralizes the first, so the rest used to be misread
 * as a user scroll-away and spuriously released follow. A short time-box covers
 * the whole burst.
 */
const PROGRAMMATIC_SUPPRESS_MS = 120;

/**
 * How long a user-intent event (wheel/touch/key/scrollbar-drag) keeps the
 * "release is allowed" window open. Re-extended while inertial scrolling is
 * still moving the view up, so momentum is not cut off mid-fling.
 */
const INTENT_DECAY_MS = 150;

const PAGING_KEYS = new Set([
	"PageUp",
	"PageDown",
	" ",
	"Spacebar",
	"ArrowUp",
	"ArrowDown",
	"Home",
	"End",
]);

export type StickToBottomController = {
	getState(): StickState;
	/** Re-pin to the live edge and clear unread (the "jump to latest" affordance). */
	jumpToLatest(): void;
	/** On send: anchor the sent row near the top but keep following the reply. */
	onSend(rowId: string, peekPx: number): void;
	/** Opening history: anchor a row near the top and preserve that reading position. */
	openAt(rowId: string, peekPx: number): void;
	/** Move to the first row and release follow, matching the header scroll action. */
	scrollToTop(): void;
	/** Content size changed — also fired by the internal ResizeObserver. */
	notifyContentChanged(): void;
	destroy(): void;
};

/**
 * Wire a scroll element to the pure controller. The controller owns the
 * `StickState`, a one-shot "this scroll was ours" guard, and the anchor baseline
 * used to keep a tracked row stationary across content growth.
 */
export function createStickToBottomController(
	scrollEl: HTMLElement,
	params: StickToBottomParams = {}
): StickToBottomController {
	const content = params.content ?? scrollEl;
	const threshold = params.thresholdPx;
	const now =
		params.now ?? (typeof performance !== "undefined" ? () => performance.now() : () => Date.now());

	let state: StickState = initialStickState;
	// Time-boxed guards (see PROGRAMMATIC_SUPPRESS_MS / INTENT_DECAY_MS). Release
	// follow only when a genuine user interaction is in flight; never on a
	// layout-driven scroll. `0` = window closed.
	let suppressReleaseUntil = 0;
	let interactingUntil = 0;
	let lastScrollTop = scrollEl.scrollTop;
	let prevScrollHeight = scrollEl.scrollHeight;
	let anchorBaselineTopPx: number | null = null;

	function armIntent(): void {
		interactingUntil = now() + INTENT_DECAY_MS;
	}

	function emitEdgeState(): void {
		params.onEdgeStateChange?.({
			atTop: scrollEl.scrollTop <= 0,
			atBottom: isAtBottom(readScrollMetrics(scrollEl), threshold),
		});
	}

	function emit(next: StickState): void {
		const changed = next.released !== state.released || next.hasUnreadBelow !== state.hasUnreadBelow;
		state = next;
		if (changed) {
			params.onStateChange?.(state);
		}
		emitEdgeState();
	}

	function captureAnchorBaseline(): void {
		anchorBaselineTopPx = state.released ? (params.resolveAnchor?.()?.topPx ?? null) : null;
	}

	function markProgrammatic(): void {
		suppressReleaseUntil = now() + PROGRAMMATIC_SUPPRESS_MS;
	}

	function apply(action: ScrollAction): void {
		const moved = applyScrollAction(scrollEl, action, params.resolveRowTop);
		if (moved) {
			markProgrammatic();
		}
		prevScrollHeight = scrollEl.scrollHeight;
		lastScrollTop = scrollEl.scrollTop;
	}

	function handleScroll(): void {
		const metrics = readScrollMetrics(scrollEl);
		const atBottom = isAtBottom(metrics, threshold);
		const t = now();
		const movedUp = metrics.scrollTop < lastScrollTop;
		lastScrollTop = metrics.scrollTop;

		// Reaching the live edge always re-engages follow — can't get stuck.
		if (atBottom) {
			emit(onScrollMeasure(state, metrics, threshold));
			captureAnchorBaseline();
			return;
		}
		// Release ONLY when a genuine user interaction is in flight (wheel/touch/
		// key/scrollbar-drag armed `interactingUntil`) AND we are not inside the
		// settle window of our own programmatic write. Layout-driven scrolls
		// (placeholder swap, content-visibility estimate→real, anchor correction)
		// have no intent event, so they can never strand follow above the edge.
		const userInteracting = t < interactingUntil;
		const ourOwnScroll = t < suppressReleaseUntil;
		if (userInteracting && !ourOwnScroll) {
			if (movedUp) {
				// Keep the window alive through inertial/momentum travel.
				interactingUntil = t + INTENT_DECAY_MS;
			}
			emit({ released: true, hasUnreadBelow: state.hasUnreadBelow });
		}
		captureAnchorBaseline();
	}

	function notifyContentChanged(): void {
		const totalGrowthPx = scrollEl.scrollHeight - prevScrollHeight;
		const anchorNowTop = state.released ? (params.resolveAnchor?.()?.topPx ?? null) : null;
		const anchorDeltaPx =
			anchorBaselineTopPx !== null && anchorNowTop !== null
				? anchorCorrectionPx(anchorBaselineTopPx, anchorNowTop)
				: 0;
		// Distinguish content appended *below* the viewport (→ unread) from rows
		// *above* re-measuring (estimate→real), which only shifts the anchor down
		// by the same amount it grew the total height — that is not unread.
		const grewBelow = totalGrowthPx - Math.max(0, anchorDeltaPx) > 0.5;
		const result = onContentChange(state, { anchorDeltaPx, grewBelow });
		apply(result.action);
		emit(result.state);
		if (anchorNowTop !== null) {
			anchorBaselineTopPx = anchorNowTop;
		}
	}

	function jumpToLatest(): void {
		const result = jumpToLatestState(state);
		apply(result.action);
		emit(result.state);
	}

	function onSend(rowId: string, peekPx: number): void {
		const result = onSendState(state, rowId, peekPx);
		apply(result.action);
		emit(result.state);
		anchorBaselineTopPx = null;
	}

	function openAt(rowId: string, peekPx: number): void {
		const rowTop = params.resolveRowTop?.(rowId) ?? null;
		if (rowTop === null) {
			jumpToLatest();
			return;
		}
		const result = openAtState(state, rowId, peekPx);
		apply(result.action);
		emit(result.state);
		captureAnchorBaseline();
	}

	function scrollToTop(): void {
		const before = scrollEl.scrollTop;
		scrollEl.scrollTop = 0;
		if (scrollEl.scrollTop !== before) {
			markProgrammatic();
		}
		prevScrollHeight = scrollEl.scrollHeight;
		lastScrollTop = scrollEl.scrollTop;
		emit({ released: true, hasUnreadBelow: false });
		captureAnchorBaseline();
	}

	// User-intent listeners: these — not the generic `scroll` event — are what
	// permits a release. A scrollbar-gutter `pointerdown` (no wheel/touch/key)
	// is the one drag case intent events would otherwise miss.
	function handleWheel(): void {
		armIntent();
	}
	function handleTouch(): void {
		armIntent();
	}
	function handleKeydown(event: KeyboardEvent): void {
		if (PAGING_KEYS.has(event.key)) {
			armIntent();
		}
	}
	function handlePointerDown(event: PointerEvent): void {
		if (event.offsetX > scrollEl.clientWidth) {
			armIntent();
		}
	}

	scrollEl.addEventListener("scroll", handleScroll, { passive: true });
	scrollEl.addEventListener("wheel", handleWheel, { passive: true });
	scrollEl.addEventListener("touchstart", handleTouch, { passive: true });
	scrollEl.addEventListener("touchmove", handleTouch, { passive: true });
	scrollEl.addEventListener("keydown", handleKeydown);
	scrollEl.addEventListener("pointerdown", handlePointerDown);

	const hasResizeObserver = typeof ResizeObserver === "function";
	const observer = hasResizeObserver ? new ResizeObserver(() => notifyContentChanged()) : null;
	observer?.observe(content);
	emitEdgeState();

	return {
		getState: () => state,
		jumpToLatest,
		onSend,
		openAt,
		scrollToTop,
		notifyContentChanged,
		destroy() {
			scrollEl.removeEventListener("scroll", handleScroll);
			scrollEl.removeEventListener("wheel", handleWheel);
			scrollEl.removeEventListener("touchstart", handleTouch);
			scrollEl.removeEventListener("touchmove", handleTouch);
			scrollEl.removeEventListener("keydown", handleKeydown);
			scrollEl.removeEventListener("pointerdown", handlePointerDown);
			observer?.disconnect();
		},
	};
}

/**
 * Svelte `use:` action wrapper. Returns the controller on the node via
 * `onController` so a consumer can drive `jumpToLatest` / `onSend` imperatively
 * without re-renders. Teardown runs in `destroy`.
 */
export function stickToBottom(
	node: HTMLElement,
	params: StickToBottomParams & { readonly onController?: (c: StickToBottomController) => void } = {}
): { destroy(): void } {
	const controller = createStickToBottomController(node, params);
	params.onController?.(controller);
	return {
		destroy() {
			controller.destroy();
		},
	};
}
