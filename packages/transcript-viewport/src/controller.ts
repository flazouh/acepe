/**
 * DOM wiring for the pure {@link ./follow.ts} controller: reads live scroll
 * geometry, applies {@link ScrollAction}, and bridges intent / scroll / resize
 * into the pure transitions. Decision logic stays in follow.ts.
 *
 * Follow-release is gated on user-intent events (wheel, touch, key, scrollbar
 * pointerdown) plus the time-boxed programmatic guard. Generic `scroll` cannot
 * release follow. Clock and frame/timeout scheduling are injected so this file
 * never calls Date, rAF, or setTimeout.
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
} from "./follow.ts"
import {
	readHostScrollMetrics,
	type TranscriptScrollHost,
	type TranscriptViewportEvent,
	type ViewportScheduler,
} from "./host.ts"

export type ResolveRowTop = (rowId: string) => number | null

export type ResolveAnchor = () => {
	readonly rowId: string
	readonly topPx: number
} | null

type EdgeState = { readonly atTop: boolean; readonly atBottom: boolean }

const maxScrollTopFromMetrics = (metrics: ScrollMetrics): number =>
	Math.max(0, metrics.scrollHeight - metrics.clientHeight)

export const applyScrollAction = (
	host: TranscriptScrollHost,
	action: ScrollAction,
	resolveRowTop?: ResolveRowTop,
	metrics: ScrollMetrics = readHostScrollMetrics(host),
): boolean => {
	const before = host.scrollTop
	switch (action.kind) {
		case "none":
			return false
		case "toBottom":
			host.scrollTop = maxScrollTopFromMetrics(metrics)
			return host.scrollTop !== before
		case "preserveAnchor":
			host.scrollTop = Math.max(0, before + action.deltaPx)
			return host.scrollTop !== before
		case "anchorRowNearTop": {
			const rowTop = resolveRowTop === undefined ? null : resolveRowTop(action.rowId)
			if (rowTop === null) {
				return false
			}
			host.scrollTop = Math.min(
				maxScrollTopFromMetrics(metrics),
				Math.max(0, rowTop - action.peekPx),
			)
			return host.scrollTop !== before
		}
	}
}

export type TranscriptViewportParams = {
	readonly nowMs: () => number
	readonly scheduler: ViewportScheduler
	readonly thresholdPx?: number
	readonly contentElement?: Element
	readonly readScrollMetrics?: () => ScrollMetrics
	readonly resolveAnchor?: ResolveAnchor
	readonly resolveRowTop?: ResolveRowTop
	readonly onStateChange?: (state: StickState) => void
	readonly onEdgeStateChange?: (state: {
		readonly atTop: boolean
		readonly atBottom: boolean
	}) => void
	readonly observeContentResize?: boolean
	readonly shouldNotifyContentResize?: () => boolean
	readonly onBeforeSend?: () => void
	readonly coalesceScrollHandling?: boolean
	readonly shouldCoalesceScrollHandling?: () => boolean
}

/**
 * After we move `scrollTop` ourselves (pin/anchor), ignore release for this long.
 * A burst of programmatic writes (placeholder swap, content-visibility
 * estimate→real, anchor corrections) emits several async `scroll` events; a
 * single-shot guard only neutralizes the first, so the rest used to be misread
 * as a user scroll-away and spuriously released follow. A short time-box covers
 * the whole burst.
 */
const PROGRAMMATIC_SUPPRESS_MS = 120

/**
 * How long a user-intent event (wheel/touch/key/scrollbar-drag) keeps the
 * "release is allowed" window open. Re-extended while inertial scrolling is
 * still moving the view up, so momentum is not cut off mid-fling.
 */
const INTENT_DECAY_MS = 150
const UPWARD_INTENT_DECAY_MS = 700
const COALESCED_SCROLL_TIMEOUT_MS = 50

const PAGING_KEYS = new Set([
	"PageUp",
	"PageDown",
	" ",
	"Spacebar",
	"ArrowUp",
	"ArrowDown",
	"Home",
	"End",
])

