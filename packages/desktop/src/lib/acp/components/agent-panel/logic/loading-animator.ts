import { LOADING_DURATION_MS } from "../constants";

/**
 * Calculates the current loading progress percentage.
 *
 * Pure function that computes progress based on elapsed time.
 * Progress is clamped between 0 and 100.
 *
 * @param startTime - Timestamp when animation started (from performance.now())
 * @param currentTime - Current timestamp (from performance.now())
 * @param durationMs - Total duration for the animation
 * @returns Progress percentage (0-100)
 *
 * @example
 * ```ts
 * const progress = calculateLoadingProgress(1000, 1500, 2000);
 * // Returns 25 (25% complete)
 * ```
 */
export function calculateLoadingProgress(
	startTime: number,
	currentTime: number,
	durationMs: number = LOADING_DURATION_MS
): number {
	const elapsed = currentTime - startTime;
	const progress = (elapsed / durationMs) * 100;
	return Math.min(100, Math.round(progress));
}

/**
 * Checks if the loading animation is complete.
 *
 * @param progress - Current progress percentage
 * @returns True if animation has reached 100%
 *
 * @example
 * ```ts
 * isLoadingComplete(95); // false
 * isLoadingComplete(100); // true
 * ```
 */
export function isLoadingComplete(progress: number): boolean {
	return progress >= 100;
}
