import type { Component, Snippet } from "svelte";

import type { SelectorGroup } from "./selector-group.js";
import type { SelectorItem } from "./selector-item.js";

/**
 * Configuration for rendering selector items.
 *
 * @template T - The type of the item's unique identifier
 */
export interface SelectorItemRenderConfig<T = string> {
	/**
	 * Custom render snippet for item content.
	 * If not provided, default rendering is used.
	 */
	renderItem?: Snippet<[{ item: SelectorItem<T>; isSelected: boolean }]>;

	/**
	 * Custom render snippet for the button content.
	 * If not provided, default rendering is used.
	 */
	renderButton?: Snippet<[{ item: SelectorItem<T> | null; isLoading: boolean }]>;
}

/**
 * Configuration for the selector component.
 *
 * @template T - The type of the item's unique identifier
 */
export interface SelectorConfig<T = string> {
	/**
	 * Available items to select from.
	 */
	items: SelectorItem<T>[];

	/**
	 * Currently selected item ID, or null if none selected.
	 */
	selectedId: T | null;

	/**
	 * Whether the selector is in loading state.
	 */
	isLoading?: boolean;

	/**
	 * Whether the selector is disabled.
	 */
	disabled?: boolean;

	/**
	 * Optional groups for organizing items.
	 * If provided, items will be grouped by their groupId.
	 */
	groups?: SelectorGroup<T>[];

	/**
	 * Empty state message when no items are available.
	 */
	emptyMessage?: string;

	/**
	 * Custom rendering configuration.
	 */
	renderConfig?: SelectorItemRenderConfig<T>;

	/**
	 * Optional action buttons (e.g., "Browse" for projects, "Import from Claude").
	 * If provided, will be shown at the bottom of the dropdown.
	 * Icon can be either a Svelte component or an image path (string).
	 */
	actionButtons?: Array<{
		label: string;
		icon?: Component | string;
		onClick: () => void | Promise<void>;
	}>;
}
