/**
 * State for loading progress animation.
 *
 * Tracks animation frame ID, start time, and current progress percentage.
 */
export interface LoadingAnimationState {
	/**
	 * Current loading progress percentage (0-100).
	 */
	readonly progress: number;

	/**
	 * Animation frame ID from requestAnimationFrame, or null if not animating.
	 */
	readonly animationId: number | null;

	/**
	 * Timestamp when animation started (from performance.now()), or null.
	 */
	readonly startTime: number | null;
}
