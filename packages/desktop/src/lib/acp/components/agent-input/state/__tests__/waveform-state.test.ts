import { beforeEach, describe, expect, it } from "vitest";
import {
	batchPeak,
	buildMeterLevels,
	clampLevel,
	DEFAULT_METER_BAR_COUNT,
	MAX_LEVEL,
	MIN_LEVEL,
	RESTING_FILL,
	smooth,
	toMeterLevel,
} from "../waveform-math.js";

function makeState() {
	let currentLevel = 0;
	return {
		pushBatch(values: [number, number, number]) {
			currentLevel = smooth(currentLevel, batchPeak(values));
			return {
				currentLevel,
				meterLevels: buildMeterLevels(currentLevel),
			};
		},
		reset() {
			currentLevel = 0;
			return {
				currentLevel,
				meterLevels: new Array(DEFAULT_METER_BAR_COUNT).fill(RESTING_FILL),
			};
		},
		getCurrentLevel() {
			return currentLevel;
		},
	};
}

describe("waveform-math smooth()", () => {
	it("returns value between prev and raw", () => {
		const result = smooth(0, 1);
		expect(result).toBeGreaterThan(0);
		expect(result).toBeLessThanOrEqual(1);
	});

	it("attack rises faster than decay falls", () => {
		const riseDelta = Math.abs(smooth(0, 1) - 0);
		const fallDelta = Math.abs(smooth(1, 0) - 1);
		expect(riseDelta).toBeGreaterThan(fallDelta);
	});
});

describe("waveform-math helpers", () => {
	it("clamps below minimum", () => {
		expect(clampLevel(-1)).toBe(MIN_LEVEL);
	});

	it("clamps above maximum", () => {
		expect(clampLevel(2)).toBe(MAX_LEVEL);
	});

	it("uses the highest value in the batch", () => {
		expect(batchPeak([0.1, 0.7, 0.3])).toBe(0.7);
	});

	it("boosts quiet mic values into visible meter levels", () => {
		expect(toMeterLevel([0.01, 0.03, 0.02])).toBeLessThan(0.05);
		expect(toMeterLevel([0.12, 0.18, 0.15])).toBeGreaterThan(0.6);
	});

	it("builds the default number of meter levels", () => {
		expect(buildMeterLevels(0.5)).toHaveLength(DEFAULT_METER_BAR_COUNT);
	});

	it("uses fewer bars by default so each bar can be visually larger", () => {
		expect(DEFAULT_METER_BAR_COUNT).toBe(13);
	});

	it("supports configurable bar counts", () => {
		expect(buildMeterLevels(0.5, 7)).toHaveLength(7);
	});

	it("fills more bars as level increases", () => {
		const low = buildMeterLevels(0.15);
		const high = buildMeterLevels(0.85);
		// All bars should be higher at higher level
		const lowSum = low.reduce((a, b) => a + b, 0);
		const highSum = high.reduce((a, b) => a + b, 0);
		expect(highSum).toBeGreaterThan(lowSum);
	});

	it("keeps edge bars moving at conversational levels", () => {
		const levels = buildMeterLevels(0.5);
		expect(levels[0]).toBeGreaterThan(0);
		expect(levels[levels.length - 1]).toBeGreaterThan(0);
	});
});

describe("WaveformState live meter math", () => {
	let waveform: ReturnType<typeof makeState>;

	beforeEach(() => {
		waveform = makeState();
	});

	it("starts silent", () => {
		expect(waveform.getCurrentLevel()).toBe(0);
	});

	it("tracks current loudness instead of accumulating a timeline", () => {
		for (let i = 0; i < 8; i++) {
			waveform.pushBatch([1, 0.8, 0.7]);
		}
		expect(waveform.getCurrentLevel()).toBeGreaterThan(0.8);

		// DECAY=0.25 → 0.75^12 ≈ 0.032, well under 0.1
		for (let i = 0; i < 12; i++) {
			waveform.pushBatch([0, 0, 0]);
		}
		expect(waveform.getCurrentLevel()).toBeLessThan(0.1);
	});

	it("reset returns the meter to silence", () => {
		waveform.pushBatch([1, 1, 1]);
		const state = waveform.reset();
		expect(state.currentLevel).toBe(0);
		expect(state.meterLevels).toEqual(new Array(DEFAULT_METER_BAR_COUNT).fill(RESTING_FILL));
	});
});
