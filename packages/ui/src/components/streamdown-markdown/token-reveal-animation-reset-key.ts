import type { StreamdownTokenRevealTiming } from "./types.js";

/**
 * React reconciliation key for the Streamdown token-reveal animation.
 *
 * This key MUST stay stable across streaming deltas of the same message. A key
 * that changes every delta (e.g. one derived from `revealCount`) forces React
 * to unmount and remount the whole Streamdown subtree on each delta, throwing
 * away Streamdown's own cross-render incremental-reveal state
 * (`prevContentLength`). With that state gone, every word in the full
 * accumulated body re-enters the fade keyframe on the next delta instead of
 * only the freshly-arrived tail — the per-delta "stutter".
 *
 * Each `StreamdownMarkdown` instance is dedicated to one transcript row (the
 * upstream transcript `{#each}` is keyed by a stable `rowId`), so a constant key
 * is stable within a single message yet naturally fresh across messages: a new
 * message is a new row id, a new component instance, and a new React root.
 *
 * `undefined` is returned for instant / no-reveal so the smooth → settled
 * transition (when the reveal timing drops to `undefined`) still flips the key
 * once and lets React snap to the final static render.
 */
export const TOKEN_REVEAL_ANIMATION_RESET_KEY = "acepe-token-reveal";

export function createTokenRevealAnimationResetKey(
	tokenRevealTiming: StreamdownTokenRevealTiming | undefined
): string | undefined {
	if (tokenRevealTiming === undefined || tokenRevealTiming.mode === "instant") {
		return undefined;
	}

	return TOKEN_REVEAL_ANIMATION_RESET_KEY;
}
