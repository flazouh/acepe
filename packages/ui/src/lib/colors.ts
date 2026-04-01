/**
 * Color name constants for project icons.
 */
export const COLOR_NAMES = {
	RED: "red",
	ORANGE: "orange",
	AMBER: "amber",
	YELLOW: "yellow",
	LIME: "lime",
	GREEN: "green",
	TEAL: "teal",
	CYAN: "cyan",
	BLUE: "blue",
	INDIGO: "indigo",
	PURPLE: "purple",
	PINK: "pink",
} as const;

/**
 * Color definitions with hex values.
 * GREEN: keep in sync with design-tokens.css --token-build-icon-dark
 * ORANGE: keep in sync with design-tokens.css --token-plan-icon-light
 */
export const Colors = {
	[COLOR_NAMES.RED]: "#FF5D5A",
	[COLOR_NAMES.ORANGE]: "#FF8D20",
	[COLOR_NAMES.AMBER]: "#FFB347",
	[COLOR_NAMES.YELLOW]: "#FAD83C",
	[COLOR_NAMES.LIME]: "#B7E63E",
	[COLOR_NAMES.GREEN]: "#99FFE4",
	[COLOR_NAMES.TEAL]: "#18D6C3",
	[COLOR_NAMES.CYAN]: "#4AD0FF",
	[COLOR_NAMES.BLUE]: "#4D8DFF",
	[COLOR_NAMES.INDIGO]: "#6F6BFF",
	[COLOR_NAMES.PURPLE]: "#9858FF",
	[COLOR_NAMES.PINK]: "#FF78F7",
} as const;

/**
 * Array of colors for project icons.
 */
export const TAG_COLORS = [
	Colors[COLOR_NAMES.RED],
	Colors[COLOR_NAMES.ORANGE],
	Colors[COLOR_NAMES.AMBER],
	Colors[COLOR_NAMES.YELLOW],
	Colors[COLOR_NAMES.LIME],
	Colors[COLOR_NAMES.GREEN],
	Colors[COLOR_NAMES.TEAL],
	Colors[COLOR_NAMES.CYAN],
	Colors[COLOR_NAMES.BLUE],
	Colors[COLOR_NAMES.INDIGO],
	Colors[COLOR_NAMES.PURPLE],
	Colors[COLOR_NAMES.PINK],
];

/**
 * Array of border colors for project icons (same as TAG_COLORS).
 */
export const TAG_BORDER_COLORS = TAG_COLORS;

/**
 * Validates if a string is a valid hex color (e.g., "#FF5D5A" or "#f5d").
 */
export function isValidHexColor(color: string): boolean {
	return /^#[0-9A-F]{6}$/i.test(color) || /^#[0-9A-F]{3}$/i.test(color);
}

/**
 * Normalizes a color name by converting to lowercase and trimming whitespace.
 */
export function normalizeColorName(color: string): string {
	return color.toLowerCase().trim();
}

/**
 * Resolves a color input to a hex color value.
 * Handles both named colors (from Colors object) and direct hex colors.
 */
export function resolveColorValue(color: string): string | null {
	// Check if it's already a hex color
	if (isValidHexColor(color)) return color;

	// Try named color lookup
	const normalized = normalizeColorName(color);
	return Colors[normalized as keyof typeof Colors] || null;
}

/**
 * Gets the resolved color for a project.
 * Projects always have a color, so this always returns a valid hex color.
 */
export function getProjectColor(project: { color: string }): string {
	const resolved = resolveColorValue(project.color);
	if (resolved) return resolved;

	// Fallback to default if color is invalid (shouldn't happen, but be safe)
	return TAG_COLORS[0] ?? "#FF5D5A";
}

/**
 * Resolves a color string to a hex color value.
 * Useful when you only have a color string and not a full project object.
 */
export function resolveProjectColor(color: string): string {
	const resolved = resolveColorValue(color);
	if (resolved) return resolved;

	// Fallback to default if color is invalid
	return TAG_COLORS[0] ?? "#FF5D5A";
}
