import { describe, expect, it } from "vitest";

import {
	resolveTokenRevealBaselineMs,
	shouldKeepTokenRevealTiming,
	TOKEN_REVEAL_FADE_MS,
	TOKEN_REVEAL_STEP_MS,
} from "./token-reveal-motion.js";

describe("TOKEN_REVEAL_STEP_MS", () => {
	it("staggers words inside each backend delta for a smooth cascade", () => {
		expect(TOKEN_REVEAL_STEP_MS).toBe(48);
	});
});

describe("resolveTokenRevealBaselineMs", () => {
	it("anchors animation timing to the latest backend delta", () => {
		expect(
			resolveTokenRevealBaselineMs({
				latestDeltaProducedAtMonotonicMs: 5_000,
				clockAnchorRustMonotonicMs: 1_000,
				clockAnchorBrowserMs: 500,
				browserNowMs: 4_516,
			})
		).toBe(-16);
	});
});

describe("shouldKeepTokenRevealTiming", () => {
	it("keeps non-streaming timing while the final scheduled token has not finished fading", () => {
		expect(
			shouldKeepTokenRevealTiming({
				isStreaming: false,
				timing: {
					revealCount: 4,
					baselineMs: -112,
					tokStepMs: TOKEN_REVEAL_STEP_MS,
					tokFadeDurMs: TOKEN_REVEAL_FADE_MS,
					mode: "smooth",
				},
			})
		).toBe(true);
	});

	it("drops non-streaming timing once the reveal has fully settled", () => {
		expect(
			shouldKeepTokenRevealTiming({
				isStreaming: false,
				timing: {
					revealCount: 4,
					baselineMs: -1_000,
					tokStepMs: TOKEN_REVEAL_STEP_MS,
					tokFadeDurMs: TOKEN_REVEAL_FADE_MS,
					mode: "smooth",
				},
			})
		).toBe(false);
	});
});
