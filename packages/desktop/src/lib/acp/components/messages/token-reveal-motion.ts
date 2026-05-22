export const TOKEN_REVEAL_STEP_MS = 0;
export const TOKEN_REVEAL_FADE_MS = 630;

export interface TokenRevealTiming {
	readonly revealCount: number;
	readonly baselineMs: number;
	readonly tokStepMs: number;
	readonly tokFadeDurMs: number;
	readonly mode: "smooth" | "instant";
}

export interface TokenRevealBaselineInput {
	readonly latestDeltaProducedAtMonotonicMs: number;
	readonly clockAnchorRustMonotonicMs: number;
	readonly clockAnchorBrowserMs: number;
	readonly browserNowMs: number;
}

export function resolveTokenRevealBaselineMs(input: TokenRevealBaselineInput): number {
	const rustLatestDeltaOffsetMs =
		input.latestDeltaProducedAtMonotonicMs - input.clockAnchorRustMonotonicMs;
	const browserElapsedMs = input.browserNowMs - input.clockAnchorBrowserMs;
	return rustLatestDeltaOffsetMs - browserElapsedMs;
}

export function resolveTokenRevealRemainingMs(timing: TokenRevealTiming): number {
	if (timing.mode === "instant" || timing.revealCount < 1) {
		return 0;
	}

	return timing.baselineMs + (timing.revealCount - 1) * timing.tokStepMs + timing.tokFadeDurMs;
}

export function shouldKeepTokenRevealTiming(input: {
	readonly isStreaming: boolean;
	readonly timing: TokenRevealTiming;
}): boolean {
	if (input.isStreaming) {
		return true;
	}

	return resolveTokenRevealRemainingMs(input.timing) > 0;
}

export function resolveTokenRevealSettleDelayMs(
	timings: readonly TokenRevealTiming[]
): number | null {
	let longestRemainingMs = 0;

	for (const timing of timings) {
		const remainingMs = resolveTokenRevealRemainingMs(timing);
		if (remainingMs > longestRemainingMs) {
			longestRemainingMs = remainingMs;
		}
	}

	if (longestRemainingMs <= 0) {
		return null;
	}

	return Math.ceil(longestRemainingMs) + 16;
}
