/**
 * Waveform math for Apple-like fluid audio visualization.
 *
 * Design goals:
 * - Configurable centered bars with a small visible resting state
 * - Quiet background noise stays small; sustained speech expands quickly
 * - Fast attack (sound appears instantly — zero perceived latency)
 * - Smooth decay (bars settle naturally, never snap down)
 * - Center bars respond most, edge bars spread outward with energy
 * - Organic, alive-feeling waveform like macOS Voice Memos
 */

export const DEFAULT_METER_BAR_COUNT = 13;
export const MIN_LEVEL = 0;
export const MAX_LEVEL = 1;

/** Resting fill stays at zero; the overlay adds a tiny visual baseline. */
export const RESTING_FILL = 0;

/** Attack: snap to target nearly instantly (zero perceived latency) */
const ATTACK = 0.9;
/** Decay: fast enough to settle back toward the resting state between phrases */
const DECAY = 0.28;
const SILENCE_GATE = 0.035;
const VOICE_CEILING = 0.2;

export function smooth(prev: number, raw: number): number {
	const alpha = raw > prev ? ATTACK : DECAY;
	return prev + alpha * (raw - prev);
}

export function clampLevel(level: number): number {
	if (level < MIN_LEVEL) {
		return MIN_LEVEL;
	}
	if (level > MAX_LEVEL) {
		return MAX_LEVEL;
	}
	return level;
}

export function batchPeak(values: [number, number, number]): number {
	return Math.max(values[0], values[1], values[2]);
}

/**
 * Convert raw amplitude batch to a 0-1 meter level.
 * Use a blended average/peak reading so one noisy spike does not dominate,
 * then gate the mic floor so silence stays near the baseline while sustained
 * speech still reaches the larger bar heights.
 */
export function toMeterLevel(values: [number, number, number]): number {
	const average = (values[0] + values[1] + values[2]) / 3;
	const signal = average * 0.7 + batchPeak(values) * 0.3;
	if (signal <= SILENCE_GATE) {
		return 0;
	}

	return clampLevel((signal - SILENCE_GATE) / (VOICE_CEILING - SILENCE_GATE));
}

/**
 * Build symmetric center-out meter levels for a configurable bar count.
 *
 * The center bars respond most. Bars further from center need
 * progressively more energy to activate, creating an organic spreading
 * waveform shape. At silence all bars are 0 (invisible).
 */
export function buildMeterLevels(
	level: number,
	barCount: number = DEFAULT_METER_BAR_COUNT
): number[] {
	const clamped = clampLevel(level);
	const safeBarCount = barCount < 1 ? 1 : Math.floor(barCount);
	const center = Math.floor(safeBarCount / 2);
	const maxDistance = center > 0 ? center : 1;

	return Array.from({ length: safeBarCount }, (_, index) => {
		const dist = Math.abs(index - center);
		const normalizedDist = dist / maxDistance;
		const weight = 1 - normalizedDist * 0.55;
		const shaped = clamped * weight;
		return Math.min(Math.sqrt(shaped) * 0.85 + shaped * 0.15, 1);
	});
}
