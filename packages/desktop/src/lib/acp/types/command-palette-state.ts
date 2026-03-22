import type { CommandPaletteCommand } from "./command-palette-command.js";

/**
 * State for the command palette.
 */
export interface CommandPaletteState {
	/**
	 * Whether the command palette is open.
	 */
	open: boolean;

	/**
	 * Currently selected command index.
	 */
	selectedIndex: number;

	/**
	 * Available commands.
	 */
	commands: CommandPaletteCommand[];

	/**
	 * Current search query.
	 */
	query: string;
}
