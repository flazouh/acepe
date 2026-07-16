import { cubicIn, cubicOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";
import { reducedMotion } from "../../lib/hooks/reduced-motion.svelte.js";

/**
 * Apple-style "cylinder" / drum swap transitions.
 *
 * Both the outgoing and incoming text rotate around the X axis as if printed on
 * the surface of a vertical cylinder turning upward: the old line rolls up and
 * away while the new line rolls up into place. Pairing {@link cylinderIn} with
 * {@link cylinderOut} on a keyed block produces a smooth, perspective-curved
 * roll instead of an abrupt swap.
 *
 * Pure presentational helpers — no app or store coupling, safe for `@acepe/ui`.
 */

export interface CylinderTransitionParams {
	/** Duration in milliseconds. */
	readonly duration?: number;
	/** Peak rotation, in degrees, applied at the start/end of the roll. */
	readonly rotation?: number;
	/** Vertical travel as a percentage of the line height. */
	readonly travel?: number;
}

const DEFAULT_DURATION = 340;
const DEFAULT_ROTATION = 72;
const DEFAULT_TRAVEL = 38;

/** New line rolls up from below the drum into resting position. */
export function cylinderIn(
	_node: Element,
	params: CylinderTransitionParams = {}
): TransitionConfig {
	const reduced = reducedMotion.current;
	const rotation = params.rotation ?? DEFAULT_ROTATION;
	const travel = params.travel ?? DEFAULT_TRAVEL;
	return {
		duration: reduced ? 0 : (params.duration ?? DEFAULT_DURATION),
		easing: cubicOut,
		css: (t) => {
			const angle = (t - 1) * rotation;
			const shift = (1 - t) * travel;
			return `transform: rotateX(${angle}deg) translateY(${shift}%); opacity: ${t};`;
		},
	};
}

/** Old line rolls up and away off the top of the drum. */
export function cylinderOut(
	_node: Element,
	params: CylinderTransitionParams = {}
): TransitionConfig {
	const reduced = reducedMotion.current;
	const rotation = params.rotation ?? DEFAULT_ROTATION;
	const travel = params.travel ?? DEFAULT_TRAVEL;
	return {
		duration: reduced ? 0 : (params.duration ?? DEFAULT_DURATION),
		easing: cubicIn,
		css: (t) => {
			const angle = (1 - t) * rotation;
			const shift = (t - 1) * travel;
			return `transform: rotateX(${angle}deg) translateY(${shift}%); opacity: ${t};`;
		},
	};
}
