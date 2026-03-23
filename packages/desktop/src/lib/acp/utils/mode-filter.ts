import { BACKEND_TO_UI_MODE_MAP, VISIBLE_BACKEND_MODE_IDS } from "../constants/mode-mapping.js";
import type { AvailableMode } from "../types/available-mode.js";

/**
 * Filters modes to only include visible modes (Build and Plan).
 *
 * @param modes - Array of available modes from the backend
 * @returns Filtered array containing only visible modes
 */
export function filterVisibleModes(modes: readonly AvailableMode[]): readonly AvailableMode[] {
	return modes.filter((mode) => VISIBLE_BACKEND_MODE_IDS.includes(mode.id));
}

/**
 * Gets the UI display name for a backend mode ID.
 *
 * @param backendModeId - The backend mode ID (e.g., "acceptEdits", "plan")
 * @returns The user-friendly UI name (e.g., "Build", "Plan"), or the original ID if not mapped
 */
export function getUIModeDisplayName(backendModeId: string): string {
	return BACKEND_TO_UI_MODE_MAP[backendModeId] ?? backendModeId;
}
