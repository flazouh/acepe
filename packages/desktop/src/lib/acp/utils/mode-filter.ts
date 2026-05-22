import type { AvailableMode } from "../types/available-mode.js";

/**
 * Returns provider-visible modes from the canonical capability snapshot.
 *
 * @param modes - Available modes from the canonical capability snapshot
 * @returns Filtered array containing only visible modes
 */
export function filterVisibleModes(
	modes: readonly AvailableMode[] | null | undefined
): readonly AvailableMode[] {
	if (!modes) {
		return [];
	}

	return modes;
}

/**
 * Gets a readable fallback label for a provider mode id.
 */
export function getUIModeDisplayName(backendModeId: string): string {
	return backendModeId
		.split(/[-_\s]+/)
		.filter((part) => part.length > 0)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}
