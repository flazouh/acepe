import type { AvailableCommand } from "../../../types/available-command.js";
import type { FilePickerEntry } from "../../../types/file-picker-entry.js";
import type { DropdownPosition } from "./dropdown-position.js";

/**
 * Shape of the agent input state.
 *
 * This interface describes the reactive state managed by AgentInputState class.
 * Used for type checking and documentation.
 */
export interface AgentInputStateShape {
	/**
	 * Current message text in the input.
	 */
	readonly message: string;

	/**
	 * Textarea element reference.
	 */
	readonly textareaRef: HTMLTextAreaElement | null;

	/**
	 * Available slash commands.
	 */
	readonly availableCommands: AvailableCommand[];

	/**
	 * Whether slash command dropdown is visible.
	 */
	readonly showSlashDropdown: boolean;

	/**
	 * Position of slash command dropdown.
	 */
	readonly slashPosition: DropdownPosition;

	/**
	 * Current query text for slash command filtering.
	 */
	readonly slashQuery: string;

	/**
	 * Start index of slash command trigger in message.
	 */
	readonly slashStartIndex: number;

	/**
	 * Available files for file picker.
	 */
	readonly availableFiles: FilePickerEntry[];

	/**
	 * Whether file picker dropdown is visible.
	 */
	readonly showFileDropdown: boolean;

	/**
	 * Position of file picker dropdown.
	 */
	readonly filePosition: DropdownPosition;

	/**
	 * Current query text for file picker filtering.
	 */
	readonly fileQuery: string;

	/**
	 * Start index of file picker trigger in message.
	 */
	readonly fileStartIndex: number;

	/**
	 * Whether project files have been loaded.
	 */
	readonly filesLoaded: boolean;
}
