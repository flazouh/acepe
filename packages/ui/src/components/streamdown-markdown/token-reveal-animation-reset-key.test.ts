import { expect, test } from "bun:test";

import { createTokenRevealAnimationResetKey } from "./token-reveal-animation-reset-key.js";
import type { StreamdownTokenRevealTiming } from "./types.js";

function smoothTiming(revealCount: number): StreamdownTokenRevealTiming {
	return {
		revealCount,
		revealedCharCount: revealCount * 4,
		baselineMs: -16,
		tokStepMs: 0,
		tokFadeDurMs: 630,
		mode: "smooth",
	};
}

test("smooth reveal key stays stable across deltas (does not vary with revealCount)", () => {
	// A key that changed every delta remounted the Streamdown subtree and wiped
	// its incremental-reveal state, re-animating the whole body each delta.
	const first = createTokenRevealAnimationResetKey(smoothTiming(1));
	const later = createTokenRevealAnimationResetKey(smoothTiming(42));
	expect(first).toBeDefined();
	expect(first).toBe(later);
});

test("absent timing resets the key so the settled snap can remount once", () => {
	expect(createTokenRevealAnimationResetKey(undefined)).toBeUndefined();
});

test("instant mode resets the key (no smooth reveal sequence to preserve)", () => {
	const instant: StreamdownTokenRevealTiming = {
		revealCount: 3,
		revealedCharCount: 12,
		baselineMs: -16,
		tokStepMs: 0,
		tokFadeDurMs: 630,
		mode: "instant",
	};
	expect(createTokenRevealAnimationResetKey(instant)).toBeUndefined();
});
