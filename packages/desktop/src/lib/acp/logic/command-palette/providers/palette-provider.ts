import type { ResultAsync } from "neverthrow";

import type { PaletteItem } from "../../../types/palette-item.js";
import type { PaletteMode } from "../../../types/palette-mode.js";

/**
 * Interface for command palette mode providers.
 * Each mode (commands, sessions, files) implements this interface.
 */
export interface PaletteProvider {
	/** The mode this provider handles */
	readonly mode: PaletteMode;

	/** Display label for the mode tab */
	readonly label: string;

	/** Placeholder text for search input */
	readonly placeholder: string;

	/**
	 * Search for items matching the query.
	 * @param query - Search query string
	 * @returns Array of matching items, sorted by relevance
	 */
	search(query: string): PaletteItem[];

	/**
	 * Execute an action for the selected item.
	 * @param item - The item to execute
	 * @returns ResultAsync indicating success or failure
	 */
	execute(item: PaletteItem): ResultAsync<void, Error>;

	/**
	 * Get recent items for this mode.
	 * @returns Array of recently accessed items
	 */
	getRecent(): PaletteItem[];

	/**
	 * Add an item to the recent list.
	 * @param item - The item to add
	 */
	addToRecent(item: PaletteItem): void;
}
