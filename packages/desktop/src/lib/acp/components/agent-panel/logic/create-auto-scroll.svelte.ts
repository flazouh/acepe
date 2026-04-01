import { createLogger } from "../../../utils/logger.js";
import { recordHotPathDiagnostic } from "../../../utils/hot-path-diagnostics.js";

const BOTTOM_THRESHOLD = 10;
const AUTO_MARK_TIMEOUT_MS = 400;
const AUTO_SETTLE_TOLERANCE_PX = 32;

const DEBUG = false;
const log = DEBUG
	? (tag: string, ...args: unknown[]) => console.log(`[auto-scroll][${tag}]`, ...args)
	: () => {};
const logger = createLogger({
	id: "auto-scroll-trace",
	name: "AutoScrollTrace",
});

/**
 * Scroll position provider interface - abstracts virtualizer access for testability.
 */
export interface ScrollPositionProvider {
	getScrollSize(): number;
	getViewportSize(): number;
	getScrollOffset(): number;
	scrollToIndex(index: number, options?: { align?: "start" | "center" | "end" }): void;
}

export interface AutoScrollStateSnapshot {
	following: boolean;
	nearBottom: boolean;
	nearTop: boolean;
}

type ScrollMetrics = {
	scrollSize: number;
	viewportSize: number;
	scrollOffset: number;
	distanceFromBottom: number;
	nearBottom: boolean;
	nearTop: boolean;
	canScroll: boolean;
};

export function canNestedScrollableConsumeWheel(options: {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
	deltaY: number;
}): boolean {
	const maxScrollTop = Math.max(0, options.scrollHeight - options.clientHeight);
	if (maxScrollTop <= 1 || options.deltaY === 0) {
		return false;
	}
	if (options.deltaY < 0) {
		return options.scrollTop > 0;
	}
	return options.scrollTop < maxScrollTop;
}

/**
 * Pure logic class for thread follow behavior - fully testable without Svelte runtime.
 *
 * The core state is explicit: either the thread is following the latest content
 * or the user has detached to read history. Scrolling commands reveal the latest
 * item only while following, unless explicitly forced.
 */
export class AutoScrollLogic {
	private _following = true;
	private _provider: ScrollPositionProvider | undefined;
	private _itemCount = 0;
	private _lastScrollMetrics: ScrollMetrics | undefined;
	private _autoMark:
		| {
				startedAt: number;
				expiresAt: number;
				scrollOffsetAtMark: number;
				expectedBottomOffsetAtMark: number;
		  }
		| undefined;

	/**
	 * Whether the thread should keep following the latest content.
	 */
	get following(): boolean {
		return this._following;
	}

	/**
	 * Set the scroll position provider.
	 */
	setProvider(provider: ScrollPositionProvider | undefined): void {
		this._provider = provider;
		this._lastScrollMetrics = undefined;
	}

	/**
	 * Update the current item count for scrollToIndex calculations.
	 */
	setItemCount(count: number): void {
		this._itemCount = count;
	}

	/**
	 * Calculate distance from the bottom of the scrollable content.
	 */
	private distanceFromBottom(): number {
		if (!this._provider) return 0;
		const scrollSize = this._provider.getScrollSize();
		const viewportSize = this._provider.getViewportSize();
		const scrollOffset = this._provider.getScrollOffset();
		return scrollSize - (scrollOffset + viewportSize);
	}

	/**
	 * Check if the scroll position is near the bottom (within threshold).
	 */
	isNearBottom(): boolean {
		if (!this._provider) return true;
		return this.distanceFromBottom() < BOTTOM_THRESHOLD;
	}

	/**
	 * Check if the scroll position is near the top (within threshold).
	 */
	isNearTop(): boolean {
		if (!this._provider) return true;
		return this._provider.getScrollOffset() < BOTTOM_THRESHOLD;
	}

	/**
	 * Check if scrolling is possible (content taller than viewport).
	 */
	private canScroll(): boolean {
		if (!this._provider) return false;
		return this._provider.getScrollSize() - this._provider.getViewportSize() > 1;
	}

	private measure(): ScrollMetrics | null {
		if (!this._provider) {
			return null;
		}

		const scrollSize = this._provider.getScrollSize();
		const viewportSize = this._provider.getViewportSize();
		const scrollOffset = this._provider.getScrollOffset();
		const distanceFromBottom = scrollSize - (scrollOffset + viewportSize);

		return {
			scrollSize,
			viewportSize,
			scrollOffset,
			distanceFromBottom,
			nearBottom: distanceFromBottom < BOTTOM_THRESHOLD,
			nearTop: scrollOffset < BOTTOM_THRESHOLD,
			canScroll: scrollSize - viewportSize > 1,
		};
	}

