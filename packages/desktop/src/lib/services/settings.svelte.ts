/**
 * Settings Service - Frontend service for managing application settings.
 *
 * Provides type-safe access to settings stored in the database via Tauri commands.
 * Uses neverthrow ResultAsync for error handling.
 */

import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";

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
	return ResultAsync.fromPromise(
		invoke<CustomKeybindings>("get_custom_keybindings"),
		(e) => new Error(`Failed to get custom keybindings: ${String(e)}`)
	);
}

/**
 * Save all custom keybindings.
 * Takes a map of command -> key.
 */
export function saveCustomKeybindings(keybindings: CustomKeybindings): ResultAsync<void, Error> {
	return ResultAsync.fromPromise(
		invoke<void>("save_custom_keybindings", { keybindings }),
		(e) => new Error(`Failed to save custom keybindings: ${String(e)}`)
	);
}
