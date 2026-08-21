import {
	DEFAULT_AT_BOTTOM_THRESHOLD_PX,
	distanceFromBottomPx,
	isAtBottom,
	type ScrollMetrics,
	type StickState,
} from "./follow.ts"

export type ContentVisibilityTraceFrame = {
	readonly index: number
	readonly released: boolean
	readonly hasUnreadBelow: boolean
	readonly scrollTop: number
	readonly scrollHeight: number
	readonly clientHeight: number
	readonly distanceFromBottomPx: number
	readonly atBottom: boolean
}

export const followIsStrandedAboveEdge = (
	state: StickState,
	metrics: ScrollMetrics,
	thresholdPx: number = DEFAULT_AT_BOTTOM_THRESHOLD_PX,
): boolean => state.released === false && isAtBottom(metrics, thresholdPx) === false

/**
 * Drive a content-visibility estimate→real height burst and record one frame
 * per notify. Used instead of a screenshot to prove follow does not strand.
 */
export const traceContentVisibilityRemeasure = (input: {
	readonly heights: ReadonlyArray<number>
	readonly readMetrics: () => ScrollMetrics
	readonly readState: () => StickState
	readonly applyHeight: (scrollHeight: number) => void
	readonly notifyContentChanged: () => void
	readonly thresholdPx?: number
}): ReadonlyArray<ContentVisibilityTraceFrame> => {
	const threshold =
		input.thresholdPx === undefined ? DEFAULT_AT_BOTTOM_THRESHOLD_PX : input.thresholdPx

	const snapshot = (index: number): ContentVisibilityTraceFrame => {
		const metrics = input.readMetrics()
		const state = input.readState()
		return {
			index,
			released: state.released,
			hasUnreadBelow: state.hasUnreadBelow,
			scrollTop: metrics.scrollTop,
			scrollHeight: metrics.scrollHeight,
			clientHeight: metrics.clientHeight,
			distanceFromBottomPx: distanceFromBottomPx(metrics),
			atBottom: isAtBottom(metrics, threshold),
		}
	}

	const frames: Array<ContentVisibilityTraceFrame> = [snapshot(0)]
	let index = 1
	for (const height of input.heights) {
		input.applyHeight(height)
		input.notifyContentChanged()
		frames.push(snapshot(index))
		index += 1
	}
	return frames
}
