import { err, ok, type Result } from "neverthrow";
import { CommandPaletteError } from "../errors/command-palette-error.js";
import type { CommandPaletteCommand } from "../types/command-palette-command.js";
import type { CommandPaletteState } from "../types/command-palette-state.js";

/**
 * Manages command palette state and operations.
 *
 * Handles command filtering, selection, and execution logic.
 */
export class CommandPaletteManager {
	/**
	 * Filter commands based on query and environment.
	 *
	 * @param commands - All available commands
	 * @param query - Search query
	 * @param isDev - Whether we're in development mode
	 * @returns Filtered commands
	 */
	filterCommands(
		commands: CommandPaletteCommand[],
		query: string,
		isDev: boolean
	): CommandPaletteCommand[] {
		// Filter by devOnly flag
		const visibleCommands = commands.filter((cmd) => !cmd.devOnly || isDev);

		// Filter by query if provided
		if (!query.trim()) {
			return visibleCommands;
		}

		const lowerQuery = query.toLowerCase();
		return visibleCommands.filter((cmd) => cmd.label.toLowerCase().includes(lowerQuery));
	}

	/**
	 * Get the next selected index when navigating down.
	 *
	 * @param currentIndex - Current selected index
	 * @param commandCount - Total number of commands
	 * @returns New selected index
	 */
	getNextIndex(currentIndex: number, commandCount: number): number {
		if (commandCount === 0) return 0;
		return Math.min(currentIndex + 1, commandCount - 1);
	}

	/**
	 * Get the previous selected index when navigating up.
	 *
	 * @param currentIndex - Current selected index
	 * @returns New selected index
	 */
	getPreviousIndex(currentIndex: number): number {
		return Math.max(currentIndex - 1, 0);
	}

	/**
	 * Get command by index.
	 *
	 * @param commands - Available commands
	 * @param index - Command index
	 * @returns Result containing the command or error
	 */
	getCommandByIndex(
		commands: CommandPaletteCommand[],
		index: number
	): Result<CommandPaletteCommand, CommandPaletteError> {
		if (index < 0 || index >= commands.length) {
			return err(
				new CommandPaletteError(`Command index ${index} is out of bounds`, "INVALID_STATE")
			);
		}

		const command = commands[index];
		if (!command) {
			return err(
				new CommandPaletteError(`Command at index ${index} not found`, "COMMAND_NOT_FOUND")
			);
		}

		return ok(command);
	}

	/**
	 * Reset selection to the first command.
	 *
	 * @param state - Current state
	 * @returns Updated state with reset selection
	 */
	resetSelection(state: CommandPaletteState): CommandPaletteState {
		return {
			...state,
			selectedIndex: 0,
		};
	}
}