	private buildStateSnapshot(metrics: ScrollMetrics | null): AutoScrollStateSnapshot {
		return {
			following: this._following,
			nearBottom: metrics ? metrics.nearBottom : true,
			nearTop: metrics ? metrics.nearTop : true,
		};
	}

	getStateSnapshot(): AutoScrollStateSnapshot {
		return this.buildStateSnapshot(this.measure());
	}

	/**
	 * Mark the current scroll as programmatic. Records a suppression window and
	 * the bottom offset we targeted so subsequent scroll events caused by
	 * virtualization remeasurement can be treated as programmatic settling.
	 */
	private markAuto(): void {
		if (!this._provider) return;
		const now = Date.now();
		this._autoMark = {
			startedAt: now,
			expiresAt: now + AUTO_MARK_TIMEOUT_MS,
			scrollOffsetAtMark: this._provider.getScrollOffset(),
			expectedBottomOffsetAtMark: Math.max(
				0,
				this._provider.getScrollSize() - this._provider.getViewportSize()
			),
		};
	}

	/**
	 * Check if the current scroll position should be treated as the aftermath of
	 * a recent programmatic revealLatest() call. This uses a short suppression
	 * window plus a tolerant bottom-offset range to handle dynamic-height
	 * virtualization where measured heights settle asynchronously.
	 */
	isAuto(): boolean {
		const metrics = this.measure();
		if (!metrics) {
			return false;
		}

		return this.isAutoForMetrics(metrics);
	}

	private isAutoForMetrics(metrics: ScrollMetrics): boolean {
		if (!this._autoMark) return false;
		if (Date.now() > this._autoMark.expiresAt) {
			this._autoMark = undefined;
			return false;
		}
		const currentOffset = metrics.scrollOffset;
		const isWithinSettlingRange =
			currentOffset >= this._autoMark.expectedBottomOffsetAtMark - AUTO_SETTLE_TOLERANCE_PX;

		if (metrics.nearBottom || isWithinSettlingRange) {
			return true;
		}

		// Clear suppression if we've clearly moved away from the previously targeted bottom.
		if (currentOffset < this._autoMark.scrollOffsetAtMark - AUTO_SETTLE_TOLERANCE_PX) {
			this._autoMark = undefined;
		}

		return false;
	}

	/**
	 * Reveal the latest content.
	 *
	 * @param force - If true, reveal even while detached and re-enter follow mode
	 * @returns true if scroll was executed, false if skipped
	 */
	revealLatest(force?: boolean): boolean {
		return this.revealIndex(this._itemCount - 1, force);
	}

	revealIndex(index: number, force?: boolean): boolean {
		if (!this._provider) {
			recordHotPathDiagnostic("auto-scroll", "reveal-missing-provider");
			logger.info("revealIndex", {
				index,
				force: force ?? false,
				following: this._following,
				reason: "missing_provider",
			});
			return false;
		}
		if (index < 0) {
			recordHotPathDiagnostic("auto-scroll", "reveal-negative-index");
			logger.info("revealIndex", {
				index,
				force: force ?? false,
				following: this._following,
				reason: "negative_index",
			});
			return false;
		}

		// Respect user scroll control unless forced
		if (!this._following) {
			if (!force) {
				recordHotPathDiagnostic("auto-scroll", "reveal-detached-without-force");
				logger.info("revealIndex", {
					index,
					force: force ?? false,
					following: this._following,
					reason: "detached_without_force",
				});
				log("revealLatest", "SKIPPED (user has control)");
				return false;
			}
			log("revealLatest", "FORCE override, re-entering follow mode");
			this._following = true;
		}

		// Content fits in viewport — nothing to scroll
		if (!this.canScroll()) {
			recordHotPathDiagnostic("auto-scroll", "reveal-content-fits");
			logger.info("revealIndex", {
				index,
				force: force ?? false,
				following: this._following,
				reason: "content_fits_viewport",
				scrollSize: this._provider.getScrollSize(),
				viewportSize: this._provider.getViewportSize(),
				scrollOffset: this._provider.getScrollOffset(),
			});
			return false;
		}

		// Already at bottom
		const distanceFromBottom = this.distanceFromBottom();
		if (distanceFromBottom < 2) {
			recordHotPathDiagnostic("auto-scroll", "reveal-already-at-bottom", distanceFromBottom);
			logger.info("revealIndex", {
				index,
				force: force ?? false,
				following: this._following,
				reason: "already_at_bottom",
				distanceFromBottom,
				scrollSize: this._provider.getScrollSize(),
				viewportSize: this._provider.getViewportSize(),
				scrollOffset: this._provider.getScrollOffset(),
			});
			return false;
		}

		// Mark as programmatic before scrolling
		this.markAuto();
		recordHotPathDiagnostic("auto-scroll", "reveal-scrolling", distanceFromBottom);
		logger.info("revealIndex", {
			index,
			force: force ?? false,
			following: this._following,
			reason: "scrolling",
			distanceFromBottom,
			scrollSize: this._provider.getScrollSize(),
			viewportSize: this._provider.getViewportSize(),
			scrollOffset: this._provider.getScrollOffset(),
		});

		log(
			"revealLatest",
			"SCROLLING to index",
			index,
			"force=",
			force,
			"dist=",
			this.distanceFromBottom()
		);

		// Use scrollToIndex for reliability (pixel offsets can be stale during content changes)
		this._provider.scrollToIndex(index, { align: "end" });

		return true;
	}

