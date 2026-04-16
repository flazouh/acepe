/**
 * Settings Service - Frontend service for managing application settings.
 *
 * Provides type-safe access to settings stored in the database via Tauri commands.
 * Uses neverthrow ResultAsync for error handling.
 */

import type { ResultAsync } from "neverthrow";
import { settings as tauriSettings } from "$lib/utils/tauri-client/settings.js";

/**
 * Custom keybindings stored as a map of command -> key.
 * Example: { "selector.agent.toggle": "$mod+o" }
 */
export type CustomKeybindings = Record<string, string>;

/**
 * Get all custom keybindings.
 * Returns a map of command -> key.
 */
export function getCustomKeybindings(): ResultAsync<CustomKeybindings, Error> {
	return tauriSettings.getCustomKeybindings().mapErr((error) => {
		return new Error(`Failed to get custom keybindings: ${String(error)}`);
	});
}

/**
 * Save all custom keybindings.
 * Takes a map of command -> key.
 */
export function saveCustomKeybindings(keybindings: CustomKeybindings): ResultAsync<void, Error> {
	return tauriSettings.saveCustomKeybindings(keybindings).mapErr((error) => {
		return new Error(`Failed to save custom keybindings: ${String(error)}`);
	});
}
