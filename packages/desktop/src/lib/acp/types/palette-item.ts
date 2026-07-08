import type { Component, ComponentType } from "svelte";
import type { RoundedIconName } from "@acepe/ui/icons";

/**
 * Metadata for palette items, varies by mode.
 */
export interface PaletteItemMetadata {
	/** Project path for sessions/files */
	projectPath?: string;
	/** Project name for display */
	projectName?: string;
	/** Disambiguating badge label for the project */
	projectBadgeLabel?: string | null;
	/** Project color for badge */
	projectColor?: string;
	/** Project icon source for badge */
	projectIconSrc?: string | null;
	/** File extension for files */
	extension?: string;
	/** Agent ID for sessions */
	agentId?: string;
	/** Keybinding shortcut for commands */
	keybinding?: string;
}

/**
 * A single item in the command palette results.
 */
export interface PaletteItem {
	/** Unique identifier */
	readonly id: string;
	/** Display label */
	readonly label: string;
	/** Optional secondary description */
	readonly description?: string;
	/** Icon component */
	// biome-ignore lint/suspicious/noExplicitAny: Svelte Component generic requires any
	readonly icon?: ComponentType | Component<any>;
	/** Rounded icon name from the extracted app icon set. */
	readonly roundedIcon?: RoundedIconName;
	/** Additional metadata */
	readonly metadata: PaletteItemMetadata;
	/** Search score (higher = better match) */
	readonly score?: number;
}