	/**
	 * Handle wheel event for user intent detection.
	 *
	 * - Scrolling UP (negative deltaY): detach — user wants to read history.
	 * - Scrolling DOWN (positive deltaY) near bottom: re-engage auto-scroll.
	 *
	 * Wheel intent is the eager detach/re-engage path. handleScroll() still
	 * re-attaches when the user returns to bottom via non-wheel input.
	 *
	 * @param deltaY - Wheel delta (negative = scrolling up, positive = scrolling down)
	 * @param isNestedScrollable - Whether the target is inside a [data-scrollable] element
	 */
	handleWheelIntent(deltaY: number, isNestedScrollable: boolean): void {
		// Ignore scrolling in nested scrollable areas (e.g., code blocks)
		if (isNestedScrollable) {
			log("wheel", "IGNORED nested scrollable, deltaY=", deltaY);
			return;
		}

		if (deltaY < 0) {
			// Scrolling up — detach
			const wasFollowing = this._following;
			this._following = false;
			if (wasFollowing) log("wheel", "DETACH (scroll up), deltaY=", deltaY);
		} else if (deltaY > 0) {
			if (!this._following && this.isNearBottom()) {
				// Scrolling down while near bottom — re-engage
				this._following = true;
				log(
					"wheel",
					"RE-ENGAGE (scroll down near bottom), deltaY=",
					deltaY,
					"dist=",
					this.distanceFromBottom()
				);
				return;
			}

			// Respect explicit user wheel scrolling (downward too) when not at bottom.
			// This prevents auto-scroll from fighting attempts to manually approach
			// the bottom during active streaming/remeasurement.
			if (this._following && !this.isNearBottom()) {
				this._following = false;
				log("wheel", "DETACH (scroll down away from bottom), deltaY=", deltaY);
			}
		}
	}

	/**
	 * Handle scroll position changes from the list viewport.
	 * Marks the user detached when they move away from bottom, and re-attaches
	 * once they intentionally return to bottom via scroll position alone.
	 */
	handleScroll(): AutoScrollStateSnapshot {
		const metrics = this.measure();
		if (!metrics) {
			return this.buildStateSnapshot(null);
		}

		const previousMetrics = this._lastScrollMetrics;
		this._lastScrollMetrics = metrics;

		// Content fits in viewport — reset, nothing to track
		if (!metrics.canScroll) {
			if (!this._following) {
				log("scroll", "RESET (content fits viewport)");
				this._following = true;
			}
			return this.buildStateSnapshot(metrics);
		}

		// Ignore scroll events triggered by our own scrollToBottom calls.
		if (this.isAutoForMetrics(metrics)) {
			log("scroll", "IGNORED (isAuto), dist=", metrics.distanceFromBottom);
			return this.buildStateSnapshot(metrics);
		}

		const contentGrewWithoutUserScroll =
			previousMetrics !== undefined &&
			metrics.scrollSize > previousMetrics.scrollSize &&
			metrics.scrollOffset >= previousMetrics.scrollOffset;

		if (this._following && contentGrewWithoutUserScroll) {
			log(
				"scroll",
				"IGNORED (content growth while following), dist=",
				metrics.distanceFromBottom
			);
			return this.buildStateSnapshot(metrics);
		}

		// Near bottom — not a detach, just normal position.
		// Re-engagement happens only via handleWheelIntent (unambiguous user intent).
		if (metrics.nearBottom) {
			return this.buildStateSnapshot(metrics);
		}

		// User scrolled away from bottom
		if (this._following) {
			log(
				"scroll",
				"DETACH (scrolled away), dist=",
				metrics.distanceFromBottom,
				"offset=",
				metrics.scrollOffset
			);
		}
		this._following = false;
		return this.buildStateSnapshot(metrics);
	}

