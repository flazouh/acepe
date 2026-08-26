import * as Vitest from "@effect/vitest"
import {
	clampCursor,
	delayBeforeStep,
	isMonotonic,
	scaleDelayMs,
	totalDurationMs,
} from "./timeline.ts"

const steps = [{ offsetMs: 0 }, { offsetMs: 40 }, { offsetMs: 100 }]

Vitest.describe("delayBeforeStep", () => {
	Vitest.it("the first step waits its own offset", () => {
		Vitest.assert.strictEqual(delayBeforeStep(steps, 0), 0)
	})

	Vitest.it("a later step waits only the gap since the previous one", () => {
		Vitest.assert.strictEqual(delayBeforeStep(steps, 1), 40)
		Vitest.assert.strictEqual(delayBeforeStep(steps, 2), 60)
	})

	Vitest.it("an index past the end waits nothing", () => {
		Vitest.assert.strictEqual(delayBeforeStep(steps, 9), 0)
	})

	Vitest.it("a backwards offset never produces a negative wait", () => {
		Vitest.assert.strictEqual(delayBeforeStep([{ offsetMs: 50 }, { offsetMs: 10 }], 1), 0)
	})
})

Vitest.describe("scaleDelayMs", () => {
	Vitest.it("rate 1 keeps capture speed", () => {
		Vitest.assert.strictEqual(scaleDelayMs(80, 1), 80)
	})

	Vitest.it("rate 2 halves the wait", () => {
		Vitest.assert.strictEqual(scaleDelayMs(80, 2), 40)
	})

	Vitest.it("rate 0 removes every wait, which is what CI replays use", () => {
		Vitest.assert.strictEqual(scaleDelayMs(80, 0), 0)
	})
})

Vitest.describe("scenario shape", () => {
	Vitest.it("total duration is the last offset", () => {
		Vitest.assert.strictEqual(totalDurationMs(steps), 100)
		Vitest.assert.strictEqual(totalDurationMs([]), 0)
	})

	Vitest.it("clampCursor stays inside the step list", () => {
		Vitest.assert.strictEqual(clampCursor(-3, 3), 0)
		Vitest.assert.strictEqual(clampCursor(9, 3), 3)
		Vitest.assert.strictEqual(clampCursor(2, 3), 2)
	})

	Vitest.it("offsets that go backwards are rejected", () => {
		Vitest.assert.isTrue(isMonotonic(steps))
		Vitest.assert.isFalse(isMonotonic([{ offsetMs: 10 }, { offsetMs: 5 }]))
	})
})
