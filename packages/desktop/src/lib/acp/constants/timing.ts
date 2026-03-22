/**
 * Timing constants for UI interactions and animations.
 * Centralized definitions prevent magic numbers and ensure consistency.
 */

export const TIMING = {
	/** Focus delay for input elements after mount/state change */
	FOCUS_DELAY_MS: 0,

	/** Toast/notification duration */
	TOAST_DURATION_MS: 2000,

	/** Debounce delay for input changes */
	DEBOUNCE_MS: 100,

	/** Poll interval for debug logger refresh */
	LOGGER_POLL_INTERVAL_MS: 1000,
} as const;

// Validate that all values are non-negative
Object.entries(TIMING).forEach(([key, value]) => {
	if (typeof value === "number" && value < 0) {
		throw new Error(`TIMING.${key} must be non-negative, got ${value}`);
	}
});