	/**
	 * Reset state (e.g., for session changes).
	 */
	reset(): void {
		log("reset", "clearing state");
		this._following = true;
		this._autoMark = undefined;
		this._lastScrollMetrics = undefined;
	}
}

/**
 * Creates a reactive auto-scroll manager with Svelte 5 state.
 *
 * This is a thin wrapper around AutoScrollLogic that exposes reactive state
 * via $state for use in Svelte components.
 */
export function createAutoScroll() {
	const logic = new AutoScrollLogic();
	let following = $state(true);
	let nearBottom = $state(true);
	let nearTop = $state(true);
	let rafId: number | null = null;

	// Sync reactive state from logic.
	// IMPORTANT: Do NOT read `following` here (e.g., for equality check).
	// Any $state read inside syncState() would become a tracked dependency
	// in every $effect that calls it, causing feedback loops.
	// Svelte 5 $state already skips updates when the value doesn't change (=== check).
	function syncState(snapshot?: AutoScrollStateSnapshot): void {
		const nextState = snapshot ? snapshot : logic.getStateSnapshot();
		following = nextState.following;
		nearBottom = nextState.nearBottom;
		nearTop = nextState.nearTop;
	}

	function setVListRef(ref: ScrollPositionProvider | undefined): void {
		logic.setProvider(ref);
		if (!ref && rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		syncState();
	}

	function setItemCount(count: number): void {
		logic.setItemCount(count);
	}

	function revealLatest(force?: boolean): boolean {
		const didReveal = logic.revealLatest(force);
		syncState(logic.getStateSnapshot());
		return didReveal;
	}

	function revealIndex(index: number, force?: boolean): boolean {
		const didReveal = logic.revealIndex(index, force);
		syncState(logic.getStateSnapshot());
		return didReveal;
	}

	function isNearBottom(): boolean {
		const snapshot = logic.getStateSnapshot();
		syncState(snapshot);
		return snapshot.nearBottom;
	}

	function handleWheel(e: WheelEvent): void {
		const target = e.target instanceof Element ? e.target : null;
		const nestedScrollable = target?.closest("[data-scrollable]");
		const isNestedScrollable =
			nestedScrollable instanceof HTMLElement
				? canNestedScrollableConsumeWheel({
						scrollTop: nestedScrollable.scrollTop,
						scrollHeight: nestedScrollable.scrollHeight,
						clientHeight: nestedScrollable.clientHeight,
						deltaY: e.deltaY,
					})
				: false;
		recordHotPathDiagnostic("auto-scroll", "wheel-event", e.deltaY);
		logic.handleWheelIntent(e.deltaY, isNestedScrollable);
		syncState(logic.getStateSnapshot());
	}

	/**
	 * RAF-throttled scroll handler. Batches scroll events to at most once per
	 * animation frame, preventing synchronous layout thrashing (multiple
	 * getScrollSize/getViewportSize/getScrollOffset reads per frame).
	 */
	function handleScroll(): void {
		if (rafId !== null) return;
		recordHotPathDiagnostic("auto-scroll", "handle-scroll-scheduled");
		rafId = requestAnimationFrame(() => {
			rafId = null;
			recordHotPathDiagnostic("auto-scroll", "handle-scroll-frame");
			syncState(logic.handleScroll());
		});
	}

	function reset(): void {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		logic.reset();
		syncState(logic.getStateSnapshot());
	}

	return {
		setVListRef,
		setItemCount,
		revealLatest,
		revealIndex,
		handleWheel,
		handleScroll,
		reset,
		isNearBottom,
		get following() {
			return following;
		},
		get nearBottom() {
			return nearBottom;
		},
		get nearTop() {
			return nearTop;
		},
	};
}
