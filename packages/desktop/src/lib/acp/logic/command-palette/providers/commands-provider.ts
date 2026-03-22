/**
 * Commands Provider for the command palette.
 * Provides access to application commands/actions.
 */

import { okAsync, ResultAsync } from "neverthrow";
import {
	ArrowsClockwise,
	Database,
	GearSix,
	Plus,
	Rows,
	Sidebar,
	Terminal,
	X,
} from "phosphor-svelte";
import type { PaletteCommandDef } from "../../../types/palette-command.js";
import type { PaletteItem, PaletteItemMetadata } from "../../../types/palette-item.js";
import { fuzzySearch } from "../fuzzy-search.js";

import { getRecentItemsStore, type StoredRecentItem } from "../recent-items-store.svelte.js";
import type { PaletteProvider } from "./palette-provider.js";

/**
 * Converts a command definition to a palette item.
 */
function commandToPaletteItem(cmd: PaletteCommandDef): PaletteItem {
	const metadata: PaletteItemMetadata = {};
	if (cmd.keybinding) {
		metadata.keybinding = cmd.keybinding;
	}
	return {
		id: cmd.id,
		label: cmd.label,
		description: cmd.description,
		icon: cmd.icon,
		metadata,
	};
}

/**
 * Commands provider configuration.
 */
export interface CommandsProviderConfig {
	/** Handler for creating a new thread */
	onCreateThread: () => void;
	/** Handler for opening settings */
	onOpenSettings: () => void;
	/** Handler for opening SQL Studio */
	onOpenSqlStudio: () => void;
	/** Handler for toggling sidebar */
	onToggleSidebar: () => void;
	/** Handler for toggling top bar */
	onToggleTopBar: () => void;
	/** Handler for toggling debug panel */
	onToggleDebug?: () => void;
	/** Handler for closing current thread */
	onCloseThread?: () => void;
	/** Handler for refreshing sync */
	onRefreshSync?: () => void;
	/** Whether we're in development mode */
	isDev: boolean;
}

/**
 * Provider for command palette commands mode.
 */
export class CommandsProvider implements PaletteProvider {
	readonly mode = "commands" as const;
	readonly label = "Commands";
	readonly placeholder = "Search commands...";

	private readonly commands: PaletteCommandDef[];
	private readonly commandsById: Map<string, PaletteCommandDef>;
	private readonly recentStore = getRecentItemsStore();

	constructor(private readonly config: CommandsProviderConfig) {
		this.commands = this.buildCommands();
		this.commandsById = new Map(this.commands.map((cmd) => [cmd.id, cmd]));
	}

	/**
	 * Build the list of available commands.
	 */
	private buildCommands(): PaletteCommandDef[] {
		const commands: PaletteCommandDef[] = [
			{
				id: "thread.create",
				label: "Create new thread",
				description: "Start a new conversation",
				icon: Plus,
				handler: this.config.onCreateThread,
				keybinding: "Cmd+T",
				category: "threads",
			},
			{
				id: "settings.open",
				label: "Open settings",
				description: "Configure application preferences",
				icon: GearSix,
				handler: this.config.onOpenSettings,
				keybinding: "Cmd+,",
				category: "navigation",
			},
			{
				id: "sql-studio.open",
				label: "Open SQL Studio",
				description: "Run SQL queries and inspect database tables",
				icon: Database,
				handler: this.config.onOpenSqlStudio,
				category: "navigation",
			},
			{
				id: "sidebar.toggle",
				label: "Toggle sidebar",
				description: "Show or hide the sidebar",
				icon: Sidebar,
				handler: this.config.onToggleSidebar,
				keybinding: "Cmd+B",
				category: "view",
			},
			{
				id: "topbar.toggle",
				label: "Toggle tab bar",
				description: "Show or hide the tab bar",
				icon: Rows,
				handler: this.config.onToggleTopBar,
				keybinding: "Cmd+Shift+B",
				category: "view",
			},
		];

		if (this.config.onCloseThread) {
			commands.push({
				id: "thread.close",
				label: "Close current thread",
				description: "Close the active conversation",
				icon: X,
				handler: this.config.onCloseThread,
				keybinding: "Cmd+W",
				category: "threads",
			});
		}

		if (this.config.onRefreshSync) {
			commands.push({
				id: "sync.refresh",
				label: "Refresh sync",
				description: "Resynchronize data",
				icon: ArrowsClockwise,
				handler: this.config.onRefreshSync,
				category: "sync",
			});
		}

		if (this.config.onToggleDebug && this.config.isDev) {
			commands.push({
				id: "debug.toggle",
				label: "Toggle debug panel",
				description: "Show developer debug information",
				icon: Terminal,
				handler: this.config.onToggleDebug,
				devOnly: true,
				category: "dev",
			});
		}

		return commands;
	}

	/**
	 * Search for commands matching the query.
	 */
	search(query: string): PaletteItem[] {
		// Filter by devOnly flag
		const visibleCommands = this.commands.filter((cmd) => !cmd.devOnly || this.config.isDev);

		// Convert to searchable format
		const searchable = visibleCommands.map((cmd) => ({
			id: cmd.id,
			label: cmd.label,
			description: cmd.description,
		}));

		// Perform fuzzy search
		const results = fuzzySearch(query, searchable);

		// Map back to palette items
		return results.map(({ item, score }) => {
			const cmd = this.commandsById.get(item.id)!;
			return {
				...commandToPaletteItem(cmd),
				score,
			};
		});
	}

	/**
	 * Execute a command.
	 */
	execute(item: PaletteItem): ResultAsync<void, Error> {
		const cmd = this.commandsById.get(item.id);
		if (!cmd) {
			return okAsync(undefined);
		}

		// Add to recent
		this.addToRecent(item);

		// Execute the command
		const result = cmd.handler();
		if (result instanceof Promise) {
			return ResultAsync.fromPromise(result, (e) => new Error(String(e)));
		}
		return okAsync(undefined);
	}

	/**
	 * Get recently used commands.
	 */
	getRecent(): PaletteItem[] {
		const recent = this.recentStore.getRecent("commands");
		return recent
			.map((stored) => this.storedToItem(stored))
			.filter((item): item is PaletteItem => item !== null);
	}

	/**
	 * Add a command to recent items.
	 */
	addToRecent(item: PaletteItem): void {
		this.recentStore.addRecent("commands", {
			id: item.id,
			label: item.label,
			description: item.description,
		});
	}

	/**
	 * Convert a stored recent item back to a palette item.
	 */
	private storedToItem(stored: StoredRecentItem): PaletteItem | null {
		const cmd = this.commandsById.get(stored.id);
		if (!cmd) {
			return null;
		}
		// Check devOnly
		if (cmd.devOnly && !this.config.isDev) {
			return null;
		}
		return commandToPaletteItem(cmd);
	}
}
