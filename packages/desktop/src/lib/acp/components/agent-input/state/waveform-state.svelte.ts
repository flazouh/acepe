import {
	BAR_COUNT,
	MIN_HEIGHT,
	MAX_HEIGHT,
	smooth,
	buildDisplayHeights,
} from "./waveform-math.js";

/**
 * Manages waveform visualization state with high-performance non-reactive internals.
 *
 * - Uses `$state.raw` (not `$state`) for the amplitude display array — avoids
 *   Svelte proxy overhead on a 32-element array updated 30x/sec.
 * - Internal smoothing uses a plain Float32Array (never proxied).
 * - Circular buffer with write-index — never uses shift/push (O(n)).
 * - Business logic delegated to waveform-math.ts for pure unit testing.
 */
export class WaveformState {
	static readonly BAR_COUNT = BAR_COUNT;
	static readonly MIN_HEIGHT = MIN_HEIGHT;
	static readonly MAX_HEIGHT = MAX_HEIGHT;

	/** Display-ready bar heights (reactive via $state.raw — single-write per batch). */
	barHeights = $state.raw<number[]>(new Array(BAR_COUNT).fill(MIN_HEIGHT));

	// --- Non-reactive internals (performance) ---
	private readonly smoothed = new Float32Array(BAR_COUNT);
	private writeIndex = 0;

	/**
	 * Push a batch of 3 amplitude values (from batched `voice://amplitude` event).
	 * Applies asymmetric exponential smoothing and updates `barHeights` with a
	 * single reactive write.
	 */
	pushBatch(values: [number, number, number]): void {
		for (const raw of values) {
			const idx = this.writeIndex % BAR_COUNT;
			this.smoothed[idx] = smooth(this.smoothed[idx], raw);
			this.writeIndex++;
		}
		this.barHeights = buildDisplayHeights(this.smoothed, this.writeIndex);
	}

	/** Reset all bars to minimum height. */
	reset(): void {
		this.smoothed.fill(0);
		this.writeIndex = 0;
		this.barHeights = new Array(BAR_COUNT).fill(MIN_HEIGHT);
	}
}

