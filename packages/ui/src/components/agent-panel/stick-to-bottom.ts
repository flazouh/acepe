/**
 * Pure stick-to-bottom controller — the DOM-authority replacement for the
 * Rust-owned virtualized viewport's follow/anchor logic. Ported from the
 * `use-stick-to-bottom` model.
 *
 * This module is intentionally DOM-free: it takes measurements and returns the
 * next state plus a {@link ScrollAction} for an effects layer to apply. That
 * keeps the hard decisions (follow vs release, anchor preservation, unread) unit
 * testable as arithmetic. Real layout/paint behaviour (content-visibility size
 * changes, fling scroll) is verified in the dev app, not here.
 */

/** Live scroll geometry, read from the viewport in the same frame it is used. */
export type ScrollMetrics = {
	readonly scrollTop: number;
	readonly scrollHeight: number;
	readonly clientHeight: number;
};

/**
 * Follow state. `released` is set once the reader scrolls away from the live
 * edge; `hasUnreadBelow` drives the "new messages" affordance while released.
 */
export type StickState = {
	readonly released: boolean;
	readonly hasUnreadBelow: boolean;
};

/** What the effects layer should do to the real scroll element. */
export type ScrollAction =
	| { readonly kind: "none" }
	| { readonly kind: "toBottom" }
	| { readonly kind: "preserveAnchor"; readonly deltaPx: number }
	| { readonly kind: "anchorRowNearTop"; readonly rowId: string; readonly peekPx: number };

export type StickTransition = {
	readonly state: StickState;
	readonly action: ScrollAction;
};

/**
 * Distance (px) from the live edge that still counts as "at the bottom". A small
 * slack absorbs sub-pixel rounding and the in-flight growth of a streaming row.
 */
export const DEFAULT_AT_BOTTOM_THRESHOLD_PX = 24;

export const initialStickState: StickState = {
	released: false,
	hasUnreadBelow: false,
};

function distanceFromBottomPx(metrics: ScrollMetrics): number {
	return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
}

/** True when the viewport is within `thresholdPx` of the live edge. */
export function isAtBottom(
	metrics: ScrollMetrics,
	thresholdPx: number = DEFAULT_AT_BOTTOM_THRESHOLD_PX
): boolean {
	return distanceFromBottomPx(metrics) <= thresholdPx;
}

/**
 * Reconcile follow state against a fresh scroll measurement. Reaching the live
 * edge always re-engages follow and clears unread, so a transcript that was
 * released and then scrolled back to the bottom cannot get stuck.
 */
export function onScrollMeasure(
	state: StickState,
	metrics: ScrollMetrics,
	thresholdPx: number = DEFAULT_AT_BOTTOM_THRESHOLD_PX
): StickState {
	if (isAtBottom(metrics, thresholdPx)) {
		return initialStickState;
	}
	return state;
}

/**
 * Whether a scroll event should release follow. Our own programmatic scrolls
 * (pin-to-bottom, anchor correction) must never be mistaken for the reader
 * scrolling away; a genuine user scroll releases only when it leaves the edge.
 */
export function shouldReleaseOnUserScroll(input: {
	readonly isProgrammatic: boolean;
	readonly atBottom: boolean;
}): boolean {
	if (input.isProgrammatic) {
		return false;
	}
	return !input.atBottom;
}

/**
 * Content changed (append, in-place resize, estimate→real). While following,
 * pin to the live edge. While released, keep the tracked anchor row stationary
 * by the amount it drifted, and raise the unread flag when content grew below.
 */
export function onContentChange(
	state: StickState,
	input: { readonly anchorDeltaPx: number; readonly grewBelow: boolean }
): StickTransition {
	if (!state.released) {
		return {
			state,
			action: { kind: "toBottom" },
		};
	}

	const action: ScrollAction =
		input.anchorDeltaPx !== 0
			? { kind: "preserveAnchor", deltaPx: input.anchorDeltaPx }
			: { kind: "none" };

	return {
		state: {
			released: true,
			hasUnreadBelow: state.hasUnreadBelow || input.grewBelow,
		},
		action,
	};
}

/** On send, reacquire the live edge and follow the submitted turn. */
export function onSend(_state: StickState): StickTransition {
	return {
		state: initialStickState,
		action: { kind: "toBottom" },
	};
}

/**
 * Opening a saved thread is different from sending. It should land the reader
 * near the latest user turn and preserve that reading position, so follow is
 * intentionally released until the reader jumps back to the live edge.
 */
export function openAt(_state: StickState, rowId: string, peekPx: number): StickTransition {
	return {
		state: { released: true, hasUnreadBelow: false },
		action: { kind: "anchorRowNearTop", rowId, peekPx },
	};
}

/** Return to the live edge and re-engage follow, clearing the unread flag. */
export function jumpToLatest(_state: StickState): StickTransition {
	return {
		state: initialStickState,
		action: { kind: "toBottom" },
	};
}

/**
 * Scroll-top adjustment that keeps a tracked anchor row visually stationary when
 * content above it changes height: shift scrollTop by the row's content-top
 * displacement. (WebKit has no `overflow-anchor`, so this is done in JS.)
 */
export function anchorCorrectionPx(prevAnchorTopPx: number, nextAnchorTopPx: number): number {
	return nextAnchorTopPx - prevAnchorTopPx;
}
