/**
 * Advanced Command Palette Hook.
 *
 * Orchestrates multi-mode command palette with commands, sessions, and files.
 * Uses provider pattern for mode-specific logic.
 */

import { okAsync, type ResultAsync } from "neverthrow";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import {
	CommandsProvider,
	type CommandsProviderConfig,
	FilesProvider,
	type PaletteProvider,
	SessionsProvider,
} from "../logic/command-palette/providers/index.js";
import { getRecentItemsStore } from "../logic/command-palette/recent-items-store.svelte.js";
import type { ProjectManager } from "../logic/project-manager.svelte.js";
import type { PanelStore } from "../store/panel-store.svelte.js";
import type { SessionStore } from "../store/session-store.svelte.js";
import type { PaletteItem } from "../types/palette-item.js";
import type { PaletteMode } from "../types/palette-mode.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({ id: "advanced-command-palette", name: "AdvancedCommandPalette" });

/**
 * Configuration for the advanced command palette.
 */
export interface AdvancedCommandPaletteConfig {
	/** Session store instance */
	sessionStore: SessionStore;
	/** Project manager instance */
	projectManager: ProjectManager;
	/** Panel store instance */
	panelStore: PanelStore;
	/** Commands provider config */
	commands: Omit<CommandsProviderConfig, "isDev">;
	/** Handler for opening a session */
	onOpenSession: (sessionId: string, projectPath: string) => void;
	/** Handler for opening a file */
	onOpenFile: (filePath: string, projectPath: string) => void;
}

/**
 * State for the advanced command palette.
 */
export interface AdvancedCommandPaletteState {
	/** Current mode */
	readonly mode: PaletteMode;
	/** Search query */
	readonly query: string;
	/** Selected item index */
	readonly selectedIndex: number;
	/** Current provider */
	readonly provider: PaletteProvider;
	/** Filtered results */
	readonly results: PaletteItem[];
	/** Recent items for current mode */
	readonly recentItems: PaletteItem[];
	/** Whether files are loading */
	readonly isLoading: boolean;
}

/**
 * Hook for managing advanced command palette state and operations.
 */
export class UseAdvancedCommandPalette {
	private readonly providers: Map<PaletteMode, PaletteProvider>;
	private readonly recentStore = getRecentItemsStore();
	private readonly _filesProvider: FilesProvider;

	/**
	 * Internal state.
	 */
	private _mode = $state<PaletteMode>("commands");
	private _query = $state("");
	private _selectedIndex = $state(0);

	constructor(config: AdvancedCommandPaletteConfig) {
		const isDev = import.meta.env.DEV;

		// Initialize providers FIRST (before any $derived uses them)
		const commandsProvider = new CommandsProvider({
			...config.commands,
			isDev,
		});

		const sessionsProvider = new SessionsProvider({
			sessionStore: config.sessionStore,
			projectManager: config.projectManager,
			onOpenSession: config.onOpenSession,
		});

		this._filesProvider = new FilesProvider({
			projectManager: config.projectManager,
			onOpenFile: config.onOpenFile,
		});

		this.providers = new SvelteMap<PaletteMode, PaletteProvider>([
			["commands", commandsProvider],
			["sessions", sessionsProvider],
			["files", this._filesProvider],
		]);

		// Load recent items from storage
		this.recentStore.load().match(
			() => logger.debug("Recent items loaded"),
			(error) => logger.warn("Failed to load recent items:", error)
		);
	}

	/**
	 * Current provider based on mode.
	 */
	private getCurrentProvider(): PaletteProvider {
		return this.providers.get(this._mode)!;
	}

	/**
	 * Filtered results based on query.
	 */
	private getFilteredResults(): PaletteItem[] {
		return this.getCurrentProvider().search(this._query);
	}

	/**
	 * Recent items for current mode.
	 */
	private getCurrentRecentItems(): PaletteItem[] {
		return this.getCurrentProvider().getRecent();
	}

	/**
	 * Combined display items (recent + results when query is empty).
	 */
	get displayItems(): PaletteItem[] {
		const filteredResults = this.getFilteredResults();
		if (this._query.trim()) {
			return filteredResults;
		}
		// Show recent items at top, then regular results
		const recent = this.getCurrentRecentItems();

		// Remove recent items from results to avoid duplicates
		const recentIds = new SvelteSet(recent.map((r) => r.id));
		const filtered = filteredResults.filter((r) => !recentIds.has(r.id));

		return [...recent, ...filtered];
	}

