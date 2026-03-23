import type { AvailableCommand } from "../../../types/available-command.js";

/**
 * Position for the dropdown.
 */
export type DropdownPosition = {
	/**
	 * Top position in pixels.
	 */
	readonly top: number;

	/**
	 * Left position in pixels.
	 */
	readonly left: number;
};

/**
 * Props for the SlashCommandDropdown component.
 */
export interface SlashCommandDropdownProps {
	/**
	 * Available commands to display.
	 */
	readonly commands: ReadonlyArray<AvailableCommand>;

	/**
	 * Whether the dropdown is open.
	 */
	readonly isOpen: boolean;

	/**
	 * Query string to filter commands.
	 */
	readonly query: string;

	/**
	 * Position of the dropdown.
	 */
	readonly position: DropdownPosition;

	/**
	 * Callback when a command is selected.
	 *
	 * @param command - The selected command
	 */
	readonly onSelect: (command: AvailableCommand) => void;

	/**
	 * Callback when the dropdown should be closed.
	 */
	readonly onClose: () => void;
}
