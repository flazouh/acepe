import { describe, expect, it, beforeEach } from "vitest";
import {
	BAR_COUNT,
	MIN_HEIGHT,
	MAX_HEIGHT,
	smooth,
	toDisplayHeight,
	buildDisplayHeights,
} from "../waveform-math.js";

/**
 * Test waveform-math.ts (pure TS — no Svelte runes).
 * Tests WaveformState integrated behaviour via the underlying math helpers.
 */

/** Simulate the full state used by WaveformState for integration-style tests. */
function makeState() {
	const smoothed = new Float32Array(BAR_COUNT);
	let writeIndex = 0;
	return {
		pushBatch(values: [number, number, number]) {
			for (const raw of values) {
				const idx = writeIndex % BAR_COUNT;
				smoothed[idx] = smooth(smoothed[idx], raw);
				writeIndex++;
			}
			return buildDisplayHeights(smoothed, writeIndex);
		},
		reset() {
			smoothed.fill(0);
			writeIndex = 0;
			return buildDisplayHeights(smoothed, writeIndex);
		},
		getHeights() {
			return buildDisplayHeights(smoothed, writeIndex);
		},
		getSmoothed() {
			return smoothed;
		},
	};
}

describe("waveform-math smooth()", () => {
	it("returns value between prev and raw (interpolation)", () => {
		const result = smooth(0, 1);
		expect(result).toBeGreaterThan(0);
		expect(result).toBeLessThanOrEqual(1);
	});

	it("attack (rising) is larger step than decay (falling)", () => {
		const riseResult = smooth(0, 1); // attack: 0 + 0.6*(1-0) = 0.6
		const fallResult = smooth(1, 0); // decay:  1 + 0.15*(0-1) = 0.85
		// Compare the MAGNITUDE of change, not the result value
		const riseDelta = Math.abs(riseResult - 0); // = 0.6
		const fallDelta = Math.abs(fallResult - 1); // = 0.15
		expect(riseDelta).toBeGreaterThan(fallDelta);
	});

	it("smooth(x, x) returns x (stable)", () => {
		expect(smooth(0.5, 0.5)).toBeCloseTo(0.5);
	});
});

describe("waveform-math toDisplayHeight()", () => {
	it("maps 0 to MIN_HEIGHT", () => {
		expect(toDisplayHeight(0)).toBe(MIN_HEIGHT);
	});

	it("maps 1 to MAX_HEIGHT", () => {
		expect(toDisplayHeight(1)).toBe(MAX_HEIGHT);
	});

	it("maps intermediate value between MIN and MAX", () => {
		const h = toDisplayHeight(0.5);
		expect(h).toBeGreaterThan(MIN_HEIGHT);
		expect(h).toBeLessThan(MAX_HEIGHT);
	});
});

describe("WaveformState integration (via waveform-math)", () => {
	let waveform: ReturnType<typeof makeState>;

	beforeEach(() => {
		waveform = makeState();
	});

	it("initialises all bars at MIN_HEIGHT", () => {
		const heights = waveform.getHeights();
		expect(heights).toHaveLength(BAR_COUNT);
		for (const h of heights) {
			expect(h).toBe(MIN_HEIGHT);
		}
	});

	it("reset returns all bars to MIN_HEIGHT", () => {
		waveform.pushBatch([1, 1, 1]);
		const heights = waveform.reset();
		for (const h of heights) {
			expect(h).toBe(MIN_HEIGHT);
		}
	});

	it("pushBatch with zeros keeps bars at MIN_HEIGHT", () => {
		const heights = waveform.pushBatch([0, 0, 0]);
		for (const h of heights) {
			expect(h).toBeCloseTo(MIN_HEIGHT, 1);
		}
	});

	it("pushBatch with amplitude 1.0 raises affected bars above MIN_HEIGHT", () => {
		// Push many full-amplitude batches to saturate smoothed values
		let heights: number[] = [];
		for (let i = 0; i < 20; i++) {
			heights = waveform.pushBatch([1, 1, 1]);
		}
		const max = Math.max(...heights);
		expect(max).toBeGreaterThan(MIN_HEIGHT + 10);
	});

	it("bars never exceed MAX_HEIGHT", () => {
		let heights: number[] = [];
		for (let i = 0; i < 40; i++) {
			heights = waveform.pushBatch([1, 1, 1]);
		}
		for (const h of heights) {
			expect(h).toBeLessThanOrEqual(MAX_HEIGHT);
		}
	});

	it("bars are always at least MIN_HEIGHT", () => {
		for (let i = 0; i < 40; i++) {
			waveform.pushBatch([1, 1, 1]);
		}
		let heights: number[] = [];
		for (let i = 0; i < 40; i++) {
			heights = waveform.pushBatch([0, 0, 0]);
		}
		for (const h of heights) {
			expect(h).toBeGreaterThanOrEqual(MIN_HEIGHT);
		}
	});

	it("buildDisplayHeights returns exactly BAR_COUNT elements", () => {
		for (let i = 0; i < 100; i++) {
			waveform.pushBatch([Math.random(), Math.random(), Math.random()]);
		}
		expect(waveform.getHeights()).toHaveLength(BAR_COUNT);
	});
});

