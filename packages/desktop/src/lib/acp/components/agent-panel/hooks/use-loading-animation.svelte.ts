import { onDestroy } from "svelte";
import { calculateLoadingProgress, isLoadingComplete } from "../logic";
import type { LoadingAnimationState } from "../types";

/**
 * Hook for managing loading animation state.
 *
 * Provides methods to start/stop animation and tracks current progress.
 * Uses requestAnimationFrame for smooth 60fps animation.
 *
 * @returns Animation state and control methods
 *
 * @example
 * ```ts
 * const animation = useLoadingAnimation();
 *
 * // Start animation
 * animation.start();
 *
 * // Access progress
 * $inspect(animation.state.progress); // 0-100
 *
 * // Stop when done
 * animation.stop();
 * ```
 */
export function useLoadingAnimation() {
	let progress = $state(0);
	let animationId = $state<number | null>(null);
	let startTime = $state<number | null>(null);

	/**
	 * Animation frame callback.
	 * Calculates progress and requests next frame if not complete.
	 */
	function animate(currentTime: number) {
		if (startTime === null) {
			return;
		}

		const newProgress = calculateLoadingProgress(startTime, currentTime);
		progress = newProgress;

		if (!isLoadingComplete(newProgress)) {
			animationId = requestAnimationFrame(animate);
		} else {
			animationId = null;
			startTime = null;
		}
	}

	/**
	 * Starts the loading animation.
	 * No-op if animation is already running.
	 */
	function start() {
		if (animationId !== null) {
			return;
		}

		startTime = performance.now();
		progress = 0;
		animationId = requestAnimationFrame(animate);
	}

	/**
	 * Stops the loading animation and resets state.
	 */
	function stop() {
		if (animationId !== null) {
			cancelAnimationFrame(animationId);
			animationId = null;
		}
		startTime = null;
		progress = 0;
	}

	// Cleanup on destroy
	onDestroy(() => {
		if (animationId !== null) {
			cancelAnimationFrame(animationId);
		}
	});

	return {
		get state(): LoadingAnimationState {
			return {
				progress,
				animationId,
				startTime,
			};
		},
		start,
		stop,
	};
}
