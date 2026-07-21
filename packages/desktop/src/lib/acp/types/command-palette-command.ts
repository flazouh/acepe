import type { HugeiconsIconName } from "@acepe/ui/icons";

/**
 * A command that can be executed from the command palette.
 */
export interface CommandPaletteCommand {
	/**
	 * Unique identifier for the command.
	 */
	id: string;

	/**
	 * Display label for the command.
	 */
	label: string;

	/**
	 * Hugeicons name used for this command.
	 */
	iconName?: HugeiconsIconName;

	/**
	 * Whether this command is only available in development mode.
	 */
	devOnly?: boolean;
}