	/**
	 * Whether we're showing recent items (for section header).
	 */
	get hasRecentSection(): boolean {
		return !this._query.trim() && this.getCurrentRecentItems().length > 0;
	}

	/**
	 * Index where recent items end (for section separator).
	 */
	get recentSectionEndIndex(): number {
		return this.hasRecentSection ? this.getCurrentRecentItems().length : 0;
	}

	/**
	 * Public state for UI binding.
	 */
	get state(): AdvancedCommandPaletteState {
		return {
			mode: this._mode,
			query: this._query,
			selectedIndex: this._selectedIndex,
			provider: this.getCurrentProvider(),
			results: this.displayItems,
			recentItems: this.getCurrentRecentItems(),
			isLoading: this._filesProvider.isLoading,
		};
	}

	/**
	 * Get the current mode.
	 */
	get mode(): PaletteMode {
		return this._mode;
	}

	/**
	 * Get the current query.
	 */
	get query(): string {
		return this._query;
	}

	/**
	 * Get the selected index.
	 */
	get selectedIndex(): number {
		return this._selectedIndex;
	}

	/**
	 * Get all available modes with labels.
	 */
	get modes(): Array<{ mode: PaletteMode; label: string }> {
		return [
			{ mode: "commands", label: this.providers.get("commands")?.label ?? "" },
			{ mode: "sessions", label: this.providers.get("sessions")?.label ?? "" },
			{ mode: "files", label: this.providers.get("files")?.label ?? "" },
		];
	}

	/**
	 * Get placeholder text for current mode.
	 */
	get placeholder(): string {
		return this.getCurrentProvider().placeholder;
	}

	/**
	 * Reset state when the command palette opens.
	 */
	resetForOpen(): void {
		this._query = "";
		this._selectedIndex = 0;
		// Trigger file preload when opening
		this._filesProvider.preloadAllProjects();
	}

	/**
	 * Set the current mode.
	 */
	setMode(mode: PaletteMode): void {
		if (mode !== this._mode) {
			this._mode = mode;
			this._query = "";
			this._selectedIndex = 0;
		}
	}

	/**
	 * Set the search query.
	 */
	setQuery(query: string): void {
		this._query = query;
		this._selectedIndex = 0;
	}

	/**
	 * Navigate to the next item.
	 */
	navigateNext(): void {
		const items = this.displayItems;
		if (items.length === 0) return;
		this._selectedIndex = Math.min(this._selectedIndex + 1, items.length - 1);
	}

	/**
	 * Navigate to the previous item.
	 */
	navigatePrevious(): void {
		this._selectedIndex = Math.max(this._selectedIndex - 1, 0);
	}

	/**
	 * Select an item by index.
	 */
	selectIndex(index: number): void {
		const items = this.displayItems;
		if (index >= 0 && index < items.length) {
			this._selectedIndex = index;
		}
	}

	/**
	 * Get the currently selected item.
	 */
	getSelectedItem(): PaletteItem | null {
		const items = this.displayItems;
		return items[this._selectedIndex] ?? null;
	}

	/**
	 * Execute the selected item.
	 */
	executeSelected(): ResultAsync<void, Error> {
		const item = this.getSelectedItem();
		if (!item) {
			return okAsync(undefined);
		}

		logger.info("Executing item:", item.id, "mode:", this._mode);
		return this.getCurrentProvider().execute(item);
	}

	/**
	 * Switch to the next mode.
	 */
	nextMode(): void {
		const modes: PaletteMode[] = ["commands", "sessions", "files"];
		const currentIndex = modes.indexOf(this._mode);
		const nextIndex = (currentIndex + 1) % modes.length;
		this.setMode(modes[nextIndex]);
	}

	/**
	 * Switch to the previous mode.
	 */
	previousMode(): void {
		const modes: PaletteMode[] = ["commands", "sessions", "files"];
		const currentIndex = modes.indexOf(this._mode);
		const prevIndex = (currentIndex - 1 + modes.length) % modes.length;
		this.setMode(modes[prevIndex]);
	}
}

/**
 * Creates a new advanced command palette hook instance.
 */
export function useAdvancedCommandPalette(
	config: AdvancedCommandPaletteConfig
): UseAdvancedCommandPalette {
	return new UseAdvancedCommandPalette(config);
}
