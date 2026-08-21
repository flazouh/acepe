/**
 * Pure stick-to-bottom controller. Ported as-is from the DOM-authority
 * transcript viewport (`packages/ui` stick-to-bottom). Do not "improve" the
 * follow/release/anchor arithmetic.
 *
 * This module is DOM-free: it takes measurements and returns the next state
 * plus a {@link ScrollAction} for the controller to apply.
 */

export type ScrollMetrics = {
	readonly scrollTop: number
	readonly scrollHeight: number
	readonly clientHeight: number
}

/**
 * Follow state. `released` is set once the reader scrolls away from the live
 * edge; `hasUnreadBelow` drives the "new messages" affordance while released.
 */
export type StickState = {
	readonly released: boolean
	readonly hasUnreadBelow: boolean
}

/** What the controller should do to the real scroll element. */
export type ScrollAction =
	| { readonly kind: "none" }
	| { readonly kind: "toBottom" }
	| { readonly kind: "preserveAnchor"; readonly deltaPx: number }
	| { readonly kind: "anchorRowNearTop"; readonly rowId: string; readonly peekPx: number }

export type StickTransition = {
	readonly state: StickState
	readonly action: ScrollAction
}

/**
 * Distance (px) from the live edge that still counts as "at the bottom". A small
 * slack absorbs sub-pixel rounding and the in-flight growth of a streaming row.
 */
export const DEFAULT_AT_BOTTOM_THRESHOLD_PX = 24

export const initialStickState: StickState = {
	released: false,
	hasUnreadBelow: false,
}

export const distanceFromBottomPx = (metrics: ScrollMetrics): number =>
	metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight

/** True when the viewport is within `thresholdPx` of the live edge. */
export const isAtBottom = (
	metrics: ScrollMetrics,
	thresholdPx: number = DEFAULT_AT_BOTTOM_THRESHOLD_PX,
): boolean => distanceFromBottomPx(metrics) <= thresholdPx

/**
 * Reconcile follow state against a fresh scroll measurement. Reaching the live
 * edge always re-engages follow and clears unread, so a transcript that was
 * released and then scrolled back to the bottom cannot get stuck.
 */
export const onScrollMeasure = (
	state: StickState,
	metrics: ScrollMetrics,
	thresholdPx: number = DEFAULT_AT_BOTTOM_THRESHOLD_PX,
): StickState => {
	if (isAtBottom(metrics, thresholdPx) === true) {
		return initialStickState
	}
	return state
}

/**
 * Whether a scroll event should release follow. Our own programmatic scrolls
 * (pin-to-bottom, anchor correction) must never be mistaken for the reader
 * scrolling away; a genuine user scroll releases only when it leaves the edge.
 */
export const shouldReleaseOnUserScroll = (input: {
	readonly isProgrammatic: boolean
	readonly atBottom: boolean
}): boolean => {
	if (input.isProgrammatic === true) {
		return false
	}
	return input.atBottom === false
}

/**
 * Content changed (append, in-place resize, estimate→real). While following,
 * pin to the live edge. While released, keep the tracked anchor row stationary
 * by the amount it drifted, and raise the unread flag when content grew below.
 */
export const onContentChange = (
	state: StickState,
	input: { readonly anchorDeltaPx: number; readonly grewBelow: boolean },
): StickTransition => {
	if (state.released === false) {
		return {
			state,
			action: { kind: "toBottom" },
		}
	}

	const action: ScrollAction =
		input.anchorDeltaPx !== 0
			? { kind: "preserveAnchor", deltaPx: input.anchorDeltaPx }
			: { kind: "none" }

	return {
		state: {
			released: true,
			hasUnreadBelow: state.hasUnreadBelow === true || input.grewBelow === true,
		},
		action,
	}
}

/** On send, reacquire the live edge and follow the submitted turn. */
export const onSend = (_state: StickState): StickTransition => ({
	state: initialStickState,
	action: { kind: "toBottom" },
})

/**
 * Opening a saved thread is different from sending. It should land the reader
 * near the latest user turn and preserve that reading position, so follow is
 * intentionally released until the reader jumps back to the live edge.
 */
export const openAt = (_state: StickState, rowId: string, peekPx: number): StickTransition => ({
	state: { released: true, hasUnreadBelow: false },
	action: { kind: "anchorRowNearTop", rowId, peekPx },
})

/** Return to the live edge and re-engage follow, clearing the unread flag. */
export const jumpToLatest = (_state: StickState): StickTransition => ({
	state: initialStickState,
	action: { kind: "toBottom" },
})

/**
 * Scroll-top adjustment that keeps a tracked anchor row visually stationary when
 * content above it changes height: shift scrollTop by the row's content-top
 * displacement. (WebKit has no `overflow-anchor`, so this is done in JS.)
 */
export const anchorCorrectionPx = (prevAnchorTopPx: number, nextAnchorTopPx: number): number =>
	nextAnchorTopPx - prevAnchorTopPx
