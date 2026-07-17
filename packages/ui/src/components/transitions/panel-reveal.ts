import { cubicOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";
import { reducedMotion } from "../../lib/hooks/reduced-motion.svelte.js";

/**
 * transitions.dev #07 panel-reveal — slide + opacity + cross-blur.
 *
 * Pure presentational helper for `@acepe/ui`. Pair with `in:` / `out:` on keyed
 * list rows that should animate into a clipped container.
 */

export interface PanelRevealParams {
	/** Duration in milliseconds. Defaults to 400 (transitions.dev --panel-open-dur). */
	readonly duration?: number;
	/** Vertical travel in pixels. Defaults to 12 (compact sidebar row). */
	readonly translateY?: number;
	/** Peak blur in pixels. Defaults to 2. */
	readonly blur?: number;
}

const DEFAULT_OPEN_DURATION_MS = 400;
const DEFAULT_CLOSE_DURATION_MS = 350;
const DEFAULT_TRANSLATE_Y_PX = 12;
const DEFAULT_BLUR_PX = 2;

/** Panel slides up into view with fade + cross-blur. */
export function panelRevealIn(
	_node: Element,
	params: PanelRevealParams = {}
): TransitionConfig {
	const reduced = reducedMotion.current;
	const translateY = params.translateY ?? DEFAULT_TRANSLATE_Y_PX;
	const blur = params.blur ?? DEFAULT_BLUR_PX;
	return {
		duration: reduced ? 0 : (params.duration ?? DEFAULT_OPEN_DURATION_MS),
		easing: cubicOut,
		css: (t) => {
			const y = (1 - t) * translateY;
			const b = (1 - t) * blur;
			return `transform: translateY(${y}px); opacity: ${t}; filter: blur(${b}px);`;
		},
	};
}

/** Panel slides down out of view with fade + cross-blur. */
export function panelRevealOut(
	_node: Element,
	params: PanelRevealParams = {}
): TransitionConfig {
	const reduced = reducedMotion.current;
	const translateY = params.translateY ?? DEFAULT_TRANSLATE_Y_PX;
	const blur = params.blur ?? DEFAULT_BLUR_PX;
	return {
		duration: reduced ? 0 : (params.duration ?? DEFAULT_CLOSE_DURATION_MS),
		easing: cubicOut,
		css: (t) => {
			const y = (1 - t) * translateY;
			const b = (1 - t) * blur;
			return `transform: translateY(${y}px); opacity: ${t}; filter: blur(${b}px);`;
		},
	};
}
