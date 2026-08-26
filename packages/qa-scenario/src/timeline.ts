/**
 * Pure playback arithmetic for a scenario's step list.
 *
 * Kept free of Effect so the timing rules can be tested directly: a wrong
 * delay is the difference between a streaming bug reproducing and not.
 */

export type ScenarioStepTiming = {
	readonly offsetMs: number
}

/** Milliseconds to wait before emitting `steps[index]`, given the previous step already went out. */
export const delayBeforeStep = <S extends ScenarioStepTiming>(
	steps: ReadonlyArray<S>,
	index: number,
): number => {
	const current = steps[index]
	if (current === undefined) {
		return 0
	}
	const previous = index === 0 ? undefined : steps[index - 1]
	const previousOffset = previous === undefined ? 0 : previous.offsetMs
	const delta = current.offsetMs - previousOffset
	return delta > 0 ? delta : 0
}

/** Wall-clock length of the whole scenario at rate 1. */
export const totalDurationMs = <S extends ScenarioStepTiming>(
	steps: ReadonlyArray<S>,
): number => {
	const last = steps[steps.length - 1]
	return last === undefined ? 0 : last.offsetMs
}

/**
 * A rate of 2 plays twice as fast. A rate of 0 or less means "no waiting at
 * all", which is what a CI replay wants: same order, no wall-clock cost.
 */
export const scaleDelayMs = (delayMs: number, rate: number): number =>
	rate <= 0 ? 0 : delayMs / rate

export const clampCursor = (cursor: number, total: number): number => {
	if (cursor < 0) {
		return 0
	}
	return cursor > total ? total : cursor
}

/** Offsets must never go backwards, or replay order stops matching capture order. */
export const isMonotonic = <S extends ScenarioStepTiming>(steps: ReadonlyArray<S>): boolean => {
	let previous = 0
	for (const step of steps) {
		if (step.offsetMs < previous) {
			return false
		}
		previous = step.offsetMs
	}
	return true
}
