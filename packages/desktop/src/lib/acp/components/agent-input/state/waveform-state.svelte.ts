import {
	buildMeterLevels,
	DEFAULT_METER_BAR_COUNT,
	MAX_LEVEL,
	MIN_LEVEL,
	RESTING_FILL,
	smooth,
	toMeterLevel,
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
	static readonly METER_BAR_COUNT = DEFAULT_METER_BAR_COUNT;
	static readonly MIN_LEVEL = MIN_LEVEL;
	static readonly MAX_LEVEL = MAX_LEVEL;
	static readonly STARTUP_PLACEHOLDER_LEVEL = 0;

	readonly barCount: number;

	/** Display-ready meter fill values (RESTING_FILL..1 for configurable centered bars). */
	meterLevels = $state.raw<number[]>([]);
	currentLevel = $state(0);

	private smoothedLevel = 0;

	constructor(barCount: number = DEFAULT_METER_BAR_COUNT) {
		this.barCount = barCount < 1 ? 1 : Math.floor(barCount);
		this.meterLevels = new Array(this.barCount).fill(RESTING_FILL);
	}

	/**
	 * Push a batch of 3 amplitude values and derive a single current level meter.
	 */
	pushBatch(values: [number, number, number]): void {
		this.smoothedLevel = smooth(this.smoothedLevel, toMeterLevel(values));
		this.currentLevel = this.smoothedLevel;
		this.meterLevels = buildMeterLevels(this.smoothedLevel, this.barCount);
	}

	primeStartup(): void {
		this.meterLevels = buildMeterLevels(WaveformState.STARTUP_PLACEHOLDER_LEVEL, this.barCount);
	}

	/** Reset the live meter to silence. */
	reset(): void {
		this.smoothedLevel = 0;
		this.currentLevel = 0;
		this.meterLevels = new Array(this.barCount).fill(RESTING_FILL);
	}
}
