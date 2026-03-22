import IconPlus from "@tabler/icons-svelte/icons/plus";
import { okAsync, type ResultAsync } from "neverthrow";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import { CommandPaletteManager } from "../logic/command-palette-manager.js";
import type { ProjectManager } from "../logic/project-manager.svelte.js";
import type { PanelStore } from "../store/panel-store.svelte.js";
import type { CommandPaletteCommand } from "../types/command-palette-command.js";
import type { CommandPaletteState } from "../types/command-palette-state.js";
import { createLogger } from "../utils/logger.js";

/**
 * Handler for creating new threads.
 */
export type CreateThreadHandler = () => void;

/**
 * Hook for managing command palette state and operations.
 * Uses the panel store for spawning panels and project manager for project info.
 */
export class UseCommandPalette {
	private readonly manager: CommandPaletteManager;
	private readonly logger = createLogger({
		id: LOGGER_IDS.COMMAND_PALETTE,
		name: "Command Palette",
	});

	/**
	 * External handler for creating threads.
	 * Set via setCreateThreadHandler() to delegate to MainAppViewState.handleNewThread().
	 */
	private createThreadHandler: CreateThreadHandler | null = null;

	/**
	 * Current command palette state (excluding commands which are derived).
	 * Note: 'open' state is managed by the component, not the hook.
	 */
	private _state = $state({
		selectedIndex: 0,
		query: "",
	});

	/**
	 * Full state including derived commands.
	 */
	state = $derived<CommandPaletteState>({
		open: false, // Controlled by component prop, not stored in hook
		selectedIndex: this._state.selectedIndex,
		query: this._state.query,
		commands: (() => {
			// Static commands (conditionally included based on project state)
			const staticCommands: CommandPaletteCommand[] = [];

			// Only show create-thread command if projectCount is known and > 0
			if (this._projectManager.projectCount !== null && this._projectManager.projectCount > 0) {
				staticCommands.push({
					id: "create-thread",
					label: "Create new thread",
					icon: IconPlus,
				});
			}

			return staticCommands;
		})(),
	});

	constructor(
		private readonly _panelStore: PanelStore,
		private readonly _projectManager: ProjectManager
	) {
		this.manager = new CommandPaletteManager();
	}

	/**
	 * Sets the external handler for creating threads.
	 * This allows delegation to MainAppViewState.handleNewThread() for full session creation logic.
	 */
	setCreateThreadHandler(handler: CreateThreadHandler): void {
		this.createThreadHandler = handler;
	}

	/**
	 * Get the panel store instance.
	 */
	get panelStore(): PanelStore {
		return this._panelStore;
	}

	/**
	 * Get the project manager instance.
	 */
	get projectManager(): ProjectManager {
		return this._projectManager;
	}

	/**
	 * Reset state when the command palette opens.
	 * Component is responsible for managing the 'open' state.
	 */
	resetForOpen(): void {
		this.resetSelection();
		this._state.query = "";
	}

	/**
	 * Set the search query.
	 */
	setQuery(query: string): void {
		this._state.query = query;
		this.resetSelection();
	}

	/**
	 * Navigate to the next command.
	 */
	navigateNext(): void {
		const filteredCommands = this.getFilteredCommands();
		this._state.selectedIndex = this.manager.getNextIndex(
			this._state.selectedIndex,
			filteredCommands.length
		);
	}

	/**
	 * Navigate to the previous command.
	 */
	navigatePrevious(): void {
		this._state.selectedIndex = this.manager.getPreviousIndex(this._state.selectedIndex);
	}

	/**
	 * Select a command by index (for mouse hover).
	 */
	selectIndex(index: number): void {
		const filteredCommands = this.getFilteredCommands();
		if (index >= 0 && index < filteredCommands.length) {
			this._state.selectedIndex = index;
		}
	}

	/**
	 * Execute the currently selected command.
	 * Component is responsible for closing the palette after execution.
	 */
	executeSelected(): ResultAsync<void, Error> {
		const filteredCommands = this.getFilteredCommands();
		const commandResult = this.manager.getCommandByIndex(
			filteredCommands,
			this._state.selectedIndex
		);

		if (commandResult.isErr()) {
			this.logger.error("Failed to get command:", commandResult.error);
			return okAsync();
		}

		const command = commandResult.value;
		this.logger.info("Executing command:", command.id);

		if (command.id === "create-thread") {
			return this.executeCreateThread();
		}

		// Unknown command
		return okAsync();
	}

	/**
	 * Get filtered commands based on current query and environment.
	 */
	getFilteredCommands(): CommandPaletteCommand[] {
		return this.manager.filterCommands(this.state.commands, this._state.query, import.meta.env.DEV);
	}

	/**
	 * Reset selection to first command.
	 */
	private resetSelection(): void {
		this._state.selectedIndex = 0;
	}

	/**
	 * Execute the create thread command.
	 * Delegates to external handler for full session creation logic.
	 */
	private executeCreateThread(): ResultAsync<void, Error> {
		if (!this.createThreadHandler) {
			this.logger.error("No create thread handler set");
			return okAsync();
		}

		this.createThreadHandler();
		return okAsync();
	}
}

/**
 * Creates a new command palette hook instance.
 */
export function useCommandPalette(
	panelStore: PanelStore,
	projectManager: ProjectManager
): UseCommandPalette {
	return new UseCommandPalette(panelStore, projectManager);
}

// Legacy alias for backward compatibility
export { UseCommandPalette as UseCommandPaletteV2, useCommandPalette as useCommandPaletteV2 };
