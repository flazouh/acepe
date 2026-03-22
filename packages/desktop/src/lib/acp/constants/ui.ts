/**
 * UI layout and component constants.
 * Defines thresholds and sizes for responsive behavior.
 */

export const UI = {
	/** Button width threshold for compact vs normal mode */
	COMPACT_BUTTON_THRESHOLD_PX: 100,

	/** Threshold for virtualizing large lists in edit diffs */
	VIRTUALIZATION_THRESHOLD: 100,

	/** Default hardcoded color for project icons (gray-500) */
	DEFAULT_PROJECT_COLOR: "#6B7280",

	/** Color for open/active thread indicators */
	ACTIVE_THREAD_COLOR: "#fb923c",

	/** Standard padding for components */
	PADDING_BASE: "0.5rem",

	/** Standard gap between flex items */
	GAP_BASE: "0.5rem",
} as const;

// Validate that all threshold values are positive
Object.entries(UI).forEach(([key, value]) => {
	if (typeof value === "number" && key.includes("THRESHOLD") && value <= 0) {
		throw new Error(`UI.${key} must be positive, got ${value}`);
	}
});
