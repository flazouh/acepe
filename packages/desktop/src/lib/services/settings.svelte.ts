/**
 * Settings Service - Frontend service for managing application settings.
 *
 * Provides type-safe access to settings stored in the database via Tauri commands.
 * Uses Effect for error handling.
 */

import * as Effect from "effect/Effect";
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
export function getCustomKeybindings(): Effect.Effect<CustomKeybindings, Error> {
	return tauriSettings.getCustomKeybindings().pipe(
		Effect.mapError((error) => new Error(`Failed to get custom keybindings: ${String(error)}`))
	);
}

/**
 * Save all custom keybindings.
 * Takes a map of command -> key.
 */
export function saveCustomKeybindings(keybindings: CustomKeybindings): Effect.Effect<void, Error> {
	return tauriSettings.saveCustomKeybindings(keybindings).pipe(
		Effect.mapError((error) => new Error(`Failed to save custom keybindings: ${String(error)}`))
	);
}
