import type { HugeiconsIconName } from "@acepe/ui/icons";
import type { ComponentType } from "svelte";

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
	 * Icon component to display.
	 */
	icon?: ComponentType;

	/**
	 * Hugeicons name used when no Svelte icon component is provided.
	 */
	iconName?: HugeiconsIconName;

	/**
	 * Whether this command is only available in development mode.
	 */
	devOnly?: boolean;
}