export type TranscriptViewportController = {
	getState(): StickState
	jumpToLatest(): void
	onSend(): void
	openAt(rowId: string, peekPx: number): void
	scrollToTop(): void
	notifyContentChanged(): void
	destroy(): void
}

export const createTranscriptViewportController = (
	scrollEl: TranscriptScrollHost,
	params: TranscriptViewportParams,
): TranscriptViewportController => {
	const threshold = params.thresholdPx
	const now = params.nowMs

	let state: StickState = initialStickState
	let suppressReleaseUntil = 0
	let interactingUntil = 0
	let upwardInteractingUntil = 0
	let lastScrollTop = scrollEl.scrollTop
	let previousContentHeight = readCurrentScrollMetrics().scrollHeight
	let anchorBaselineTopPx: number | null = null
	let pendingAttachedSendFollow = false
	let lastEmittedEdgeState: EdgeState | null = null
	let cancelFrame: (() => void) | null = null
	let cancelTimeout: (() => void) | null = null

	function readCurrentScrollMetrics(): ScrollMetrics {
		if (params.readScrollMetrics !== undefined) {
			return params.readScrollMetrics()
		}
		return readHostScrollMetrics(scrollEl)
	}

	function armIntent(): void {
		pendingAttachedSendFollow = false
		suppressReleaseUntil = 0
		interactingUntil = now() + INTENT_DECAY_MS
	}

	function armUpwardIntent(): void {
		pendingAttachedSendFollow = false
		suppressReleaseUntil = 0
		const t = now()
		interactingUntil = t + INTENT_DECAY_MS
		upwardInteractingUntil = t + UPWARD_INTENT_DECAY_MS
	}

	function edgeStateFromMetrics(metrics: ScrollMetrics): EdgeState {
		return {
			atTop: metrics.scrollTop <= 0,
			atBottom: isAtBottom(metrics, threshold),
		}
	}

	function emitEdgeState(metrics?: ScrollMetrics): void {
		const next = edgeStateFromMetrics(
			metrics === undefined ? readCurrentScrollMetrics() : metrics,
		)
		if (
			lastEmittedEdgeState !== null &&
			lastEmittedEdgeState.atTop === next.atTop &&
			lastEmittedEdgeState.atBottom === next.atBottom
		) {
			return
		}
		lastEmittedEdgeState = next
		if (params.onEdgeStateChange !== undefined) {
			params.onEdgeStateChange(next)
		}
	}

	function emit(next: StickState, metrics?: ScrollMetrics): void {
		const changed =
			next.released !== state.released || next.hasUnreadBelow !== state.hasUnreadBelow
		state = next
		if (changed === true && params.onStateChange !== undefined) {
			params.onStateChange(state)
		}
		emitEdgeState(metrics)
	}

	function captureAnchorBaseline(): void {
		if (state.released === false) {
			anchorBaselineTopPx = null
			return
		}
		if (params.resolveAnchor === undefined) {
			anchorBaselineTopPx = null
			return
		}
		const anchor = params.resolveAnchor()
		anchorBaselineTopPx = anchor === null ? null : anchor.topPx
	}

	function markProgrammatic(): void {
		suppressReleaseUntil = now() + PROGRAMMATIC_SUPPRESS_MS
	}

	function apply(action: ScrollAction): void {
		const metrics = readCurrentScrollMetrics()
		const moved = applyScrollAction(scrollEl, action, params.resolveRowTop, metrics)
		if (moved === true) {
			markProgrammatic()
		}
		previousContentHeight = metrics.scrollHeight
		lastScrollTop = scrollEl.scrollTop
	}

	function releaseForUserIntent(): void {
		pendingAttachedSendFollow = false
		suppressReleaseUntil = 0
		const metrics = readCurrentScrollMetrics()
		emit({ released: true, hasUnreadBelow: state.hasUnreadBelow }, metrics)
		captureAnchorBaseline()
	}

	function handleScroll(): void {
		const metrics = readCurrentScrollMetrics()
		const atBottom = isAtBottom(metrics, threshold)
		const t = now()
		const movedUp = metrics.scrollTop < lastScrollTop
		lastScrollTop = metrics.scrollTop
		const hasUpwardIntent = t < upwardInteractingUntil

		if (atBottom === true) {
			if (hasUpwardIntent === true && state.released === true) {
				emitEdgeState(metrics)
				captureAnchorBaseline()
				return
			}
			emit(onScrollMeasure(state, metrics, threshold), metrics)
			captureAnchorBaseline()
			return
		}
		const userInteracting = t < interactingUntil
		const ourOwnScroll = t < suppressReleaseUntil
		if (userInteracting === true && ourOwnScroll === false) {
			pendingAttachedSendFollow = false
			if (movedUp === true) {
				interactingUntil = t + INTENT_DECAY_MS
				if (t < upwardInteractingUntil) {
					upwardInteractingUntil = t + UPWARD_INTENT_DECAY_MS
				}
			}
			emit({ released: true, hasUnreadBelow: state.hasUnreadBelow }, metrics)
		} else {
			emitEdgeState(metrics)
			captureAnchorBaseline()
			return
		}
		captureAnchorBaseline()
	}

	function clearScheduledScrollWork(): void {
		if (cancelFrame !== null) {
			cancelFrame()
			cancelFrame = null
		}
		if (cancelTimeout !== null) {
			cancelTimeout()
			cancelTimeout = null
		}
	}

	function runScheduledScrollWork(): void {
		clearScheduledScrollWork()
		handleScroll()
	}

	function shouldCoalesceScrollHandling(): boolean {
		if (params.coalesceScrollHandling === true) {
			return true
		}
		if (params.shouldCoalesceScrollHandling === undefined) {
			return false
		}
		return params.shouldCoalesceScrollHandling() === true
	}

	function scheduleHandleScroll(): void {
		if (shouldCoalesceScrollHandling() === false) {
			handleScroll()
			return
		}
		if (cancelFrame !== null || cancelTimeout !== null) {
			return
		}
		cancelFrame = params.scheduler.scheduleFrame(runScheduledScrollWork)
		cancelTimeout = params.scheduler.scheduleTimeout(
			runScheduledScrollWork,
			COALESCED_SCROLL_TIMEOUT_MS,
		)
	}

	function notifyContentChanged(): void {
		const metrics = readCurrentScrollMetrics()
		const hasUpwardIntent = now() < upwardInteractingUntil
		if (state.released === false && hasUpwardIntent === true) {
			pendingAttachedSendFollow = false
			emit({ released: true, hasUnreadBelow: state.hasUnreadBelow }, metrics)
			captureAnchorBaseline()
		} else if (
			state.released === false &&
			isAtBottom(metrics, threshold) === false &&
			now() < interactingUntil
		) {
			pendingAttachedSendFollow = false
			emit({ released: true, hasUnreadBelow: state.hasUnreadBelow }, metrics)
			captureAnchorBaseline()
		}
		const totalGrowthPx = metrics.scrollHeight - previousContentHeight
		if (
			pendingAttachedSendFollow === true &&
			(state.released === true || Math.abs(totalGrowthPx) > 0.5)
		) {
			pendingAttachedSendFollow = false
		}
		const anchorNow =
			state.released === true && params.resolveAnchor !== undefined
				? params.resolveAnchor()
				: null
		const anchorNowTop = anchorNow === null ? null : anchorNow.topPx
		const anchorDeltaPx =
			anchorBaselineTopPx !== null && anchorNowTop !== null
				? anchorCorrectionPx(anchorBaselineTopPx, anchorNowTop)
				: 0
		const grewBelow = totalGrowthPx - Math.max(0, anchorDeltaPx) > 0.5
		const result = onContentChange(state, { anchorDeltaPx, grewBelow })
		apply(result.action)
		emit(result.state)
		if (anchorNowTop !== null) {
			anchorBaselineTopPx = anchorNowTop
		}
		previousContentHeight = metrics.scrollHeight
	}

	function jumpToLatest(): void {
		const result = jumpToLatestState(state)
		apply(result.action)
		emit(result.state)
	}

	function onSend(): void {
		if (params.onBeforeSend !== undefined) {
			params.onBeforeSend()
		}
		interactingUntil = 0
		upwardInteractingUntil = 0
		pendingAttachedSendFollow = true
		const result = onSendState(state)
		apply(result.action)
		emit(result.state)
		anchorBaselineTopPx = null
	}

	function openAt(rowId: string, peekPx: number): void {
		const rowTop =
			params.resolveRowTop === undefined ? null : params.resolveRowTop(rowId)
		if (rowTop === null) {
			jumpToLatest()
			return
		}
		const result = openAtState(state, rowId, peekPx)
		apply(result.action)
		emit(result.state)
		captureAnchorBaseline()
	}

	function scrollToTop(): void {
		const before = scrollEl.scrollTop
		scrollEl.scrollTop = 0
		if (scrollEl.scrollTop !== before) {
			markProgrammatic()
		}
		previousContentHeight = readCurrentScrollMetrics().scrollHeight
		lastScrollTop = scrollEl.scrollTop
		emit({ released: true, hasUnreadBelow: false })
		captureAnchorBaseline()
	}

	function handleWheel(event: TranscriptViewportEvent): void {
		if (event.type !== "wheel") {
			return
		}
		if (event.deltaY < 0) {
			armUpwardIntent()
			releaseForUserIntent()
			return
		}
		upwardInteractingUntil = 0
		armIntent()
	}

	function handleTouch(): void {
		armIntent()
	}

	function handleKeydown(event: TranscriptViewportEvent): void {
		if (event.type !== "keydown") {
			return
		}
		if (PAGING_KEYS.has(event.key) === false) {
			return
		}
		if (event.key === "PageUp" || event.key === "ArrowUp" || event.key === "Home") {
			armUpwardIntent()
			releaseForUserIntent()
			return
		}
		upwardInteractingUntil = 0
		armIntent()
	}

	function handlePointerDown(event: TranscriptViewportEvent): void {
		if (event.type !== "pointerdown") {
			return
		}
		if (event.offsetX > scrollEl.clientWidth) {
			armIntent()
		}
	}

	const onScrollEvent = (_event: TranscriptViewportEvent): void => {
		scheduleHandleScroll()
	}

	scrollEl.addEventListener("scroll", onScrollEvent, { passive: true })
	scrollEl.addEventListener("wheel", handleWheel, { passive: true })
	scrollEl.addEventListener("touchstart", handleTouch, { passive: true })
	scrollEl.addEventListener("touchmove", handleTouch, { passive: true })
	scrollEl.addEventListener("keydown", handleKeydown)
	scrollEl.addEventListener("pointerdown", handlePointerDown)

	const shouldObserveContentResize = params.observeContentResize !== false
	const contentElement = params.contentElement
	const observer =
		typeof ResizeObserver === "function" &&
		shouldObserveContentResize === true &&
		contentElement !== undefined
			? new ResizeObserver(() => {
					const metrics = readCurrentScrollMetrics()
					const pendingSendHeightChanged =
						pendingAttachedSendFollow === true &&
						state.released === false &&
						Math.abs(metrics.scrollHeight - previousContentHeight) > 0.5
					if (pendingSendHeightChanged === false) {
						const shouldNotifyContentResize = params.shouldNotifyContentResize
						if (
							shouldNotifyContentResize !== undefined &&
							shouldNotifyContentResize() === false
						) {
							return
						}
					}
					pendingAttachedSendFollow = false
					notifyContentChanged()
				})
			: null
	if (observer !== null && contentElement !== undefined) {
		observer.observe(contentElement)
	}
	emitEdgeState()

	return {
		getState: () => state,
		jumpToLatest,
		onSend,
		openAt,
		scrollToTop,
		notifyContentChanged,
		destroy() {
			scrollEl.removeEventListener("scroll", onScrollEvent)
			scrollEl.removeEventListener("wheel", handleWheel)
			scrollEl.removeEventListener("touchstart", handleTouch)
			scrollEl.removeEventListener("touchmove", handleTouch)
			scrollEl.removeEventListener("keydown", handleKeydown)
			scrollEl.removeEventListener("pointerdown", handlePointerDown)
			clearScheduledScrollWork()
			if (observer !== null) {
				observer.disconnect()
			}
		},
	}
}
