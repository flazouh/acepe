/**
 * Capitalize the first letter of each word in a string.
 * Handles spaces, underscores, and hyphens as word separators.
 */
export function capitalizeName(name: string): string {
	return name
		.split(/[\s_-]+/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}
