import type { Component, ComponentType } from "svelte";

/**
 * Definition for a command in the command palette.
 */
export interface PaletteCommandDef {
	/** Unique command identifier */
	readonly id: string;
	/** Display label */
	readonly label: string;
	/** Optional description */
	readonly description?: string;
	/** Icon component */
	// biome-ignore lint/suspicious/noExplicitAny: Svelte Component generic requires any
	readonly icon: ComponentType | Component<any>;
	/** Handler function to execute */
	readonly handler: () => void | Promise<void>;
	/** Keyboard shortcut display string */
	readonly keybinding?: string;
	/** Whether command is only shown in dev mode */
	readonly devOnly?: boolean;
	/** Category for grouping */
	readonly category?: string;
}
