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
	shouldReleaseOnUserScroll,
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
};

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

	let state: StickState = initialStickState;
	let programmatic = false;
	let prevScrollHeight = scrollEl.scrollHeight;
	let anchorBaselineTopPx: number | null = null;

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

	function apply(action: ScrollAction): void {
		const moved = applyScrollAction(scrollEl, action, params.resolveRowTop);
		if (moved) {
			programmatic = true;
		}
		prevScrollHeight = scrollEl.scrollHeight;
	}

	function handleScroll(): void {
		const metrics = readScrollMetrics(scrollEl);
		if (programmatic) {
			// Our own scroll — never a user scroll-away. Still reconcile re-engage.
			programmatic = false;
			emit(onScrollMeasure(state, metrics, threshold));
			captureAnchorBaseline();
			return;
		}
		const atBottom = isAtBottom(metrics, threshold);
		let next = state;
		if (shouldReleaseOnUserScroll({ isProgrammatic: false, atBottom })) {
			next = { released: true, hasUnreadBelow: state.hasUnreadBelow };
		}
		emit(onScrollMeasure(next, metrics, threshold));
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
			programmatic = true;
		}
		prevScrollHeight = scrollEl.scrollHeight;
		emit({ released: true, hasUnreadBelow: false });
		captureAnchorBaseline();
	}

	scrollEl.addEventListener("scroll", handleScroll, { passive: true });

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
