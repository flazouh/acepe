/** Number of waveform bars. */
export const BAR_COUNT = 32;
/** Minimum bar height in px (rest position). */
export const MIN_HEIGHT = 3;
/** Maximum bar height in px. */
export const MAX_HEIGHT = 48;
/** Exponential smoothing factor for rising amplitude (fast attack). */
const ATTACK = 0.6;
/** Exponential smoothing factor for falling amplitude (slow decay). */
const DECAY = 0.15;

/**
 * Apply one tick of asymmetric exponential smoothing to a single slot.
 * Attack is fast (ATTACK=0.6), decay is slow (DECAY=0.15).
 */
export function smooth(prev: number, raw: number): number {
	const alpha = raw > prev ? ATTACK : DECAY;
	return prev + alpha * (raw - prev);
}

/**
 * Map a smoothed amplitude value [0..1] to a display pixel height.
 */
export function toDisplayHeight(smoothedValue: number): number {
	return MIN_HEIGHT + smoothedValue * (MAX_HEIGHT - MIN_HEIGHT);
}

/**
 * Given the current smoothed buffer and write index, compute the
 * circular-ordered display heights array (oldest → newest).
 */
export function buildDisplayHeights(
	smoothed: Float32Array,
	writeIndex: number,
): number[] {
	const start = writeIndex % BAR_COUNT;
	const result = new Array<number>(BAR_COUNT);
	for (let i = 0; i < BAR_COUNT; i++) {
		const idx = (start + i) % BAR_COUNT;
		result[i] = toDisplayHeight(smoothed[idx]);
	}
	return result;
}
