/**
 * Store for persisting recent items in the command palette.
 * Uses Tauri's user settings for persistence.
 */

import type { ResultAsync } from "neverthrow";
import type { UserSettingKey } from "$lib/services/converted-session-types.js";
import { settings } from "$lib/utils/tauri-client/settings.js";

import type { PaletteMode } from "../../types/palette-mode.js";

import { createLogger } from "../../utils/logger.js";

const logger = createLogger({ id: "recent-items-store", name: "RecentItemsStore" });

const STORAGE_KEY: UserSettingKey = "command_palette_recent_items";
const MAX_RECENT_ITEMS = 5;

/**
 * Serializable recent item for storage.
 */
export interface StoredRecentItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly timestamp: number;
}

/**
 * Storage format for all recent items.
 */
interface StoredRecentItems {
	commands: StoredRecentItem[];
	sessions: StoredRecentItem[];
	files: StoredRecentItem[];
}

/**
 * Store for managing recent items in the command palette.
 */
export class RecentItemsStore {
	private _items = $state<StoredRecentItems>({
		commands: [],
		sessions: [],
		files: [],
	});

	/**
	 * Get recent items for a specific mode.
	 */
	getRecent(mode: PaletteMode): StoredRecentItem[] {
		return this._items[mode];
	}

	/**
	 * Add an item to the recent list for a mode.
	 * Removes duplicates and keeps the list under MAX_RECENT_ITEMS.
	 */
	addRecent(mode: PaletteMode, item: Omit<StoredRecentItem, "timestamp">): void {
		const current = this._items[mode];
		const filtered = current.filter((i) => i.id !== item.id);
		const newItem: StoredRecentItem = {
			...item,
			timestamp: Date.now(),
		};
		const updated = [newItem, ...filtered].slice(0, MAX_RECENT_ITEMS);

		this._items = {
			...this._items,
			[mode]: updated,
		};

		this.persist();
	}

	/**
	 * Remove an item from the recent list.
	 */
	removeRecent(mode: PaletteMode, itemId: string): void {
		const current = this._items[mode];
		const updated = current.filter((i) => i.id !== itemId);

		this._items = {
			...this._items,
			[mode]: updated,
		};

		this.persist();
	}

	/**
	 * Clear all recent items for a mode.
	 */
	clearRecent(mode: PaletteMode): void {
		this._items = {
			...this._items,
			[mode]: [],
		};

		this.persist();
	}

	/**
	 * Load recent items from storage.
	 */
	load(): ResultAsync<void, Error> {
		return settings
			.getRaw(STORAGE_KEY)
			.mapErr((error) => {
				return new Error(`Failed to load recent items: ${error}`);
			})
			.map((stored) => {
				if (stored !== null) {
					const parsed = JSON.parse(stored) as Partial<StoredRecentItems>;
					this._items = {
						commands: parsed.commands ?? [],
						sessions: parsed.sessions ?? [],
						files: parsed.files ?? [],
					};
					logger.debug("Loaded recent items:", this._items);
				}
			});
	}

	/**
	 * Persist current items to storage.
	 */
	private persist(): void {
		settings.setRaw(STORAGE_KEY, JSON.stringify(this._items)).match(
			() => undefined,
			(error) => logger.error("Failed to persist recent items:", error)
		);
	}
}

let instance: RecentItemsStore | null = null;

/**
 * Get the singleton RecentItemsStore instance.
 */
export function getRecentItemsStore(): RecentItemsStore {
	if (!instance) {
		instance = new RecentItemsStore();
	}
	return instance;
}
